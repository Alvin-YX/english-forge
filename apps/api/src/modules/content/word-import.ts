/**
 * ECDICT 格式 CSV 的解析与行映射（纯函数，无数据库访问）。
 *
 * 🔴 为什么把这套逻辑抽成独立模块：`apps/api/scripts/import-ecdict.mjs`
 *    在**容器每次启动时**都会跑（`ensure-starter-words.mjs` 调用它灌首装样例词库），
 *    是生产灌词的唯一存量路径 —— 改它就可能打断线上首装。而管理后台的批量导入
 *    是另一条路径（交互式、按次）。两处需要同一份解析语义，于是接受**一份拷贝的重复**，
 *    并在这里与脚本互相标注，改解析规则时必须两边同步。
 *
 * 列顺序遵循 ECDICT（skywind3000/ECDICT）：
 *   word, phonetic, definition, translation, pos, collins, oxford, tag, type, word_tags
 * 只有前 8 列参与映射（`oxford` 无对应列，`type`/`word_tags` 暂不使用）。
 *
 * 🔴 表头可选：有表头就跳过，没有就全当数据行 —— 与脚本行为一致，
 *    这样「用户拿 stardict.csv 直接传」和「拿截取的片段传」都能工作。
 */

import type { FrequencyBand } from '@eng-forge/contracts/enums';
import { EXAM_TAGS, type CefrLevel, type ExamTag } from '@eng-forge/db/schema';

/** 单次上传的 CSV 上限（行），防止把整份 43 万行的 stardict.csv 一次性 POST 上来 */
export const MAX_IMPORT_ROWS = 20_000;

/** 导入来源标识（`word.source`，`WORD_SOURCES` 枚举成员） */
export const IMPORT_SOURCE = 'import' as const;

const VALID_EXAM_TAGS = new Set<string>(EXAM_TAGS);

/** Collins 5 级难度 → 词频分级 */
const COLLINS_TO_BAND: Record<number, FrequencyBand> = {
  5: '超高',
  4: '高',
  3: '中',
  2: '低',
  1: '低',
};

/** Collins 5 级 → CEFR（近似映射，非严格学术映射，仅作排序与展示用） */
const COLLINS_TO_CEFR: Record<number, CefrLevel> = {
  5: 'C1',
  4: 'B2',
  3: 'B1',
  2: 'A2',
  1: 'A1',
};

/** 导入行的形状（不含 `source` / `license` / `sourceUrl` / `isActive` —— 由调用方统一补） */
export interface WordImportCandidate {
  headword: string;
  lemma: string;
  phoneticUk?: string;
  phoneticUs?: string;
  pos?: string;
  translationZh: string;
  definitionEn?: string;
  frequencyRank?: number;
  frequencyBand?: FrequencyBand;
  examTags: ExamTag[];
  audioUkPath?: string;
  audioUsPath?: string;
  cefrLevel?: CefrLevel;
  isVerb: boolean;
  irregularForms: Record<string, string>;
}

/** 解析结果 */
export interface WordImportParseResult {
  candidates: WordImportCandidate[];
  /** 无法解析（空词、无中文释义且无英文释义）跳过的行数 */
  skipped: number;
  /** CSV 中的数据行总数（不含表头） */
  totalRows: number;
  /** CSV 文本的行数超出 `MAX_IMPORT_ROWS`（此时 candidates 为空，需调用方报错） */
  tooManyRows: boolean;
}

// ═══════════════════════════════════════════════════════════
// CSV 解析（RFC 4180：引号 / 换行 / 转义）
// ═══════════════════════════════════════════════════════════

