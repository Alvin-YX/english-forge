/**
 * 语音域 —— 03 文档 §4.2.7 / §4.2.8
 *
 * 覆盖表：`recording` / `pronunciation_score` / `phone_score` / `word_weakness`
 *
 * 🔴 本文件含两处架构评审确认的文档缺陷修正：
 *   1. `phone_score` 补 `word_id`（缺陷 1）—— 缺了它 `word_weakness` 视图建不出来
 *   2. `word_weakness` 唯一索引改为 `(user_id, word_id)`（缺陷 4）
 *      —— 03 文档写的 `p_word_id_alias` 列在视图里根本不存在
 */

import { SCORE_FORMULA_VERSION, SCORE_WEIGHTS } from '@eng-forge/contracts/enums';
import { RecordingStatus } from '@eng-forge/contracts/types';
import { sql } from 'drizzle-orm';
import {
  bigint,
  boolean,
  index,
  integer,
  json,
  numeric,
  pgTable,
  smallint,
  text,
  timestamp,
  uniqueIndex,
  varchar,
} from 'drizzle-orm/pg-core';


import { word } from './content.js';
import { learningRecord } from './learning.js';
import { user } from './user.js';

// ═══════════════════════════════════════════════════════════
// recording
// ═══════════════════════════════════════════════════════════

/** 容器/编码格式 */
export const RECORDING_FORMATS = ['webm_opus', 'mp4_aac', 'wav', 'ogg'] as const;
export type RecordingFormat = (typeof RECORDING_FORMATS)[number];

/** 音频质量标记（§4.2.7 CHECK）—— 质量门禁（04 文档 §5.6.1 规则②）的落库依据 */
export const QUALITY_FLAGS = [
  'ok',
  'too_quiet',
  'too_loud',
  'noisy',
  'too_short',
  'silence',
] as const;
export type QualityFlag = (typeof QUALITY_FLAGS)[number];

/** 录音来源 */
export const RECORDING_ORIGINS = [
  'shadowing',
  'dictation',
  'dialogue',
  'roleplay',
  'upload',
] as const;
export type RecordingOrigin = (typeof RECORDING_ORIGINS)[number];

/** 录音文件元数据（文件本体在 media 卷，DB 只存元数据 + sha256） */
export const recording = pgTable(
  'recording',
  {
    id: bigint('id', { mode: 'number' })
      .primaryKey()
      .generatedAlwaysAsIdentity(),
    userId: bigint('user_id', { mode: 'number' })
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    /** media/recordings/{uid}/{yyyy}/{mm}/{uuid}.webm */
    filePath: varchar('file_path', { length: 255 }).notNull(),
    fmt: varchar('fmt', { length: 16 }).$type<RecordingFormat>().notNull(),
    durationMs: integer('duration_ms').notNull(),
    sizeBytes: integer('size_bytes').notNull(),
    sampleRate: integer('sample_rate').notNull().default(16000),
    channels: smallint('channels').notNull().default(1),
    /** 去重与完整性 */
    sha256: varchar('sha256', { length: 64 }).notNull(),
    /** 峰值电平（检测过曝/无声） */
    peakDbfs: numeric('peak_dbfs', { precision: 5, scale: 2 }),
    /** 信噪比（质量门禁） */
    snrDb: numeric('snr_db', { precision: 5, scale: 2 }),
    qualityFlag: varchar('quality_flag', { length: 16 }).$type<QualityFlag>().notNull().default('ok'),

    // ── 处理流水线状态（contracts `RecordingStatus`，SSE 进度源）──
    status: varchar('status', { length: 16 })
      .$type<RecordingStatus>()
      .notNull()
      .default(RecordingStatus.PENDING),
    /** 评分期间存在的临时 wav（任务结束即删，不长期保留） */
    wavPath: varchar('wav_path', { length: 255 }),
    /** 参考文本（跟读/听写的目标句） */
    refText: text('ref_text'),
    /** ASR 转写结果 */
    transcript: text('transcript'),

    origin: varchar('origin', { length: 16 }).$type<RecordingOrigin>().notNull().default('shadowing'),
    /** 保留到期时间（speech 错误样本 7 天 / 普通录音 30 天，contracts `Recording`） */
    retainUntil: timestamp('retain_until', { withTimezone: true }),
    /** 是否为错误样本（错误样本 7 天，普通 30 天） */
    isErrorSample: boolean('is_error_sample').notNull().default(false),
    /** 软删，GC 任务处理 */
    isDeleted: boolean('is_deleted').notNull().default(false),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
  },
  (t) => [
    // §4.2.7：UNIQUE (sha256, user_id) —— 同一用户同一音频不重复入库
    uniqueIndex('uq_recording_sha_user').on(t.sha256, t.userId),
    index('idx_rec_user_time').on(t.userId, t.createdAt),
    // §4.3「录音 GC」：部分索引
    index('idx_rec_gc')
      .on(t.isDeleted, t.deletedAt)
      .where(sql`${t.isDeleted}`),
    // 流水线轮询（§5.3 `GET /records/:id/events` 的服务端状态源）
    index('idx_rec_status').on(t.status, t.createdAt),
    // 到期回收扫描
    index('idx_rec_retain').on(t.retainUntil),
  ],
);

