/**
 * 学习域 —— 03 文档 §4.2.4 / §4.2.5 / §4.2.6 / §4.2.10
 *
 * 覆盖表：`word_mastery` / `course` / `course_skill` / `lesson_block` /
 *        `learning_record` / `daily_stat` / `streak` / `heatmap`
 *
 * 🔴 本文件含 04 文档 §5.6.3「绝不静默降级」的落库字段：
 *    `learning_record.confidence_level` + `learning_record.degrade_level`
 *    —— 降级状态必须持久化到**每一条**记录，顶栏健康灯只是它的展示。
 */

import { type ConfidenceLevel, type RecordKind, type ScoreDegradeLevel } from '@eng-forge/contracts/enums';
import { type FsrsState } from '@eng-forge/contracts/types';
import { sql } from 'drizzle-orm';
import {
  bigint,
  date,
  index,
  integer,
  json,
  numeric,
  pgTable,
  real,
  smallint,
  text,
  timestamp,
  uniqueIndex,
  varchar,
} from 'drizzle-orm/pg-core';

import { boolColumn, jsonDefaultSql } from '../dialect.js';


import { word } from './content.js';
import { stage, unit } from './taxonomy.js';
import { user } from './user.js';

// ═══════════════════════════════════════════════════════════
// word_mastery（四维掌握度 + FSRS-6）
// ═══════════════════════════════════════════════════════════

/**
 * 词条掌握度：四维分数 + FSRS 调度状态 + 错误累计。
 * `UNIQUE (user_id, word_id)` —— 每人每词一行。
 */
export const wordMastery = pgTable(
  'word_mastery',
  {
    id: bigint('id', { mode: 'number' })
      .primaryKey()
      .generatedAlwaysAsIdentity(),
    userId: bigint('user_id', { mode: 'number' })
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    wordId: bigint('word_id', { mode: 'number' })
      .notNull()
      .references(() => word.id, { onDelete: 'cascade' }),

    // ── 四维掌握度（0~100）──────────────────────────────────
    /** 认读 */
    recognizeScore: numeric('recognize_score', { precision: 5, scale: 2 }).notNull().default('0'),
    /** 听辨 */
    listenScore: numeric('listen_score', { precision: 5, scale: 2 }).notNull().default('0'),
    /** 拼写 */
    spellScore: numeric('spell_score', { precision: 5, scale: 2 }).notNull().default('0'),
    /** 口语 */
    speakScore: numeric('speak_score', { precision: 5, scale: 2 }).notNull().default('0'),
    /** 加权综合 */
    overallScore: numeric('overall_score', { precision: 5, scale: 2 }).notNull().default('0'),

    // ── FSRS 状态 ──────────────────────────────────────────
    /** 1新 2学习中 3复习 4再学（contracts `FsrsState` 为 0~3，落库 +1 保持文档语义） */
    fsrsState: smallint('fsrs_state').notNull().default(1),
    fsrsStability: real('fsrs_stability').notNull().default(0.3),
    fsrsDifficulty: real('fsrs_difficulty').notNull().default(5.0),
    fsrsLastReview: timestamp('fsrs_last_review', { withTimezone: true }),
    /** 索引驱动「今日待复习」（§4.3 第 1 行） */
    fsrsNextReview: timestamp('fsrs_next_review', { withTimezone: true }),
    fsrsReps: integer('fsrs_reps').notNull().default(0),
    fsrsLapses: integer('fsrs_lapses').notNull().default(0),
    /** 连续 8 次失败 → 干预（leech） */
    isLeech: boolColumn('is_leech').notNull().default(false),

    // ── 错误累计 ───────────────────────────────────────────
    speakErrorCount: integer('speak_error_count').notNull().default(0),
    spellErrorCount: integer('spell_error_count').notNull().default(0),
    /** 音素错误率（拼入 FSRS 难度调整） */
    phonemeErrorRate: numeric('phoneme_error_rate', { precision: 5, scale: 4 })
      .notNull()
      .default('0'),
    totalAttempts: integer('total_attempts').notNull().default(0),
    lastPracticedAt: timestamp('last_practiced_at', { withTimezone: true }),

    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex('uq_word_mastery_user_word').on(t.userId, t.wordId),
    // §4.3「今日待复习」→ idx_wm_next_review
    index('idx_wm_next_review').on(t.userId, t.fsrsNextReview),
    // ⚠️ 03 文档 §4.2.4 的 idx_wm_weak 含 frequency_rank，但 word_mastery 无此列
    //    （frequency_rank 在 word 表）→ 建表会失败。
    //    取舍：改为 (user_id, overall_score)，词频排序由应用层 join word 补齐。
    index('idx_wm_weak').on(t.userId, t.overallScore),
    // §4.3 leech 干预：部分索引（双方言均支持 WHERE）
    index('idx_wm_leech')
      .on(t.userId)
      .where(sql`${t.isLeech}`),
  ],
);