/**
 * 解析 RFC 4180 CSV，返回二维数组。
 *
 * ECDICT 的字段里包含英文逗号、双引号、换行符，必须正确解析。
 * 用 `csv-parse` 也行，但为了遵守 ADR-0004「后端依赖 ≤ 12」，这里用最小实现。
 */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let inQuotes = false;
  let i = 0;

  while (i < text.length) {
    const c = text[i] ?? '';

    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i += 2;
          continue;
        }
        inQuotes = false;
        i += 1;
        continue;
      }
      field += c;
      i += 1;
      continue;
    }

    if (c === '"') {
      inQuotes = true;
      i += 1;
      continue;
    }
    if (c === ',') {
      row.push(field);
      field = '';
      i += 1;
      continue;
    }
    if (c === '\r') {
      // \r\n 或 \r
      if (text[i + 1] === '\n') i += 1;
      row.push(field);
      field = '';
      rows.push(row);
      row = [];
      i += 1;
      continue;
    }
    if (c === '\n') {
      row.push(field);
      field = '';
      rows.push(row);
      row = [];
      i += 1;
      continue;
    }
    field += c;
    i += 1;
  }

  // 最后一行（无结尾换行时）
  if (field.length > 0 || row.length > 0) {
    row.push(field);
    rows.push(row);
  }

  return rows;
}

// ═══════════════════════════════════════════════════════════
// 字段规范化
// ═══════════════════════════════════════════════════════════

/**
 * 由 headword 推导 lemma（去 -s/-ed/-ing）。
 *
 * 简单启发式：小写化 + 去后缀。规则顺序很重要（先 -ies 再 -s 再 -es 再 -ed 再 -ing）。
 * 不追求学术严格性 —— 词元只做粗筛，精确词形分析留给 LLM 层。
 */
export function deriveLemma(headword: string): string {
  const w = headword.trim().toLowerCase();
  if (!w) return headword.trim();
  if (w.length < 4) return w;

  // 复数
  if (w.endsWith('ies') && w.length > 4) return w.slice(0, -3) + 'y';
  if (w.endsWith('ses')) return w.slice(0, -1);
  if (w.endsWith('xes')) return w.slice(0, -1);
  if (w.endsWith('zes')) return w.slice(0, -1);
  if (w.endsWith('ches')) return w.slice(0, -1);
  if (w.endsWith('shes')) return w.slice(0, -1);
  if (w.endsWith('s') && !w.endsWith('ss')) return w.slice(0, -1);

  // 过去式 / 过去分词
  if (w.endsWith('ied') && w.length > 5) return w.slice(0, -3) + 'y';
  if (w.endsWith('ed')) {
    const base = w.slice(0, -2);
    if (base.endsWith('e')) return base;
    if (base.endsWith('y')) return base.slice(0, -1) + 'ie';
    return base;
  }

  // 现在分词
  if (w.endsWith('ied') && w.length > 5) return w.slice(0, -3) + 'y';
  if (w.endsWith('ing')) {
    const base = w.slice(0, -3);
    if (base.endsWith('e')) return base;
    if (base.endsWith('y')) return base.slice(0, -1) + 'ie';
    return base;
  }

  return w;
}

/**
 * 从 ECDICT 的 phonetic 字段解析 UK / US 音标。
 * 常见格式：`IPA /ˈæpl/ ; US /ˈæpəl/`、`[UK] /ˈæpl/ [US] /ˈæpəl/`、或只有单个音标。
 */
export function parsePhonetic(raw: string): { uk?: string; us?: string } {
  const s = (raw ?? '').trim();
  if (!s) return {};

  if (s.startsWith('[') || s.startsWith('/')) {
    const usMatch = s.match(/;?\s*US\s*\/([^/]+)\/?\s*$/i);
    if (usMatch && usMatch[1] !== undefined) {
      return { us: `/${usMatch[1]}/` };
    }
    return { uk: s };
  }

  const usMatch = s.match(/US\s*\/([^/]+)\/?/i);
  const ukMatch = s.match(/\[?(UK)?\]?\s*\/([^/]+)\/?/i);
  const result: { uk?: string; us?: string } = {};
  if (usMatch && usMatch[1] !== undefined) result.us = `/${usMatch[1]}/`;
  if (ukMatch && ukMatch[2] !== undefined && !result.us) result.uk = `/${ukMatch[2]}/`;
  return result;
}

