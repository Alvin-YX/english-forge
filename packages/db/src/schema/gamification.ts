/**
 * 游戏化域 —— 03 文档 §4.2.10
 *
 * 覆盖表：`badge` / `weekly_challenge` / `game_record`
 *
 * 说明：`badge` 在 §4.2.10 只有一行签名式定义
 * `CREATE TABLE badge ( user_id BIGINT, code VARCHAR(32), earned_at TIMESTAMPTZ, PRIMARY KEY (user_id, code) )`，
 * 按复合主键实现，不加自增 id。
 */

import {
  bigint,
  date,
  index,
  integer,
  json,
  numeric,
  pgTable,
  primaryKey,
  timestamp,
  varchar,
} from 'drizzle-orm/pg-core';

import { user } from './user.js';

// ═══════════════════════════════════════════════════════════
// badge
// ═══════════════════════════════════════════════════════════

/** 徽章授予（复合主键，无独立 id） */
export const badge = pgTable(
  'badge',
  {
    userId: bigint('user_id', { mode: 'number' })
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    /** 徽章标识，如 `streak_7` / `first_perfect` */
    code: varchar('code', { length: 32 }).notNull(),
    earnedAt: timestamp('earned_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.userId, t.code] })],
);

// ═══════════════════════════════════════════════════════════
// weekly_challenge
// ═══════════════════════════════════════════════════════════

/** 挑战指标维度 */
export const CHALLENGE_METRICS = ['study_minutes', 'new_words', 'shadow_count', 'accuracy'] as const;
export type ChallengeMetric = (typeof CHALLENGE_METRICS)[number];

/** 挑战状态 */
export const CHALLENGE_STATUSES = ['ongoing', 'done', 'expired'] as const;
export type ChallengeStatus = (typeof CHALLENGE_STATUSES)[number];

/** 每周挑战 */
export const weeklyChallenge = pgTable(
  'weekly_challenge',
  {
    id: bigint('id', { mode: 'number' })
      .primaryKey()
      .generatedAlwaysAsIdentity(),
    userId: bigint('user_id', { mode: 'number' })
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    /** 周一日期 */
    weekStart: date('week_start').notNull(),
    title: varchar('title', { length: 128 }).notNull(),
    metric: varchar('metric', { length: 32 }).$type<ChallengeMetric>().notNull(),
    targetValue: integer('target_value').notNull(),
    currentValue: integer('current_value').notNull().default(0),
    rewardPoints: integer('reward_points').notNull().default(0),
    status: varchar('status', { length: 16 }).$type<ChallengeStatus>().notNull().default('ongoing'),
  },
  (t) => [
    // §4.2.10：UNIQUE (user_id, week_start) —— 每周每人一条
    index('uq_weekly_challenge_user_week').on(t.userId, t.weekStart),
    // 到期扫描（ongoing → expired）
    index('idx_weekly_challenge_status').on(t.status, t.weekStart),
  ],
);

// ═══════════════════════════════════════════════════════════
// game_record
// ═══════════════════════════════════════════════════════════

/** 游戏编码（word_shooter|spell_truck|miner|match4） */
export const GAME_CODES = ['word_shooter', 'spell_truck', 'miner', 'match4'] as const;
export type GameCode = (typeof GAME_CODES)[number];

/** 游戏记录（错词回流到错题本的来源之一） */
export const gameRecord = pgTable(
  'game_record',
  {
    id: bigint('id', { mode: 'number' })
      .primaryKey()
      .generatedAlwaysAsIdentity(),
    userId: bigint('user_id', { mode: 'number' })
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    gameCode: varchar('game_code', { length: 32 }).$type<GameCode>().notNull(),
    score: integer('score').notNull().default(0),
    comboMax: integer('combo_max').notNull().default(0),
    accuracy: numeric('accuracy', { precision: 5, scale: 2 }).notNull().default('0'),
    durationMs: integer('duration_ms').notNull().default(0),
    /** [{word_id, count}] */
    wrongWords: json('wrong_words'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    // §4.2.10：idx_game_user_time
    index('idx_game_user_time').on(t.userId, t.gameCode, t.createdAt),
  ],
);

export type BadgeRow = typeof badge.$inferSelect;
export type WeeklyChallengeRow = typeof weeklyChallenge.$inferSelect;
export type GameRecordRow = typeof gameRecord.$inferSelect;