// ═══════════════════════════════════════════════════════════
// pronunciation_score
// ═══════════════════════════════════════════════════════════

/**
 * 发音评分结果（音素级明细的父表）。
 *
 * ⚠️ 字段名说明：03 文档 §4.2.8 用 `record_id` 指向 `learning_record(id)`
 *    （不是指向 `recording`）—— 命名容易误解，但语义是「本次练习记录」。
 *    **保留文档原名**以免下游模块误改，`recording_id` 才是录音文件外键。
 */
export const pronunciationScore = pgTable(
  'pronunciation_score',
  {
    id: bigint('id', { mode: 'number' })
      .primaryKey()
      .generatedAlwaysAsIdentity(),
    /** FK → learning_record(id)（文档原名，勿改） */
    recordId: bigint('record_id', { mode: 'number' })
      .notNull()
      .references(() => learningRecord.id, { onDelete: 'cascade' }),
    /** 关联录音（便于按文件回溯评分） */
    recordingId: bigint('recording_id', { mode: 'number' }).references(() => recording.id, {
      onDelete: 'set null',
    }),
    userId: bigint('user_id', { mode: 'number' })
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    /** 参考文本 */
    refText: text('ref_text').notNull(),
    /** ASR 实际转写 */
    asrText: text('asr_text'),

    // ── 分数 0~100 ─────────────────────────────────────────
    /** 🔴 低置信时可为 NULL（04 文档 §5.6.1 规则③「宁可少给，不可给错」） */
    totalScore: numeric('total_score', { precision: 5, scale: 2 }),
    accuracy: numeric('accuracy', { precision: 5, scale: 2 }).notNull(),
    fluency: numeric('fluency', { precision: 5, scale: 2 }).notNull(),
    completeness: numeric('completeness', { precision: 5, scale: 2 }).notNull(),
    /** profile: prosody 时非空 */
    prosody: numeric('prosody', { precision: 5, scale: 2 }),
    /** 宽标准分（降级级别 B 时同时给出，§5.6.3） */
    wideScaleScore: numeric('wide_scale_score', { precision: 5, scale: 2 }),
    /** DTW 声学距离（0~100，越小越像） */
    acousticDistance: numeric('acoustic_distance', { precision: 5, scale: 2 }),
    phonemeErrorRate: numeric('phoneme_error_rate', { precision: 5, scale: 4 }).notNull(),
    wordErrorRate: numeric('word_error_rate', { precision: 5, scale: 4 }).notNull(),
    wordCount: smallint('word_count').notNull().default(0),

    // ── 评分口径可追溯（§4.2.8）────────────────────────────
    /** 版本号；任何影响分数的改动必须 bump（§8.4 质量门禁） */
    formulaVersion: varchar('formula_version', { length: 16 })
      .notNull()
      .default(SCORE_FORMULA_VERSION),
    /** 权重快照 {acoustic,per,wer} —— 调权重不影响历史数据 */
    weightJson: json('weight_json')
      .notNull()
      .default(sql`'{"acoustic":0.3,"per":0.4,"wer":0.3}'::json`),

    /** whisper:base-int8+w2v2-lv60+espeak-ng1.51 */
    engine: varchar('engine', { length: 64 }).notNull(),
    /** {asr,align,phone,score,total} */
    latencyJson: json('latency_json'),
    /** 整体置信度 0~1（低于门限不给总分） */
    confidence: numeric('confidence', { precision: 5, scale: 4 }),
    /** 同一录音重复评分 */
    isCached: boolean('is_cached').notNull().default(false),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('idx_ps_user_time').on(t.userId, t.createdAt),
    index('idx_ps_record').on(t.recordId),
    // 外键字段必建索引（§4 全局约定）
    index('idx_ps_recording').on(t.recordingId),
  ],
);

