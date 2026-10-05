/**
 * 错题本与错误样本生命周期 —— 03 文档 §4.2.9
 *
 * 覆盖表：`error_book` / `error_sample` / `archive_error_sample_archive`
 *
 * 🔴 本文件含缺陷修正 2：`error_sample` 补 `word_id`（归档状态机需要它）。
 *
 * 生命周期状态机（§4.2.9，worker 每日 04:10 执行）：
 *
 * ```
 *  T+0  练习出错
 *    ├─ speak → keep_until = now()+7d ；priority = (当日错误>20 ? high : normal)
 *    └─ spell → keep_until = now()+90d；priority = (当日拼写错误>20 ? high : normal)
 *         ▼
 *  T-1d 生成站内提醒（"你的发音错误样本明天过期"）
 *         ▼
 *  T=keep_until
 *    ├─ speak → recording 软删→GC 物理删；error_sample.is_purged=true
 *    │           （error_book 记录保留，用于复盘统计）
 *    └─ spell → 移入 archive_error_sample_archive（仅 user_id/word_id/次数）
 *               error_sample.is_purged=true，error_book.is_resolved=true
 *         ▼
 *  归档保留至 90 天后再匿名化（去掉 user_id，只留词条级聚合）
 * ```
 */

import { type ErrorCategory } from '@eng-forge/contracts/enums';
import { sql } from 'drizzle-orm';
import {
  bigint,
  boolean,
  index,
  integer,
  json,
  numeric,
  pgTable,
  text,
  timestamp,
  varchar,
} from 'drizzle-orm/pg-core';


import { word, sentence } from './content.js';
import { learningRecord } from './learning.js';
import { recording } from './speech.js';
import { user } from './user.js';

/** 错题分类（§4.2.9 CHECK 比 contracts 多 listen/reading，取并集以免数据写不进去） */
export const ERROR_BOOK_CATEGORIES = ['speak', 'spell', 'grammar', 'listen', 'reading'] as const;
export type ErrorBookCategory = (typeof ERROR_BOOK_CATEGORIES)[number];

/** 错误样本分类（只 speak/spell 两种有保留期） */
export const ERROR_SAMPLE_CATEGORIES = ['speak', 'spell'] as const;
export type ErrorSampleCategory = (typeof ERROR_SAMPLE_CATEGORIES)[number];

/** 样本优先级（high = 单日错误 > 20 触发，contracts `ERROR_SAMPLE_RETENTION_DAYS`） */
export const ERROR_SAMPLE_PRIORITIES = ['normal', 'high'] as const;
export type ErrorSamplePriority = (typeof ERROR_SAMPLE_PRIORITIES)[number];

// ═══════════════════════════════════════════════════════════
// error_book
// ═══════════════════════════════════════════════════════════

