/**
 * @eng-forge/content — 共享内容类型包
 *
 * 提供跨应用（API / Web / Python 服务）共享的词条、例句数据类型定义。
 * 当前版本为初始骨架，后续会补充 FSRS 工具函数、词频映射等。
 */

// ── 词条基本类型 ──────────────────────────────────────────
export interface WordEntry {
  id: number;
  headword: string;
  lemma: string;
  phoneticUk?: string;
  phoneticUs?: string;
  pos?: string;
  translationZh: string;
  definitionEn?: string;
  frequencyBand?: '超高' | '高' | '中' | '低';
  frequencyRank?: number;
  cefrLevel?: 'A1' | 'A2' | 'B1' | 'B2' | 'C1' | 'C2';
  isVerb: boolean;
  audioUkPath?: string;
  audioUsPath?: string;
  examTags: string[];
  source: string;
  createdAt: string;
}

// ── 例句类型 ──────────────────────────────────────────────
export interface SentenceEntry {
  id: number;
  text: string;
  translationZh?: string;
  speakerRole?: string;
  sourceKind: string;
  wordCount: number;
  charCount: number;
  difficulty?: string;
}

// ── 词性枚举 ──────────────────────────────────────────────
export const POSITIONS = ['n', 'v', 'adj', 'adv', 'prep', 'conj', 'pron', 'num', 'art', 'interj', 'modal', 'aux', 'abbr'] as const;
export type Position = (typeof POSITIONS)[number];

// ── CEFR 等级排序 ─────────────────────────────────────────
export const CEFR_LEVELS = ['A1', 'A2', 'B1', 'B2', 'C1', 'C2'] as const;
export type CefrLevel = (typeof CEFR_LEVELS)[number];

/** CEFR 等级比较（A1 < A2 < ... < C2） */
export function compareCefr(a: CefrLevel, b: CefrLevel): number {
  return CEFR_LEVELS.indexOf(a) - CEFR_LEVELS.indexOf(b);
}
