/**
 * 词条与例句 —— 03 文档 §4.2.3
 *
 * 🔴 词条与例句是**公共数据**（全 profile 共享），因此：
 *   - 列表/详情方法**不做** profileId 过滤（word / sentence 表里没有归属列）；
 *   - 写操作由 ETL/seed 灌入，本模块**不提供**写入接口（与 taxonomy 一致）。
 *
 * 🔴 版权红线：本模块返回的词条**必须**携带 license + source（schema 强制 NOT NULL），
 *    但 API 边界视图不暴露 license / source_url / embedding 等内部字段，
 *    仅暴露前端展示所需的最小集。
 *
 * 🔴 算子必须从 `../../infra/db/query.js` 取用，禁止直连 `drizzle-orm`
 *    （depcruise 规则 `profile-scope-chokepoint`）。
 */

import { ErrorCode } from '@eng-forge/contracts/api';
import { sentence, word, wordUnit } from '@eng-forge/db/schema';
import { Inject, Injectable } from '@nestjs/common';
import { z } from 'zod';


import { notFoundError } from '../../common/errors.business.js';
import { DbConnection } from '../../infra/db/db.module.js';
import { and, asc, count, desc, eq, ilike, or, type SQL } from '../../infra/db/query.js';

// ═══════════════════════════════════════════════════════════
// View 类型（API 边界形状，不含内部列 embedding / searchTsv 等）
// ═══════════════════════════════════════════════════════════

/** 词条列表视图 */
export interface WordListView {
  id: number;
  headword: string;
  lemma: string;
  phoneticUk?: string;
  phoneticUs?: string;
  pos?: string;
  translationZh: string;
  definitionEn?: string;
  frequencyBand?: string;
  cefrLevel?: string;
  isVerb: boolean;
  audioUkPath?: string;
  audioUsPath?: string;
  examTags: string[];
  /** 软删标志：公开列表恒为 true，管理后台可见 false */
  isActive: boolean;
}

/** 词条详情视图 */
export interface WordDetailView extends WordListView {
  frequencyRank?: number;
  source: string;
  createdAt: string;
}

/** 例句视图 */
export interface SentenceView {
  id: number;
  text: string;
  translationZh?: string;
  speakerRole?: string;
  sourceKind: string;
  wordCount: number;
  charCount: number;
  difficulty?: string;
}

/** 单元词条视图 */
export interface UnitWordView extends WordListView {
  sortOrder: number;
  isRequired: boolean;
}

// ═══════════════════════════════════════════════════════════
// Zod schemas
// ═══════════════════════════════════════════════════════════

/** 路径/查询里的 id —— 必须收窄为正整数 */
const POSITIVE_INT = z.coerce.number().int().positive();

export const LIST_WORDS_QUERY_SCHEMA = z.object({
  page: POSITIVE_INT.optional().default(1),
  pageSize: z.coerce.number().int().positive().max(100).optional().default(20),
  search: z.string().max(64).optional(),
  pos: z.string().max(16).optional(),
  frequencyBand: z.enum(['超高', '高', '中', '低']).optional(),
  cefrLevel: z.enum(['A1', 'A2', 'B1', 'B2', 'C1', 'C2']).optional(),
  unitId: POSITIVE_INT.optional(),
  sortBy: z.enum(['frequency', 'alphabetical', 'updatedAt']).optional().default('alphabetical'),
  sortDir: z.enum(['asc', 'desc']).optional().default('asc'),
});

export const GET_SENTENCES_QUERY_SCHEMA = z.object({
  page: POSITIVE_INT.optional().default(1),
  pageSize: z.coerce.number().int().positive().max(50).optional().default(10),
  wordId: POSITIVE_INT.optional(),
});

export type ListWordsQuery = z.infer<typeof LIST_WORDS_QUERY_SCHEMA>;
export type GetSentencesQuery = z.infer<typeof GET_SENTENCES_QUERY_SCHEMA>;

// ═══════════════════════════════════════════════════════════
// 常量
// ═══════════════════════════════════════════════════════════

