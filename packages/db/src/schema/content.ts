/**
 * 词条与例句 —— 03 文档 §4.2.3
 *
 * 覆盖表：`word` / `word_unit` / `sentence` / `sentence_unit`
 *
 * 🔴 版权红线（04 文档 §9.3 + contracts `WordEntry`）：
 *   1. `word` 强制 `license` + `source`（+ 本次补的 `source_url`）
 *   2. **schema 中无「课文」实体** —— 从数据结构上杜绝教材课文分发
 *   3. `sentence` 只存例句/ dialogue 原子句，教材原音路径由用户自备
 */

import { type FrequencyBand } from '@eng-forge/contracts/enums';
import {
  bigint,
  index,
  integer,
  json,
  numeric,
  pgTable,
  primaryKey,
  real,
  smallint,
  text,
  timestamp,
  uniqueIndex,
  varchar,
} from 'drizzle-orm/pg-core';

import { boolColumn, jsonDefaultSql, textArrayDefaultSql } from '../dialect.js';


import { unit } from './taxonomy.js';

// ═══════════════════════════════════════════════════════════
// word
// ═══════════════════════════════════════════════════════════

/** 词条来源（§4.2.3 CHECK） */
export const WORD_SOURCES = ['builtin', 'ecdict', 'import', 'user'] as const;
export type WordSource = (typeof WORD_SOURCES)[number];

/** 考试标签（ECDICT tag 字段，§4.2.3 `exam_tags`） */
export const EXAM_TAGS = [
  'zk',
  'gk',
  'cet4',
  'cet6',
  'ky',
  'toefl',
  'ielts',
  'gre',
  'gmat',
  'sat',
  'bec',
] as const;
export type ExamTag = (typeof EXAM_TAGS)[number];

/** CEFR 等级 A1~C2 */
export const CEFR_LEVELS = ['A1', 'A2', 'B1', 'B2', 'C1', 'C2'] as const;
export type CefrLevel = (typeof CEFR_LEVELS)[number];

/**
 * 词条表（`DictionarySource(1)─(N)Word` 的合并后唯一词表）。
 *
 * 🔴 缺陷修正 1/5：原 03 文档 §4.2.3 的 `word` 表只有 `source` 没有 `license`，
 *    与 04 文档 §9.3「WordEntry schema 强制 license + source」冲突。
 *    → 补 `license VARCHAR(64) NOT NULL` + `source_url VARCHAR(255)`。
 *    NOT NULL 是刻意的：没有许可信息的内容不允许入库，从写入层拦住版权风险。
 */