// ═══════════════════════════════════════════════════════════
// phone_score（🔴 缺陷修正 1：补 word_id）
// ═══════════════════════════════════════════════════════════

/**
 * 音素级明细（逐词逐音素，便于前端着色与「单词复盘找弱点」）。
 *
 * 🔴 缺陷修正 1 —— 03 文档 §4.2.8 的建表 SQL **没有 `word_id`**，
 *    只有 `word_text`。但紧随其后的 `word_weakness` 物化视图要
 *    `SELECT ... p.word_id ... GROUP BY r.user_id, p.word_id, p.word_text`，
 *    照抄文档会直接建表/建视图失败。
 *    → 补 `word_id BIGINT REFERENCES word(id) ON DELETE SET NULL`。
 *
 *    语义：跟读音频的每个词都来自教材词条，**一定能对齐**；
 *    对齐失败（用户自由发挥/新词）时置 NULL，弱点聚合会跳过该行
 *    （`word_weakness` 的 `HAVING attempts >= 3` 本身也会滤掉零散数据）。
 */
export const phoneScore = pgTable(
  'phone_score',
  {
    id: bigint('id', { mode: 'number' })
      .primaryKey()
      .generatedAlwaysAsIdentity(),
    scoreId: bigint('score_id', { mode: 'number' })
      .notNull()
      .references(() => pronunciationScore.id, { onDelete: 'cascade' }),
    /** 🔴 本次补齐：与教材词条的关联（ON DELETE SET NULL 保留历史评分） */
    wordId: bigint('word_id', { mode: 'number' }).references(() => word.id, {
      onDelete: 'set null',
    }),
    wordIndex: smallint('word_index').notNull(),
    wordText: varchar('word_text', { length: 64 }).notNull(),
    wordScore: numeric('word_score', { precision: 5, scale: 2 }).notNull(),
    charStart: integer('char_start'),
    charEnd: integer('char_end'),
    isSubstitution: boolean('is_substitution').notNull().default(false),
    isDeletion: boolean('is_deletion').notNull().default(false),
    isInsertion: boolean('is_insertion').notNull().default(false),
    /** [{i,expected,actual,op,conf,start,end,type}] */
    phonesJson: json('phones_json').notNull(),
    wordAcousticDistance: numeric('word_acoustic_distance', { precision: 5, scale: 2 }),
  },
  (t) => [
    // §4.2.8：UNIQUE (score_id, word_index)
    uniqueIndex('uq_phone_score_score_index').on(t.scoreId, t.wordIndex),
    index('idx_phone_score_score').on(t.scoreId, t.wordIndex),
    // 🔴 弱点聚合的驱动列：按 word_id 反查明细（缺陷 4 的索引依赖此列）
    index('idx_phone_score_word').on(t.wordId),
  ],
);

// ═══════════════════════════════════════════════════════════
// word_weakness（🔴 缺陷修正 4：唯一索引列名）
// ═══════════════════════════════════════════════════════════