/** contracts `FsrsState`(0~3) → DB `fsrs_state`(1~4) 的偏移换算 */
export const fsrsStateToDb = (state: FsrsState): number => state + 1;
export const fsrsStateFromDb = (db: number): FsrsState => (db - 1) as FsrsState;

// ═══════════════════════════════════════════════════════════
// course / course_skill
// ═══════════════════════════════════════════════════════════

/** 课程类型（§4.2.5 CHECK） */
export const COURSE_TYPES = [
  'word_loop',
  'shadowing',
  'dictation',
  'dialogue',
  'reading',
  'game',
  'exam',
] as const;
export type CourseType = (typeof COURSE_TYPES)[number];

/** 课程：DSL 单一来源，yaml 为准，compiled_json 为缓存 */
export const course = pgTable(
  'course',
  {
    id: bigint('id', { mode: 'number' })
      .primaryKey()
      .generatedAlwaysAsIdentity(),
    /** 如 pep-primary-g3a-wordloop */
    code: varchar('code', { length: 64 }).notNull().unique(),
    nameZh: varchar('name_zh', { length: 128 }).notNull(),
    stageId: bigint('stage_id', { mode: 'number' })
      .notNull()
      .references(() => stage.id),
    type: varchar('type', { length: 24 }).$type<CourseType>().notNull(),
    /** 内容包内相对路径（DSL 单一来源） */
    yamlPath: varchar('yaml_path', { length: 255 }).notNull(),
    /** 变更检测 */
    yamlHash: varchar('yaml_hash', { length: 64 }).notNull(),
    /** 编译后技能树（缓存） */
    compiledJson: json('compiled_json').notNull(),
    isOfficial: boolColumn('is_official').notNull().default(false),
    /** 🔴 课程包许可（04 文档 §9.3） */
    license: varchar('license', { length: 64 }).notNull(),
    createdBy: bigint('created_by', { mode: 'number' }).references(() => user.id, {
      onDelete: 'set null',
    }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('idx_course_stage_type').on(t.stageId, t.type)],
);

/** 课程技能（技能树节点） */
export const courseSkill = pgTable(
  'course_skill',
  {
    id: bigint('id', { mode: 'number' })
      .primaryKey()
      .generatedAlwaysAsIdentity(),
    courseId: bigint('course_id', { mode: 'number' })
      .notNull()
      .references(() => course.id, { onDelete: 'cascade' }),
    /** DSL 内唯一 id */
    skillId: varchar('skill_id', { length: 64 }).notNull(),
    moduleId: varchar('module_id', { length: 64 }).notNull(),
    /** 前置技能 DAG */
    prereqJson: json('prereq_json').notNull().default(jsonDefaultSql('[]')),
    type: varchar('type', { length: 24 }).$type<CourseType>().notNull(),
    sortOrder: integer('sort_order').notNull(),
    /** 题面/选项/答案（LLM 动态生成则落此） */
    contentJson: json('content_json').notNull(),
    /** {masteryMin|scoreMin|attemptsMin} */
    passRuleJson: json('pass_rule_json').notNull(),
    compiledAt: timestamp('compiled_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex('uq_course_skill_course_skill').on(t.courseId, t.skillId),
    index('idx_skill_course_sort').on(t.courseId, t.sortOrder),
  ],
);

// ═══════════════════════════════════════════════════════════
// lesson_block
// ═══════════════════════════════════════════════════════════

/** 5 词循环块的生成来源 */
export const BLOCK_GENERATORS = ['rule', 'llm'] as const;
export type BlockGenerator = (typeof BLOCK_GENERATORS)[number];

/** 5 词循环块（前端一次取 5 个，减少往返；LSB 预生成） */
export const lessonBlock = pgTable(
  'lesson_block',
  {
    id: bigint('id', { mode: 'number' })
      .primaryKey()
      .generatedAlwaysAsIdentity(),
    userId: bigint('user_id', { mode: 'number' })
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    courseId: bigint('course_id', { mode: 'number' })
      .notNull()
      .references(() => course.id, { onDelete: 'cascade' }),
    /** 第几组 5 词 */
    blockNo: integer('block_no').notNull(),
    /** 5 个 word_id */
    wordIds: json('word_ids').notNull(),
    generatedBy: varchar('generated_by', { length: 16 })
      .$type<BlockGenerator>()
      .notNull()
      .default('rule'),
    consumed: boolColumn('consumed').notNull().default(false),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex('uq_lesson_block_user_course_no').on(t.userId, t.courseId, t.blockNo),
    // 待消费块扫描（`GET /lessons/:courseId/next-block`）
    index('idx_lesson_block_pending').on(t.userId, t.courseId, t.consumed),
  ],
);

// ═══════════════════════════════════════════════════════════
// learning_record（跟读 / 听写 / 对话统一大表）
// ═══════════════════════════════════════════════════════════

/** 记录关联对象类型（§4.2.6 CHECK） */
export const REF_TYPES = ['word', 'sentence', 'skill', 'conversation', 'game'] as const;
export type RefType = (typeof REF_TYPES)[number];

/** 记录状态（§4.2.6 CHECK） */
export const RECORD_STATUSES = ['pending', 'done', 'failed', 'skipped'] as const;
export type RecordStatus = (typeof RECORD_STATUSES)[number];

/**
 * 学习记录统一大表。
 *
 * ⚠️ `kind` 列：03 文档 §4.2.6 的 CHECK 列了 10 个值
 *    （含 roleplay/dialogue/reading/game/exam_mock），
 *    而 contracts `RecordKind` 只有 8 个（用 conversation 合并了对话类）。
 *    → 取舍：落库列 CHECK 采用 **contracts 的 8 值**（跨语言契约优先），
 *    文档多出的 roleplay/dialogue/reading/game/exam_mock 语义已被
 *    `conversation` + `ref_type` 覆盖。此处偏离在迁移 SQL 注释中登记。
 *
 * 🔴 04 文档 §5.6.3：降级状态持久化到每条记录，绝不静默降级。
 */
export const learningRecord = pgTable(
  'learning_record',
  {
    id: bigint('id', { mode: 'number' })
      .primaryKey()
      .generatedAlwaysAsIdentity(),
    userId: bigint('user_id', { mode: 'number' })
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    kind: varchar('kind', { length: 24 }).$type<RecordKind>().notNull(),
    refType: varchar('ref_type', { length: 24 }).$type<RefType>().notNull(),
    refId: bigint('ref_id', { mode: 'number' }),
    courseId: bigint('course_id', { mode: 'number' }).references(() => course.id, {
      onDelete: 'set null',
    }),
    unitId: bigint('unit_id', { mode: 'number' }).references(() => unit.id, {
      onDelete: 'set null',
    }),

    // ── 判定结果 ───────────────────────────────────────────
    /** 客观题 */
    isCorrect: boolColumn('is_correct'),
    /** 主观题 0~100 */
    score: numeric('score', { precision: 5, scale: 2 }),
    accuracy: numeric('accuracy', { precision: 5, scale: 2 }),
    fluency: numeric('fluency', { precision: 5, scale: 2 }),
    completeness: numeric('completeness', { precision: 5, scale: 2 }),
    /** 韵律（perf_tier=fluid 时才有） */
    prosody: numeric('prosody', { precision: 5, scale: 2 }),
    /** 录音/答题耗时 */
    durationMs: integer('duration_ms'),
    /** 学生作答（拼写输入原文） */
    answerText: text('answer_text'),
    /** 拼写/听写 diff（绿红黄蓝四色） */
    diffJson: json('diff_json'),
    /** asr/w2v2/espeak-ng/piper + 版本 */
    engine: varchar('engine', { length: 32 }),
    /** 降级档位（引擎侧） */
    engineTier: varchar('engine_tier', { length: 16 }),
    status: varchar('status', { length: 16 }).$type<RecordStatus>().notNull().default('done'),
    /** {ua,mic,sampleRate,network} */
    clientMeta: json('client_meta'),
    errorCode: varchar('error_code', { length: 16 }),
    errorMsg: text('error_msg'),

    // ── 🔴 04 文档 §5.6「绝不静默降级」────────────────────
    /** 置信度等级（每条评分显示高/中/低，§5.5 交互 #14） */
    confidenceLevel: varchar('confidence_level', { length: 16 }).$type<ConfidenceLevel>(),
    /** 评分可靠性降级级别 A~F（§5.6.3 六级降级策略） */
    degradeLevel: varchar('degrade_level', { length: 1 }).$type<ScoreDegradeLevel>(),
    /** 低分归因（§5.6.1 规则④：只能归因环境，严禁归因孩子能力） */
    scoreAttribution: varchar('score_attribution', { length: 32 }),
    /** 评分口径版本（可追溯，调权重不影响历史数据） */
    formulaVersion: varchar('formula_version', { length: 16 }),

    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    // §4.2.6 四条索引
    index('idx_lr_user_kind_time').on(t.userId, t.kind, t.createdAt),
    index('idx_lr_user_ref').on(t.userId, t.refType, t.refId),
    index('idx_course_time').on(t.courseId, t.createdAt),
    // 部分索引：待处理记录（异步评分队列轮询）
    index('idx_lr_pending')
      .on(t.status)
      .where(sql`${t.status} = 'pending'`),
  ],
);

// ═══════════════════════════════════════════════════════════
// daily_stat / streak / heatmap
// ═══════════════════════════════════════════════════════════

/** 日统计（热力图与周报数据源） */
export const dailyStat = pgTable(
  'daily_stat',
  {
    userId: bigint('user_id', { mode: 'number' })
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    /** SQLite 侧存 'YYYY-MM-DD'（§4.4） */
    statDate: date('stat_date').notNull(),
    studyMinutes: integer('study_minutes').notNull().default(0),
    newWords: integer('new_words').notNull().default(0),
    reviews: integer('reviews').notNull().default(0),
    shadowCount: integer('shadow_count').notNull().default(0),
    dictationCount: integer('dictation_count').notNull().default(0),
    dialogueTurns: integer('dialogue_turns').notNull().default(0),
    avgScore: numeric('avg_score', { precision: 5, scale: 2 }).notNull().default('0'),
    correctRate: numeric('correct_rate', { precision: 5, scale: 2 }).notNull().default('0'),
    errorCount: integer('error_count').notNull().default(0),
    goalMet: boolColumn('goal_met').notNull().default(false),
  },
  (t) => [
    index('idx_daily_stat_date').on(t.statDate),
    index('idx_daily_stat_user_date').on(t.userId, t.statDate),
  ],
);

/** 连续打卡 */
export const streak = pgTable('streak', {
  userId: bigint('user_id', { mode: 'number' })
    .primaryKey()
    .references(() => user.id, { onDelete: 'cascade' }),
  currentDays: integer('current_days').notNull().default(0),
  longestDays: integer('longest_days').notNull().default(0),
  lastStudyDate: date('last_study_date'),
  /** 补签卡次数 */
  freezeUsed: smallint('freeze_used').notNull().default(0),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

/** 热力图（GitHub 式 4 级，REQ-010：12 周热力图，跨月不清零） */
export const heatmap = pgTable(
  'heatmap',
  {
    id: bigint('id', { mode: 'number' })
      .primaryKey()
      .generatedAlwaysAsIdentity(),
    userId: bigint('user_id', { mode: 'number' })
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    activityDate: date('activity_date').notNull(),
    /** 0~4 级 */
    level: smallint('level').notNull().default(0),
    minutes: integer('minutes').notNull().default(0),
    count: integer('count').notNull().default(0),
  },
  (t) => [
    uniqueIndex('uq_heatmap_user_date').on(t.userId, t.activityDate),
    // §4.3「热力图 12 周」
    index('idx_heatmap_range').on(t.userId, t.activityDate),
  ],
);

export type WordMasteryRow = typeof wordMastery.$inferSelect;
export type LearningRecordRow = typeof learningRecord.$inferSelect;
export type CourseRow = typeof course.$inferSelect;
export type DailyStatRow = typeof dailyStat.$inferSelect;
export type HeatmapRow = typeof heatmap.$inferSelect;