/** 错题本条目（聚合后的「这道题我错过」视图，与 error_sample 的原始样本分离） */
export const errorBook = pgTable(
  'error_book',
  {
    id: bigint('id', { mode: 'number' })
      .primaryKey()
      .generatedAlwaysAsIdentity(),
    userId: bigint('user_id', { mode: 'number' })
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    category: varchar('category', { length: 16 }).$type<ErrorBookCategory>().notNull(),
    wordId: bigint('word_id', { mode: 'number' }).references(() => word.id, {
      onDelete: 'set null',
    }),
    sentenceId: bigint('sentence_id', { mode: 'number' }).references(() => sentence.id, {
      onDelete: 'set null',
    }),
    /** 原文/句子文本（word_id 为空时） */
    message: text('message'),
    wrongCount: integer('wrong_count').notNull().default(1),
    /** 连续答对次数（≥3 出清） */
    rightStreak: integer('right_streak').notNull().default(0),
    isResolved: boolean('is_resolved').notNull().default(false),
    /** 收藏（对应 echoic 收藏） */
    isFavorite: boolean('is_favorite').notNull().default(false),
    /** 出错音素（speak 类） */
    phonemeJson: json('phoneme_json'),
    lastErrorAt: timestamp('last_error_at', { withTimezone: true }).notNull().defaultNow(),
    resolvedAt: timestamp('resolved_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    // §4.3「错题本筛选」：idx_eb_user_cat
    index('idx_eb_user_cat').on(t.userId, t.category, t.isResolved),
    index('idx_eb_user_word').on(t.userId, t.wordId),
    // 外键字段必建索引（§4 全局约定）
    index('idx_eb_user_sentence').on(t.userId, t.sentenceId),
    // 收藏夹列表
    index('idx_eb_favorite').on(t.userId, t.isFavorite),
  ],
);

// ═══════════════════════════════════════════════════════════
// error_sample（🔴 缺陷修正 2：补 word_id）
// ═══════════════════════════════════════════════════════════

/**
 * 错误样本（可回放的原始记录，7 天 / 90 天策略）。
 *
 * 🔴 缺陷修正 2 —— 03 文档 §4.2.9 的建表 SQL **没有 `word_id`**，
 *    但紧随其后的生命周期状态机明确要求归档时按
 *    「仅 user_id / word_id / wrong_content / 次数」转入归档表，
 *    且 `archive_error_sample_archive` 只保留 word_id 级信息。
 *    没有 source 列的 word_id，归档表就填不出内容。
 *    → 补 `word_id BIGINT REFERENCES word(id) ON DELETE SET NULL`。
 */
export const errorSample = pgTable(
  'error_sample',
  {
    id: bigint('id', { mode: 'number' })
      .primaryKey()
      .generatedAlwaysAsIdentity(),
    userId: bigint('user_id', { mode: 'number' })
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    /** 🔴 本次补齐：归档状态机与归档表都依赖此列 */
    wordId: bigint('word_id', { mode: 'number' }).references(() => word.id, {
      onDelete: 'set null',
    }),
    recordId: bigint('record_id', { mode: 'number' }).references(() => learningRecord.id, {
      onDelete: 'cascade',
    }),
    recordingId: bigint('recording_id', { mode: 'number' }).references(() => recording.id, {
      onDelete: 'set null',
    }),
    category: varchar('category', { length: 16 }).$type<ErrorSampleCategory>().notNull(),
    priority: varchar('priority', { length: 8 })
      .$type<ErrorSamplePriority>()
      .notNull()
      .default('normal'),
    score: numeric('score', { precision: 5, scale: 2 }),
    /** 拼写类错的内容快照（90 天后仅留此，不留原文件） */
    wrongContent: text('wrong_content'),
    /** speak: +7d / spell: +90d */
    keepUntil: timestamp('keep_until', { withTimezone: true }).notNull(),
    replayCount: integer('replay_count').notNull().default(0),
    lastReplayAt: timestamp('last_replay_at', { withTimezone: true }),
    /** 到期待删 */
    purgeAt: timestamp('purge_at', { withTimezone: true }),
    isPurged: boolean('is_purged').notNull().default(false),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    // §4.3「样本到期」：部分索引
    index('idx_es_purge')
      .on(t.keepUntil)
      .where(sql`${t.isPurged} = false`),
    index('idx_es_user_cat').on(t.userId, t.category, t.createdAt),
    // 外键字段必建索引（§4 全局约定）
    index('idx_es_word').on(t.wordId),
    index('idx_es_recording').on(t.recordingId),
  ],
);

// ═══════════════════════════════════════════════════════════
// archive_error_sample_archive（🔴 文档缺陷补齐）
// ═══════════════════════════════════════════════════════════

/**
 * 拼写错误归档（`ERROR_SAMPLE_RETENTION_DAYS.SPELL` = 90 天后转入）。
 *
 * 🔴 03 文档正文与 §4.2.9 的状态机都引用了这张表，但**从未给出建表语句**，
 *    → 按状态机描述「仅 user_id/word_id/wrong_content/次数」补齐。
 *
 * 🔴 隐私设计（04 文档 §9.2）：此表**不存任何录音/音频/原始作答全文之外的内容**，
 *    且 `archived_at + 90 天` 后由 worker 执行匿名化（`user_id` 置 NULL），
 *    只留词条级聚合用于教材难度分析 —— 这是"数据最小化"的落地形态。
 */
export const archiveErrorSampleArchive = pgTable(
  'archive_error_sample_archive',
  {
    id: bigint('id', { mode: 'number' })
      .primaryKey()
      .generatedAlwaysAsIdentity(),
    /**
     * 原用户 id。🔴 归档保留 90 天后**匿名化置 NULL**（DDL 里可空，
     * 这是与其它表 `.notNull()` 的刻意差异）。
     */
    userId: bigint('user_id', { mode: 'number' }).references(() => user.id, {
      onDelete: 'set null',
    }),
    wordId: bigint('word_id', { mode: 'number' }).references(() => word.id, {
      onDelete: 'set null',
    }),
    /** 拼写错误的错误内容快照（唯一允许保留的原始内容） */
    wrongContent: text('wrong_content'),
    /** 累计错误次数（归档后仍用于词条难度统计） */
    errorCount: integer('error_count').notNull().default(1),
    /** 归档时间（原 keep_until 到期日） */
    archivedAt: timestamp('archived_at', { withTimezone: true }).notNull().defaultNow(),
    /** 匿名化执行时间（非 null 表示已完成去标识化） */
    anonymizedAt: timestamp('anonymized_at', { withTimezone: true }),
  },
  (t) => [
    // 教材难度分析：按词条聚合归档数据
    index('idx_archive_word').on(t.wordId),
    // 匿名化任务扫描
    index('idx_archive_anonymize')
      .on(t.archivedAt)
      .where(sql`${t.anonymizedAt} IS NULL`),
  ],
);

/** 归档后匿名化的等待天数（§4.2.9 状态机末行「归档保留至 90 天后再匿名化」） */
export const ARCHIVE_ANONYMIZE_AFTER_DAYS = 90;

/** `right_streak` 达到该值即出清（§4.2.9 注释「≥3 出清」） */
export const RESOLVE_RIGHT_STREAK = 3;

export type ErrorBookRow = typeof errorBook.$inferSelect;
export type ErrorSampleRow = typeof errorSample.$inferSelect;
export type ArchiveErrorSampleRow = typeof archiveErrorSampleArchive.$inferSelect;

/** 错题本与 contracts `ErrorCategory` 的交集校验用（三者语义不同，勿混用） */
export const ERROR_BOOK_CATEGORY_CONTRACT: readonly ErrorCategory[] = ['speak', 'spell', 'grammar'];