/** 解析 ECDICT 的 tag 字段（逗号分隔）为合法考试标签数组，非法标签直接丢弃 */
export function parseExamTags(raw: string): ExamTag[] {
  if (!raw) return [];
  return raw
    .split(',')
    .map((tag) => tag.trim().toLowerCase())
    .filter((tag): tag is ExamTag => VALID_EXAM_TAGS.has(tag));
}

/** 是否动词（用于 `is_verb` 字段，默写判分需要词形变化） */
export function isVerb(pos: string | undefined): boolean {
  if (!pos) return false;
  const p = pos.toLowerCase();
  return p.includes('v') && !p.includes('n.') && !p.includes('adj');
}

// ═══════════════════════════════════════════════════════════
// 整表解析
// ═══════════════════════════════════════════════════════════

/** 把 CSV 一行解析为 word 表的插入行候选 */
export function buildWordCandidate(row: string[]): WordImportCandidate | null {
  const [rawWord, rawPhonetic, rawDef, rawTrans, rawPos, rawCollins] = row;

  const headword = (rawWord ?? '').trim();
  if (!headword) return null;

  const lemma = deriveLemma(headword);
  const { uk: phoneticUk, us: phoneticUs } = parsePhonetic(rawPhonetic ?? '');
  const pos = (rawPos ?? '').trim() || undefined;
  const collins = rawCollins ? Number(rawCollins) : undefined;
  const examTags = parseExamTags((row[7] ?? '').trim());

  let translationZh = (rawTrans ?? '').trim();
  if (!translationZh) {
    // ECDICT 某些行只有英文释义没有中文 —— 用 definition 兜底
    const def = (rawDef ?? '').trim();
    if (!def) return null;
    translationZh = def;
  }

  return {
    headword,
    lemma,
    phoneticUk,
    phoneticUs,
    pos,
    translationZh,
    definitionEn: (rawDef ?? '').trim() || undefined,
    frequencyRank: undefined,
    frequencyBand: collins ? COLLINS_TO_BAND[collins] : undefined,
    examTags,
    audioUkPath: undefined,
    audioUsPath: undefined,
    cefrLevel: collins ? COLLINS_TO_CEFR[collins] : undefined,
    isVerb: isVerb(pos),
    irregularForms: {},
  };
}

/**
 * 解析整份 CSV 文本为导入候选。
 *
 * 🔴 幂等由调用方负责（`(lemma, pos)` 唯一约束 + `onConflictDoNothing`），
 *    本函数只保证**语义正确**与**行数上限**。
 */
export function parseWordImport(text: string): WordImportParseResult {
  // 去 BOM：Windows 导出的 CSV 常带
  const rows = parseCsv(text.replace(/^\uFEFF/, ''));
  if (rows.length === 0) {
    return { candidates: [], skipped: 0, totalRows: 0, tooManyRows: false };
  }

  // 表头识别：含 `word` / `phonetic` 即视为表头行（与脚本一致）
  const first = rows[0] ?? [];
  const header = first.map((cell) => cell.toLowerCase().trim());
  const hasHeader = header.includes('word') || header.includes('phonetic');
  const dataRows = hasHeader ? rows.slice(1) : rows;

  if (dataRows.length > MAX_IMPORT_ROWS) {
    return { candidates: [], skipped: 0, totalRows: dataRows.length, tooManyRows: true };
  }

  const candidates: WordImportCandidate[] = [];
  let skipped = 0;

  for (const row of dataRows) {
    const built = buildWordCandidate(row);
    if (built === null) {
      skipped += 1;
      continue;
    }
    candidates.push(built);
  }

  return { candidates, skipped, totalRows: dataRows.length, tooManyRows: false };
}