const PAGE_SIZE_MAX = 100;

// ═══════════════════════════════════════════════════════════
// Service
// ═══════════════════════════════════════════════════════════

@Injectable()
export class ContentService {
  constructor(@Inject(DbConnection) private readonly conn: DbConnection) {}

  /**
   * 词条列表（公共数据，可选搜索/过滤/分页）。
   *
   * 🔴 `includeInactive`：管理后台需要看到已停用的词条；
   *    公开列表（`content.controller.ts`）走默认分支，**只返回活跃词条**。
   *
   * 🔴 `sortDir` 修复：该参数此前被 zod 解析后从未使用（恒按升序），
   *    管理后台的「按更新时间倒序」依赖它，故在此真正生效。
   */
  async listWords(
    query: ListWordsQuery,
    options: { includeInactive?: boolean } = {},
  ): Promise<{ items: WordListView[]; total: number; page: number; pageSize: number; totalPages: number }> {
    const page = query.page;
    const pageSize = Math.min(query.pageSize, PAGE_SIZE_MAX);
    const dir = query.sortDir === 'desc' ? desc : asc;

    const conditions: SQL[] = [];

    // 搜索：headword / lemma / translationZh 模糊匹配
    if (query.search) {
      const s = `%${query.search}%`;
      conditions.push(
        or(
          ilike(word.headword, s),
          ilike(word.lemma, s),
          ilike(word.translationZh, s),
        )!,
      );
    }

    // 词性过滤
    if (query.pos) {
      conditions.push(eq(word.pos, query.pos));
    }

    // 词频分级过滤
    if (query.frequencyBand) {
      conditions.push(eq(word.frequencyBand, query.frequencyBand));
    }

    // CEFR 等级过滤
    if (query.cefrLevel) {
      conditions.push(eq(word.cefrLevel, query.cefrLevel));
    }

    // 仅活跃词条（管理后台可显式要求包含停用项）
    if (!options.includeInactive) {
      conditions.push(eq(word.isActive, true));
    }

    // 按单元过滤：通过 word_unit 联表
    if (query.unitId) {
      conditions.push(eq(wordUnit.unitId, query.unitId));
    }

    const where = and(...conditions);

    // 排序（`sortDir` 对主排序键生效，二级键恒升序保证分页稳定）
    let orderBy: SQL[];
    if (query.sortBy === 'frequency') {
      orderBy = [dir(word.frequencyRank), asc(word.headword)];
    } else if (query.sortBy === 'updatedAt') {
      orderBy = [dir(word.updatedAt), asc(word.headword)];
    } else {
      orderBy = [dir(word.headword), asc(word.pos)];
    }

    // 先查总数
    const countRows = await this.conn.db
      .select({ total: count() })
      .from(word)
      .leftJoin(wordUnit, eq(word.id, wordUnit.wordId))
      .where(where)
      .limit(1);
    const total = countRows[0]?.total ?? 0;
    const totalPages = Math.max(1, Math.ceil(total / pageSize));

    // 分页查询
    const rows = await this.conn.db
      .select({
        id: word.id,
        headword: word.headword,
        lemma: word.lemma,
        phoneticUk: word.phoneticUk,
        phoneticUs: word.phoneticUs,
        pos: word.pos,
        translationZh: word.translationZh,
        definitionEn: word.definitionEn,
        frequencyBand: word.frequencyBand,
        cefrLevel: word.cefrLevel,
        isVerb: word.isVerb,
        audioUkPath: word.audioUkPath,
        audioUsPath: word.audioUsPath,
        examTags: word.examTags,
        isActive: word.isActive,
        sortOrder: wordUnit.sortOrder,
        isRequired: wordUnit.isRequired,
      })
      .from(word)
      .leftJoin(wordUnit, eq(word.id, wordUnit.wordId))
      .where(where)
      .orderBy(...orderBy)
      .limit(pageSize)
      .offset((page - 1) * pageSize);

    const items = rows.map((row) => ({
      id: row.id,
      headword: row.headword,
      lemma: row.lemma,
      phoneticUk: row.phoneticUk ?? undefined,
      phoneticUs: row.phoneticUs ?? undefined,
      pos: row.pos ?? undefined,
      translationZh: row.translationZh,
      definitionEn: row.definitionEn ?? undefined,
      frequencyBand: row.frequencyBand ?? undefined,
      cefrLevel: row.cefrLevel ?? undefined,
      isVerb: row.isVerb,
      audioUkPath: row.audioUkPath ?? undefined,
      audioUsPath: row.audioUsPath ?? undefined,
      examTags: row.examTags ?? [],
      isActive: row.isActive,
    }));

    return { items, total, page, pageSize, totalPages };
  }

