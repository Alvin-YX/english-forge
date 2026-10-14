/**
 * 词库管理（写操作）—— 03 文档 §4.2.3 + P-42 词库管理页
 *
 * 🔴 与 `content.service.ts` 的分工：
 *   - `content.service.ts`：**只读**，服务公开 API（`GET /words`），永不改库
 *   - 本文件：唯一的词库写入口，全部 `@Roles(Role.ADMIN)`（见 `content-admin.controller.ts`）
 *   词库仍是「公共参考数据」，但需要一个受控的维护入口 —— 否则用户发现词条有误
 *   时无路可走，只能去容器里改库。
 *
 * 🔴 明确**不开放单条新建/编辑**：词库语义由 ECDICT 灌入保证（lemma 推导、
 *    音标解析、collins→CEFR 映射），单条手填很容易造出「lemma 与 headword 不一致」
 *    的脏数据，而唯一索引 `(lemma, pos)` 会把后续导入静默挡下。
 *    要修一个词的正确做法是：停用 → 修 CSV → 重新导入。
 *
 * 🔴 所有写操作都写 `audit_log`（导入用 `import_words`，停用用 `system_config_change`），
 *    停用的词会立刻从公开列表、练习出题、默写判分里消失，必须留痕可回溯。
 */

import { WORD_SOURCES, word, type WordSource } from '@eng-forge/db/schema';
import { Inject, Injectable } from '@nestjs/common';
import { z } from 'zod';

import { boolQuery } from '../../common/bool-query.js';
import { validationError } from '../../common/errors.business.js';
import { type AuditMeta } from '../../infra/audit/audit-meta.decorator.js';
import { AuditService } from '../../infra/audit/audit.service.js';
import { DbConnection } from '../../infra/db/db.module.js';
import { and, eq, inArray } from '../../infra/db/query.js';

import { ContentService, LIST_WORDS_QUERY_SCHEMA, type WordListView } from './content.service.js';
import { MAX_IMPORT_ROWS, parseWordImport, type WordImportCandidate } from './word-import.js';

// ═══════════════════════════════════════════════════════════
// Zod schemas
// ═══════════════════════════════════════════════════════════

const POSITIVE_INT = z.coerce.number().int().positive();

/**
 * 管理后台词条列表：在公开查询参数之外多一个 `includeInactive`。
 *
 * 🔴 这里不能用 `z.coerce.boolean()`：JS 的 `Boolean('false')` 是 `true`，
 *    `?includeInactive=false` 会被静默当成「显示全部」，过滤方向反过来还不报错。
 *    仓库已有 `boolQuery()` 收口这个问题（同 `errorbook`/`learning`/`scheduler`）。
 *
 * 默认值 `false` 是**有意**的：与公开词库一致，默认只看不停用的词条，
 *    想看停用的必须显式带 `includeInactive=true`。
 */
export const LIST_WORDS_ADMIN_QUERY_SCHEMA = LIST_WORDS_QUERY_SCHEMA.extend({
  includeInactive: boolQuery().optional().default(false),
});
export type ListWordsAdminQuery = z.infer<typeof LIST_WORDS_ADMIN_QUERY_SCHEMA>;

export const SET_ACTIVE_SCHEMA = z.object({ isActive: z.boolean() });

export const BATCH_ACTIVE_SCHEMA = z.object({
  ids: z.array(POSITIVE_INT).min(1).max(500),
  isActive: z.boolean(),
});

/**
 * CSV 导入的表单字段（multipart 的字段值都是字符串，故 `isActive` 用字符串枚举）。
 * 🔴 `license` 必填：`word.license` 是 NOT NULL 版权红线，没有许可信息的内容不允许入库。
 */
export const WORD_IMPORT_FIELDS_SCHEMA = z.object({
  license: z.string().trim().min(1, '必须填写许可标识（如 ecdict-1.0、cc-by-4.0）').max(64),
  source: z.enum(WORD_SOURCES.slice() as [WordSource, ...WordSource[]]).optional().default('import'),
  sourceUrl: z.string().trim().url().max(255).optional(),
  /** 导入时直接标为停用（用于「先传后审」的工作流） */
  importAsInactive: z.enum(['true', 'false']).optional(),
});
export type WordImportFields = z.infer<typeof WORD_IMPORT_FIELDS_SCHEMA>;

export interface WordImportResult {
  inserted: number;
  /** 因 `(lemma, pos)` 已存在而跳过 */
  conflicts: number;
  /** 因 CSV 内重复行而跳过 */
  duplicates: number;
  /** 因空词/无释义而跳过 */
  invalid: number;
  totalRows: number;
  license: string;
  source: WordSource;
}

export interface WordActiveResult {
  requested: number;
  updated: number;
  isActive: boolean;
}

// ═══════════════════════════════════════════════════════════
// 常量
// ═══════════════════════════════════════════════════════════

/** 单条 `IN` 查询的批量大小（避免把 43 万行 CSV 塞进一个 IN 子句） */
const CHUNK_SIZE = 500;

/** 插入行的形状（`word` 表可插列的子集，不含自增与时间戳列） */
type WordInsertRow = Omit<
  WordImportCandidate,
  'source' | 'license' | 'sourceUrl' | 'isActive'
> & {
  source: WordSource;
  license: string;
  sourceUrl: string | null;
  isActive: boolean;
};

// ═══════════════════════════════════════════════════════════
// Service
// ═══════════════════════════════════════════════════════════

@Injectable()
export class ContentAdminService {
  constructor(
    @Inject(DbConnection) private readonly conn: DbConnection,
    @Inject(ContentService) private readonly content: ContentService,
    @Inject(AuditService) private readonly audit: AuditService,
  ) {}

