/**
 * Drizzle ORM schema —— 双方言（SQLite/PostgreSQL）共享
 *
 * 使用 `sqliteTable` 和 `pgTable` 分别定义，通过 dialect 类型切换。
 * 表结构一致，仅约束语法略有差异。
 */

import { sql } from 'drizzle-orm';
import {
  index,
  integer,
  json,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
} from 'drizzle-orm/pg-core';

// ═══════════════════════════════════════════════════════════
// 辅助类型
// ═══════════════════════════════════════════════════════════

/** JSON 列类型（PG jsonb） */
type JsonValue = string | number | boolean | null | JsonValue[] | { [key: string]: JsonValue };

// ═══════════════════════════════════════════════════════════
// Migrations version 表（迁移追踪）
// ═══════════════════════════════════════════════════════════

export const migrationsVersion = pgTable('migrations_version', {
  version: integer('version').primaryKey().notNull(),
  appliedAt: timestamp('applied_at', { withTimezone: true }).notNull().defaultNow(),
});

export type MigrationsVersionRow = typeof migrationsVersion.$inferSelect;

// ═══════════════════════════════════════════════════════════
// Users 表
// ═══════════════════════════════════════════════════════════

export const users = pgTable(
  'users',
  {
    id: text('id').primaryKey().notNull(),
    username: text('username').notNull(),
    passwordHash: text('password_hash').notNull(),
    displayName: text('display_name').notNull(),
    role: text('role').notNull().default('student'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [uniqueIndex('users_username_uq').on(table.username)],
);

export type UserRow = typeof users.$inferSelect;

// ═══════════════════════════════════════════════════════════
// User Profiles 表
// ═══════════════════════════════════════════════════════════

export const userProfiles = pgTable(
  'user_profiles',
  {
    id: text('id').primaryKey().notNull(),
    userId: text('user_id').notNull(),
    displayName: text('display_name').notNull(),
    avatar: text('avatar'),
    stage: text('stage'),
    textbookVersionId: text('textbook_version_id'),
    volumeId: text('volume_id'),
    unitId: text('unit_id'),
    accent: text('accent').notNull().default('uk'),
    playbackRate: integer('playback_rate').notNull().default(100),
    dailyGoalMinutes: integer('daily_goal_minutes').notNull().default(30),
    perfTier: text('perf_tier'),
    calibrationDone: integer('calibration_done').notNull().default(0),
    noiseFloorDb: integer('noise_floor_db'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [uniqueIndex('user_profiles_user_id_uq').on(table.userId)],
);

export type UserProfileRow = typeof userProfiles.$inferSelect;

// ═══════════════════════════════════════════════════════════
// App Config KV 表
// ═══════════════════════════════════════════════════════════

export const appConfig = pgTable(
  'app_config',
  {
    key: text('key').primaryKey().notNull(),
    value: text('value').notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
);

export type AppConfigRow = typeof appConfig.$inferSelect;

// ═══════════════════════════════════════════════════════════
// App Secrets KV 表
// ═══════════════════════════════════════════════════════════

export const appSecrets = pgTable(
  'app_secrets',
  {
    key: text('key').primaryKey().notNull(),
    value: text('value').notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
);

export type AppSecretsRow = typeof appSecrets.$inferSelect;

// ═══════════════════════════════════════════════════════════
// Idempotency Keys 表
// ═══════════════════════════════════════════════════════════

export const idempotencyKeys = pgTable(
  'idempotency_keys',
  {
    key: text('key').primaryKey().notNull(),
    profileId: text('profile_id').notNull(),
    method: text('method').notNull(),
    path: text('path').notNull(),
    requestBodyHash: text('request_body_hash').notNull(),
    responseStatus: integer('response_status').notNull(),
    responseBody: json('response_body').notNull(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index('idempotency_keys_expires_idx').on(table.expiresAt),
    uniqueIndex('idempotency_keys_profile_path_method_uq').on(
      table.profileId,
      table.path,
      table.method,
    ),
  ],
);

export type IdempotencyKeyRow = typeof idempotencyKeys.$inferSelect;

// ═══════════════════════════════════════════════════════════
// Export schema for Drizzle drizzle() function
// ═══════════════════════════════════════════════════════════

export const schema = {
  migrationsVersion,
  users,
  userProfiles,
  appConfig,
  appSecrets,
  idempotencyKeys,
} as const;