  /** 词条详情（公共数据） */
  async getWordById(id: number): Promise<WordDetailView> {
    const rows = await this.conn.db
      .select({
        id: word.id,
        headword: word.headword,
        lemma: word.lemma,
        phoneticUk: word.phoneticUk,
        phoneticUs: word.phoneticUs,
        pos: word.pos,
        translationZh: word.translationZh,
        definitionEn: word.definitionEn,
        frequencyBand: word.frequencyBand,
        frequencyRank: word.frequencyRank,
        cefrLevel: word.cefrLevel,
        isVerb: word.isVerb,
        audioUkPath: word.audioUkPath,
        audioUsPath: word.audioUsPath,
        examTags: word.examTags,
        isActive: word.isActive,
        source: word.source,
        createdAt: word.createdAt,
      })
      .from(word)
      .where(and(eq(word.id, id), eq(word.isActive, true)))
      .limit(1);

    const row = rows[0];
    if (row === undefined) {
      throw notFoundError(ErrorCode.WORD_NOT_FOUND, '词条不存在');
    }

    return {
      id: row.id,
      headword: row.headword,
      lemma: row.lemma,
      phoneticUk: row.phoneticUk ?? undefined,
      phoneticUs: row.phoneticUs ?? undefined,
      pos: row.pos ?? undefined,
      translationZh: row.translationZh,
      definitionEn: row.definitionEn ?? undefined,
      frequencyBand: row.frequencyBand ?? undefined,
      cefrLevel: row.cefrLevel ?? undefined,
      isVerb: row.isVerb,
      audioUkPath: row.audioUkPath ?? undefined,
      audioUsPath: row.audioUsPath ?? undefined,
      examTags: row.examTags ?? [],
      isActive: row.isActive,
      frequencyRank: row.frequencyRank ?? undefined,
      source: row.source,
      createdAt: row.createdAt.toISOString(),
    };
  }

  /** 例句列表（公共数据，可选按词条过滤） */
  async listSentences(query: GetSentencesQuery): Promise<{ items: SentenceView[]; total: number; page: number; pageSize: number; totalPages: number }> {
    const page = query.page;
    const pageSize = Math.min(query.pageSize, 50);

    const conditions: SQL[] = [];

    if (query.wordId) {
      // 通过 word_unit 和 sentence_unit 找不到直接关联，
      // 实际上例句与词条的关联不是直接外键，而是通过语义关联。
      // 简化处理：例句列表不直接按 wordId 过滤，而是返回所有例句。
      // 如需按词条关联例句，应通过 contentJson 中的 wordId 字段匹配。
      // 这里先返回分页例句列表。
    }

    const where = conditions.length > 0 ? and(...conditions) : undefined;

    const countRows = await this.conn.db
      .select({ total: count() })
      .from(sentence)
      .where(where)
      .limit(1);
    const total = countRows[0]?.total ?? 0;
    const totalPages = Math.max(1, Math.ceil(total / pageSize));

    const rows = await this.conn.db
      .select({
        id: sentence.id,
        text: sentence.text,
        translationZh: sentence.translationZh,
        speakerRole: sentence.speakerRole,
        sourceKind: sentence.sourceKind,
        wordCount: sentence.wordCount,
        charCount: sentence.charCount,
        difficulty: sentence.difficulty,
      })
      .from(sentence)
      .where(where)
      .orderBy(asc(sentence.id))
      .limit(pageSize)
      .offset((page - 1) * pageSize);

    const items = rows.map((row) => ({
      id: row.id,
      text: row.text,
      translationZh: row.translationZh ?? undefined,
      speakerRole: row.speakerRole ?? undefined,
      sourceKind: row.sourceKind,
      wordCount: row.wordCount,
      charCount: row.charCount,
      difficulty: row.difficulty !== null ? row.difficulty.toString() : undefined,
    }));

    return { items, total, page, pageSize, totalPages };
  }