  /** 词条列表（可含停用项，`sortDir` 生效） */
  async listWords(
    query: ListWordsAdminQuery,
  ): Promise<{ items: WordListView[]; total: number; page: number; pageSize: number; totalPages: number }> {
    return this.content.listWords(query, { includeInactive: query.includeInactive });
  }

  /** 停用 / 恢复一批词条 */
  async setActive(ids: number[], isActive: boolean): Promise<WordActiveResult> {
    const result = await this.conn.db
      .update(word)
      .set({ isActive, updatedAt: new Date() })
      .where(and(inArray(word.id, ids), eq(word.isActive, !isActive)))
      .returning({ id: word.id });

    return { requested: ids.length, updated: result.length, isActive };
  }

  /**
   * CSV 批量导入（ECDICT 格式）。
   *
   * 幂等：`(lemma, pos)` 唯一索引兜底，重复行与已存在词条都不会报错，只计入 `skipped`。
   */
  async importCsv(csvText: string, fields: WordImportFields): Promise<WordImportResult> {
    const license = fields.license;
    const source = fields.source;
    const isActive = fields.importAsInactive !== 'true';

    const parsed = parseWordImport(csvText);
    if (parsed.tooManyRows) {
      // 上限保护：整份 43 万行的 stardict.csv 一次性 POST 上来会撑爆内存与审计表
      throw validationError(
        `单次导入上限 ${MAX_IMPORT_ROWS} 行（本次 ${parsed.totalRows} 行），请拆分文件后分批导入`,
      );
    }
    if (parsed.totalRows === 0) {
      throw validationError('CSV 为空或缺少数据行（需含 word/translation 等 ECDICT 列）');
    }

    // 1) CSV 内去重（同一文件里可能有重复行）
    const seen = new Set<string>();
    let duplicates = 0;
    const unique: WordImportCandidate[] = [];
    for (const candidate of parsed.candidates) {
      const key = dedupeKey(candidate);
      if (seen.has(key)) {
        duplicates += 1;
        continue;
      }
      seen.add(key);
      unique.push(candidate);
    }

    // 2) 与库中已有词条比对，排除冲突项（`onConflictDoNothing` 仍作为最后一道兜底）
    const lemmas = [...new Set(unique.map((candidate) => candidate.lemma))];
    const existing = await this.loadExistingKeys(lemmas);

    const rows: WordInsertRow[] = [];
    let conflicts = 0;
    for (const candidate of unique) {
      const positions = existing.get(candidate.lemma);
      if (positions?.has(candidate.pos ?? '')) {
        conflicts += 1;
        continue;
      }
      rows.push({
        ...candidate,
        source,
        license,
        sourceUrl: fields.sourceUrl ?? null,
        isActive,
      });
    }

    // 3) 分批插入
    for (let i = 0; i < rows.length; i += CHUNK_SIZE) {
      const batch = rows.slice(i, i + CHUNK_SIZE);
      await this.conn.db
        .insert(word)
        .values(batch)
        .onConflictDoNothing({ target: [word.lemma, word.pos] });
    }

    return {
      inserted: rows.length,
      conflicts,
      duplicates,
      invalid: parsed.skipped,
      totalRows: parsed.totalRows,
      license,
      source,
    };
  }

  /** 审计：停用/恢复（`targetType='word'`，`detail` 只记 id 与方向，不记词条内容） */
  async auditSetActive(ids: number[], isActive: boolean, meta: AuditMeta, updated: number): Promise<void> {
    await this.audit.record({
      action: 'system_config_change',
      targetType: 'word',
      targetId: String(ids.length),
      actorId: meta.actorId,
      ip: meta.ip,
      ua: meta.ua,
      detail: {
        op: isActive ? 'reactivate_words' : 'deactivate_words',
        requested: ids.length,
        updated,
        // 🔴 不记词条内容：word 表是公共数据，但 id 清单足够回溯，且避免审计表膨胀
        ids: ids.slice(0, 50),
      },
    });
  }

  /** 审计：CSV 导入（`import_words` 是 §4.2.3 为这条路径预留的 action） */
  async auditImport(result: WordImportResult, filename: string, meta: AuditMeta): Promise<void> {
    await this.audit.record({
      action: 'import_words',
      targetType: 'word',
      targetId: String(result.inserted),
      actorId: meta.actorId,
      ip: meta.ip,
      ua: meta.ua,
      detail: {
        file: filename,
        license: result.license,
        source: result.source,
        totalRows: result.totalRows,
        inserted: result.inserted,
        conflicts: result.conflicts,
        duplicates: result.duplicates,
        invalid: result.invalid,
      },
    });
  }

  /** 取一批 lemma 已有的 (lemma → pos 集合)，用于跳过冲突行 */
  private async loadExistingKeys(lemmas: string[]): Promise<Map<string, Set<string>>> {
    const out = new Map<string, Set<string>>();
    for (let i = 0; i < lemmas.length; i += CHUNK_SIZE) {
      const chunk = lemmas.slice(i, i + CHUNK_SIZE);
      const rows = await this.conn.db
        .select({ lemma: word.lemma, pos: word.pos })
        .from(word)
        .where(inArray(word.lemma, chunk));
      for (const row of rows) {
        const positions = out.get(row.lemma) ?? new Set<string>();
        positions.add(row.pos ?? '');
        out.set(row.lemma, positions);
      }
    }
    return out;
  }
}

/** `(lemma, pos)` 的去重键 —— NULL pos 归一成空串，与唯一索引语义对齐 */
function dedupeKey(candidate: WordImportCandidate): string {
  return `${candidate.lemma}\u0000${candidate.pos ?? ''}`;
}