export const word = pgTable(
  'word',
  {
    id: bigint('id', { mode: 'number' })
      .primaryKey()
      .generatedAlwaysAsIdentity(),
    /** 显示词形 apple */
    headword: varchar('headword', { length: 64 }).notNull(),
    /** 词元（去 -s/-ed/-ing） */
    lemma: varchar('lemma', { length: 64 }).notNull(),
    /** IPA，如 /ˈæpl/ */
    phoneticUk: varchar('phonetic_uk', { length: 64 }),
    phoneticUs: varchar('phonetic_us', { length: 64 }),
    /** n/v/adj/adv */
    pos: varchar('pos', { length: 16 }),
    /** 中文释义（分义项） */
    translationZh: text('translation_zh').notNull(),
    definitionEn: text('definition_en'),
    /** 词频序（越小越常用） */
    frequencyRank: integer('frequency_rank'),
    /** 词频分级（超高/高/中/低，精华特性 #9）—— 🔶 03 文档未落列，按 contracts 补齐 */
    frequencyBand: varchar('frequency_band', { length: 8 }).$type<FrequencyBand>(),
    /** [PG] {zk,gk,cet4,...}；SQLite 存 JSON 数组字符串（dialect.ts textArray） */
    examTags: text('exam_tags').array().default(textArrayDefaultSql()),
    /** 教材/自备音频（可空） */
    audioUkPath: varchar('audio_uk_path', { length: 255 }),
    audioUsPath: varchar('audio_us_path', { length: 255 }),
    cefrLevel: varchar('cefr_level', { length: 2 }).$type<CefrLevel>(),
    /** 默写判分是否需变形 */
    isVerb: boolColumn('is_verb').notNull().default(false),
    /** {past:'went',pp:'gone',plural:'geese'} */
    irregularForms: json('irregular_forms').notNull().default(jsonDefaultSql()),
    /** [PG] 可选，LLM 出题去重用（默认 NULL）；SQLite 存 BLOB */
    embedding: real('embedding').array(),
    source: varchar('source', { length: 32 }).$type<WordSource>().notNull().default('builtin'),

    // ── 🔴 版权追踪（04 文档 §9.3，缺陷修正 5）────────────────
    /** 内容许可标识（如 `ecdict-1.0` / `user-owned` / `cc-by-4.0`）—— NOT NULL */
    license: varchar('license', { length: 64 }).notNull(),
    /** 原始来源 URL / 文件出处，便于追溯与下架 */
    sourceUrl: varchar('source_url', { length: 255 }),

    isActive: boolColumn('is_active').notNull().default(true),
    /** [PG] FTS：headword + translation_zh + definition_en；SQLite 走 word_fts 虚拟表 */
    searchTsv: text('search_tsv'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    // §4.2.3：UNIQUE (lemma, pos)
    uniqueIndex('uq_word_lemma_pos').on(t.lemma, t.pos),
    index('idx_word_lemma').on(t.lemma),
    index('idx_word_freq').on(t.frequencyRank),
    index('idx_word_headword').on(t.headword),
    // 外键/被引用字段：word_unit.word_id、word_mastery.word_id、error_book.word_id
    // 均建索引（§4 全局约定「外键字段必建索引」）
  ],
);

// ═══════════════════════════════════════════════════════════
// word_unit
// ═══════════════════════════════════════════════════════════

/** 教材归属（一个词出现在多个单元） */
export const wordUnit = pgTable(
  'word_unit',
  {
    id: bigint('id', { mode: 'number' })
      .primaryKey()
      .generatedAlwaysAsIdentity(),
    unitId: bigint('unit_id', { mode: 'number' })
      .notNull()
      .references(() => unit.id, { onDelete: 'cascade' }),
    wordId: bigint('word_id', { mode: 'number' })
      .notNull()
      .references(() => word.id, { onDelete: 'cascade' }),
    sortOrder: smallint('sort_order').notNull(),
    /** 必学/选学 */
    isRequired: boolColumn('is_required').notNull().default(true),
  },
  (t) => [
    uniqueIndex('uq_word_unit_unit_word').on(t.unitId, t.wordId),
    index('idx_word_unit_word').on(t.wordId),
    index('idx_word_unit_unit').on(t.unitId, t.sortOrder),
  ],
);

// ═══════════════════════════════════════════════════════════
// sentence
// ═══════════════════════════════════════════════════════════

/** 例句角色（教材对话 Man:/Woman: 标记，精华特性 #20） */
export const SPEAKER_ROLES = ['man', 'woman', 'narrator'] as const;
export type SpeakerRole = (typeof SPEAKER_ROLES)[number];

/** 例句来源 */
export const SENTENCE_SOURCE_KINDS = ['course', 'exam', 'ai_generated', 'user'] as const;
export type SentenceSourceKind = (typeof SENTENCE_SOURCE_KINDS)[number];

/** 例句 / 课文句子（影子跟练与听写的原子单位） */
export const sentence = pgTable(
  'sentence',
  {
    id: bigint('id', { mode: 'number' })
      .primaryKey()
      .generatedAlwaysAsIdentity(),
    text: text('text').notNull(),
    translationZh: text('translation_zh'),
    speakerRole: varchar('speaker_role', { length: 8 }).$type<SpeakerRole>(),
    /** 教材原音（用户自备） */
    audioPath: varchar('audio_path', { length: 255 }),
    sourceKind: varchar('source_kind', { length: 16 })
      .$type<SentenceSourceKind>()
      .notNull()
      .default('course'),
    /** 🔴 版权：例句同样必须可溯源（04 文档 §9.3 三层解耦的展示层输入） */
    license: varchar('license', { length: 64 }).notNull(),
    wordCount: smallint('word_count').notNull().default(0),
    charCount: smallint('char_count').notNull().default(0),
    /** 难度 0~1（由词频+句长综合打分，见 §5.4 归一化） */
    difficulty: numeric('difficulty', { precision: 3, scale: 2 }),
    /** [PG] FTS：text + translation_zh；SQLite 走 sentence_fts 虚拟表 */
    searchTsv: text('search_tsv'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    // §4.2.3：idx_sentence_search（PG 为 GIN(search_tsv)）
    index('idx_sentence_source').on(t.sourceKind),
  ],
);

// ═══════════════════════════════════════════════════════════
// sentence_unit
// ═══════════════════════════════════════════════════════════

export const sentenceUnit = pgTable(
  'sentence_unit',
  {
    sentenceId: bigint('sentence_id', { mode: 'number' })
      .notNull()
      .references(() => sentence.id, { onDelete: 'cascade' }),
    unitId: bigint('unit_id', { mode: 'number' })
      .notNull()
      .references(() => unit.id, { onDelete: 'cascade' }),
    sortOrder: smallint('sort_order').notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.sentenceId, t.unitId] }),
    index('idx_sentence_unit_unit').on(t.unitId),
  ],
);

export type WordRow = typeof word.$inferSelect;
export type NewWordRow = typeof word.$inferInsert;
export type WordUnitRow = typeof wordUnit.$inferSelect;
export type SentenceRow = typeof sentence.$inferSelect;

/** 词条列表接口的最小投影（不含 definition_en / embedding 等大字段） */
export const wordListSelect = {
  id: word.id,
  headword: word.headword,
  phoneticUk: word.phoneticUk,
  phoneticUs: word.phoneticUs,
  pos: word.pos,
  translationZh: word.translationZh,
  frequencyBand: word.frequencyBand,
  audioUkPath: word.audioUkPath,
  audioUsPath: word.audioUsPath,
} as const;