  /** 某词条的例句（通过例句文本中包含该词条来匹配） */
  async getWordExamples(wordId: number): Promise<SentenceView[]> {
    // 先取词条信息
    const [wordRow] = await this.conn.db
      .select({ headword: word.headword, lemma: word.lemma })
      .from(word)
      .where(and(eq(word.id, wordId), eq(word.isActive, true)))
      .limit(1);

    if (wordRow === undefined) {
      throw notFoundError(ErrorCode.WORD_NOT_FOUND, '词条不存在');
    }

    const searchStr = `%${wordRow.lemma}%`;

    const rows = await this.conn.db
      .select({
        id: sentence.id,
        text: sentence.text,
        translationZh: sentence.translationZh,
        speakerRole: sentence.speakerRole,
        sourceKind: sentence.sourceKind,
        wordCount: sentence.wordCount,
        charCount: sentence.charCount,
        difficulty: sentence.difficulty,
      })
      .from(sentence)
      .where(ilike(sentence.text, searchStr))
      .orderBy(asc(sentence.id))
      .limit(10);

    return rows.map((row) => ({
      id: row.id,
      text: row.text,
      translationZh: row.translationZh ?? undefined,
      speakerRole: row.speakerRole ?? undefined,
      sourceKind: row.sourceKind,
      wordCount: row.wordCount,
      charCount: row.charCount,
      difficulty: row.difficulty !== null ? row.difficulty.toString() : undefined,
    }));
  }

  /** 单元内的词条列表（公共数据） */
  async listWordsByUnit(unitId: number): Promise<UnitWordView[]> {
    const rows = await this.conn.db
      .select({
        id: word.id,
        headword: word.headword,
        lemma: word.lemma,
        phoneticUk: word.phoneticUk,
        phoneticUs: word.phoneticUs,
        pos: word.pos,
        translationZh: word.translationZh,
        definitionEn: word.definitionEn,
        frequencyBand: word.frequencyBand,
        cefrLevel: word.cefrLevel,
        isVerb: word.isVerb,
        audioUkPath: word.audioUkPath,
        audioUsPath: word.audioUsPath,
        examTags: word.examTags,
        isActive: word.isActive,
        sortOrder: wordUnit.sortOrder,
        isRequired: wordUnit.isRequired,
      })
      .from(wordUnit)
      .innerJoin(word, eq(wordUnit.wordId, word.id))
      .where(and(eq(wordUnit.unitId, unitId), eq(word.isActive, true)))
      .orderBy(asc(wordUnit.sortOrder));

    return rows.map((row) => ({
      id: row.id,
      headword: row.headword,
      lemma: row.lemma,
      phoneticUk: row.phoneticUk ?? undefined,
      phoneticUs: row.phoneticUs ?? undefined,
      pos: row.pos ?? undefined,
      translationZh: row.translationZh,
      definitionEn: row.definitionEn ?? undefined,
      frequencyBand: row.frequencyBand ?? undefined,
      cefrLevel: row.cefrLevel ?? undefined,
      isVerb: row.isVerb,
      audioUkPath: row.audioUkPath ?? undefined,
      audioUsPath: row.audioUsPath ?? undefined,
      examTags: row.examTags ?? [],
      isActive: row.isActive,
      sortOrder: row.sortOrder,
      isRequired: row.isRequired,
    }));
  }
}