/**
 * 单词复盘聚合（对齐 `echoic` 的「汇总所有练习中的单词准确度找弱点」）。
 *
 * 🔴 缺陷修正 4 —— 03 文档 §4.2.8 末尾写的是
 *    `CREATE UNIQUE INDEX idx_ww_key ON word_weakness (user_id, p_word_id_alias)`
 *    而 `p_word_id_alias` **这列在视图里根本不存在**（视图只 SELECT 出
 *    `user_id / word_id / word_text / avg_word_score / attempts / substitutions`）。
 *    照抄必然报「列不存在」。
 *    → 改为 `CREATE UNIQUE INDEX idx_ww_key ON word_weakness (user_id, word_id)`。
 *
 * 双方言实现（§4.4）：
 * - PG：物化视图 + 每日 `REFRESH MATERIALIZED VIEW CONCURRENTLY`
 *   （CONCURRENTLY 要求有唯一索引，正好由上面这条提供）
 * - SQLite：普通表 + 每日 UPSERT（无物化视图，dialect.ts materializedView=false）
 *
 * 本文件用 `pgTable` 描述其**结构**；PG 侧真实对象由
 * `migrations/0000_init.sql` 手工建成 `MATERIALIZED VIEW`，
 * SQLite 侧由 `migrations-sqlite/0000_init.sql` 建成普通表。
 * 结构必须与本定义保持一致（字段名/类型），故在此导出类型供两端共用。
 */
export const wordWeakness = pgTable(
  'word_weakness',
  {
    userId: bigint('user_id', { mode: 'number' })
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    /** 🔴 来自 phone_score.word_id（可能为 NULL → 对齐失败的词不计入） */
    wordId: bigint('word_id', { mode: 'number' })
      .notNull()
      .references(() => word.id, { onDelete: 'cascade' }),
    wordText: varchar('word_text', { length: 64 }).notNull(),
    /** AVG(word_score) */
    avgWordScore: numeric('avg_word_score', { precision: 5, scale: 2 }).notNull(),
    attempts: integer('attempts').notNull(),
    substitutions: integer('substitutions').notNull().default(0),
  },
  (t) => [
    // 🔴 缺陷修正 4：唯一索引 (user_id, word_id)
    uniqueIndex('idx_ww_key').on(t.userId, t.wordId),
    // §4.3「弱点词（跟读）」：ORDER BY avg_word_score ASC LIMIT 20
    index('idx_ww_user_score').on(t.userId, t.avgWordScore),
  ],
);

/**
 * `word_weakness` 聚合 SQL（PG 物化视图 / SQLite 每日 UPSERT 共用同一份逻辑）。
 *
 * `HAVING COUNT(*) >= 3`：至少 3 次尝试才认定为「弱点」，
 * 避免一次失误就进弱点榜打击孩子（04 文档 §5.6.2 风险链路的直接对策）。
 *
 * ⚠️ `word_id IS NOT NULL` 过滤：对齐失败的词不参与聚合，
 *    否则 `(user_id, word_id)` 唯一索引会因多条 NULL 行在 SQLite 下无法去重。
 */
export const WORD_WEAKNESS_AGGREGATE_SQL = `
SELECT r.user_id                AS user_id,
       p.word_id                AS word_id,
       p.word_text              AS word_text,
       AVG(p.word_score)        AS avg_word_score,
       COUNT(*)                 AS attempts,
       SUM(CASE WHEN p.is_substitution THEN 1 ELSE 0 END) AS substitutions
FROM phone_score p
JOIN pronunciation_score s ON s.id = p.score_id
JOIN learning_record r      ON r.id = s.record_id
WHERE p.word_id IS NOT NULL
GROUP BY r.user_id, p.word_id, p.word_text
HAVING COUNT(*) >= 3
`.trim();

/** 弱点榜最小样本数（`HAVING` 阈值，集中定义避免 SQL 与文档漂移） */
export const WEAKNESS_MIN_ATTEMPTS = 3;

export type RecordingRow = typeof recording.$inferSelect;
export type PronunciationScoreRow = typeof pronunciationScore.$inferSelect;
export type PhoneScoreRow = typeof phoneScore.$inferSelect;
export type WordWeaknessRow = typeof wordWeakness.$inferSelect;

/** 评分权重默认值（与 contracts `SCORE_WEIGHTS` 同源，避免各处重复字面量） */
export const DEFAULT_SCORE_WEIGHTS = SCORE_WEIGHTS;
