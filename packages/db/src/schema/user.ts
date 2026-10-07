/**
 * 用户域 schema —— 03 文档 §4.2.1
 *
 * 覆盖表：`user` / `user_profile` / `parent_children` / `consent_log`
 *
 * 🔴 `parent_children` 是「家长只能看自己孩子」这条安全红线（04 文档 §9.2 REQ-011
 * 相关、§5.1 `GET /me/children`）的**唯一数据支撑**。它不在 03 文档 §4.2 的建表
 * SQL 里（文档缺陷，已由架构评审确认并要求补齐）。
 *
 * 🔴 隐私（§4.2.1 注释）：`phone`/`email` 属未成年人敏感信息，列表接口默认脱敏
 * （`138****8000`），仅本人 / 其监护人 / 其教师可见，审计日志记录每次查看。
 */

import { type Accent, type Role } from '@eng-forge/contracts/enums';
import { type StageCode } from '@eng-forge/contracts/types';
import {
  bigint,
  index,
  json,
  numeric,
  pgTable,
  smallint,
  timestamp,
  uniqueIndex,
  varchar,
} from 'drizzle-orm/pg-core';

import { boolColumn, jsonDefaultSql } from '../dialect.js';


/** 账号状态（§4.2.1 CHECK 约束） */
export const USER_STATUSES = ['active', 'disabled', 'deleted'] as const;
export type UserStatus = (typeof USER_STATUSES)[number];

/** 性能档位偏好（§4.2.1 `user_profile.perf_tier`，注意与 `PerfTier` 引擎档位不同） */
export const PROFILE_PERF_TIERS = ['auto', 'smooth', 'standard', 'power_saving'] as const;
export type ProfilePerfTier = (typeof PROFILE_PERF_TIERS)[number];

/** 报告频率（§4.2.1 CHECK 约束） */
export const REPORT_FREQUENCIES = ['off', 'daily', 'weekly', 'monthly'] as const;
export type ReportFrequency = (typeof REPORT_FREQUENCIES)[number];

/** ASR 模型偏好（§4.2.1 `asr_model`） */
export const ASR_MODELS = ['tiny', 'base', 'small', 'medium', 'large-v2'] as const;
export type AsrModel = (typeof ASR_MODELS)[number];

// ═══════════════════════════════════════════════════════════
// user
// ═══════════════════════════════════════════════════════════

/**
 * 用户（学生/家长/教师三合一，`role` 区分；支持家长绑定多个孩子）。
 * 首注册自动成为 `admin`（§5.1 `/auth/register`）。
 */
export const user = pgTable(
  'user',
  {
    id: bigint('id', { mode: 'number' })
      .primaryKey()
      .generatedAlwaysAsIdentity(),
    /** 登录名（本地局域网可简单化） */
    username: varchar('username', { length: 64 }).notNull().unique(),
    /** argon2id（降级 bcrypt cost=12） */
    passwordHash: varchar('password_hash', { length: 255 }).notNull(),
    role: varchar('role', { length: 16 }).$type<Role>().notNull(),
    displayName: varchar('display_name', { length: 64 }).notNull(),
    avatarPath: varchar('avatar_path', { length: 255 }),
    /** 可空（零外网默认不校验邮件） */
    email: varchar('email', { length: 128 }).unique(),
    phone: varchar('phone', { length: 32 }),
    status: varchar('status', { length: 16 }).$type<UserStatus>().notNull().default('active'),
    lastLoginAt: timestamp('last_login_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
  },
  (t) => [
    // §4.2.1：idx_user_role_status
    index('idx_user_role_status').on(t.role, t.status),
    // CHECK 约束（迁移 SQL 中落地，此处仅注释说明 Drizzle 侧靠 $type 收窄）
    //   role   IN ('student','parent','teacher','admin')
    //   status IN ('active','disabled','deleted')
  ],
);

// ═══════════════════════════════════════════════════════════
// user_profile
// ═══════════════════════════════════════════════════════════

/**
 * 用户档案（学段、偏好、硬件档位）。
 * `user_id` 既是主键又是外键（1:1 扩展表）。
 */
export const userProfile = pgTable('user_profile', {
  userId: bigint('user_id', { mode: 'number' })
    .primaryKey()
    .references(() => user.id, { onDelete: 'cascade' }),
  /** 当前主学段 */
  stageId: bigint('stage_id', { mode: 'number' }),
  /** 起始年级（如 2026 秋季一年级） */
  stageStartYear: smallint('stage_start_year'),
  /** 冗余的学段 code —— `stage` 表在 taxonomy.ts，跨域引用会成环，故冗余存储 */
  stageCode: varchar('stage_code', { length: 16 }).$type<StageCode>(),
  locale: varchar('locale', { length: 16 }).notNull().default('zh-CN'),
  accent: varchar('accent', { length: 8 }).$type<Accent>().notNull().default('us'),
  speechRate: numeric('speech_rate', { precision: 3, scale: 2 }).notNull().default('1.00'),
  perfTier: varchar('perf_tier', { length: 16 }).$type<ProfilePerfTier>().notNull().default('auto'),
  /** 用户偏好：tiny/base/small/medium/large-v2 */
  asrModel: varchar('asr_model', { length: 32 }).$type<AsrModel>().notNull().default('base'),
  dailyGoalMin: smallint('daily_goal_min').notNull().default(15),
  reportFrequency: varchar('report_frequency', { length: 16 })
    .$type<ReportFrequency>()
    .notNull()
    .default('weekly'),
  /** 其他偏好（[PG] JSON / SQLite TEXT，见 dialect.ts JsonCol 约定） */
  extra: json('extra').notNull().default(jsonDefaultSql()),

  // ── 04 文档 §5.6.1 规则①「首次使用前 1 句校准」────────────────
  /** 是否已完成首次使用前的 1 句环境校准（测底噪 + 设备质量 → 判定性能档位） */
  calibrationDone: boolColumn('calibration_done').notNull().default(false),
  /** 校准测得的环境底噪 dB */
  noiseFloorDb: numeric('noise_floor_db', { precision: 5, scale: 2 }),

  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

// ═══════════════════════════════════════════════════════════
// parent_children（🔴 文档缺陷补齐）
// ═══════════════════════════════════════════════════════════

/** 亲子关系类型 */
export const PARENT_CHILD_RELATIONS = [
  'father',
  'mother',
  'grandfather',
  'grandmother',
  'other_guardian',
] as const;
export type ParentChildRelation = (typeof PARENT_CHILD_RELATIONS)[number];

/**
 * 家长 ↔ 孩子绑定关系。
 *
 * 🔴 安全红线支撑表：家长后台的所有查询（`GET /me/children`、孩子周报、错题本）
 *    必须经此表 join 出可见 child_id 集合，**禁止**把 child_id 直接采信请求参数。
 *    04 文档 REQ-011 已把账号隔离定为「架构保证」而非「权限层」。
 *
 * 取舍说明：03 文档未定义此表，我按上述红线补齐。`UNIQUE(parent_id, child_id)`
 * 保证重复绑定幂等（`POST /me/children/bind` 带 Idempotency-Key 仍双保险）。
 * 未加 `child_id` 唯一约束 —— 允许一个孩子被多名监护人绑定（隔代抚养场景）。
 */
export const parentChildren = pgTable(
  'parent_children',
  {
    id: bigint('id', { mode: 'number' })
      .primaryKey()
      .generatedAlwaysAsIdentity(),
    parentId: bigint('parent_id', { mode: 'number' })
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    childId: bigint('child_id', { mode: 'number' })
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    relation: varchar('relation', { length: 16 }).$type<ParentChildRelation>(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    // 幂等：同一 (家长, 孩子) 只允许一条
    uniqueIndex('uq_parent_children_pair').on(t.parentId, t.childId),
    // 外键字段必建索引（03 文档 §4 全局约定）
    // → 反查「谁是这个孩子的监护人」（教师端、孩子档案页需要）
    index('idx_parent_children_child').on(t.childId),
  ],
);

// ═══════════════════════════════════════════════════════════
// consent_log（🔴 文档缺陷补齐）
// ═══════════════════════════════════════════════════════════

/**
 * 家长知情同意记录。
 *
 * 🔴 合规依据：04 文档 §9.2「不满 14 周岁监护人同意机制」+ PIPL 未成年人保护条款。
 *    协议文本可能随版本更新，故同时记录 `agreement_version` 与
 *    `agreement_hash`（SHA-256 of 正文 + version），使历史同意可回溯校验
 *    「当时同意的是哪一版」。
 *
 * 取舍：`granted` 为 false 的记录同样保留（用户拒绝也是事实），
 * 只有 `revoked_at` 用于撤回。`UNIQUE(child_id, agreement_version)` 保证
 * 同一版协议对同一孩子只采集一次同意/拒绝结论。
 */
export const consentLog = pgTable(
  'consent_log',
  {
    id: bigint('id', { mode: 'number' })
      .primaryKey()
      .generatedAlwaysAsIdentity(),
    childId: bigint('child_id', { mode: 'number' })
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    /** 采集同意的监护人（`parent_children` 中的 parent） */
    guardianId: bigint('guardian_id', { mode: 'number' }).references(() => user.id, {
      onDelete: 'set null',
    }),
    /** 协议版本号，如 `1.0.0` / `2026-10-05` */
    agreementVersion: varchar('agreement_version', { length: 32 }).notNull(),
    /** 协议正文 + 版本的 SHA-256（hex 64） */
    agreementHash: varchar('agreement_hash', { length: 64 }).notNull(),
    /** 是否同意 */
    granted: boolColumn('granted').notNull(),
    /** 同意/拒绝发生时间 */
    grantedAt: timestamp('granted_at', { withTimezone: true }).notNull().defaultNow(),
    /** 撤回时间（null = 未撤回） */
    revokedAt: timestamp('revoked_at', { withTimezone: true }),
    /** 采集渠道：register / settings / reconsent */
    source: varchar('source', { length: 32 }).notNull().default('settings'),
    /** 客户端元信息 {ip, ua, locale}，供争议追溯 */
    meta: json('meta'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex('uq_consent_log_child_version').on(t.childId, t.agreementVersion),
    // 查「当前有效同意」：granted=true AND revoked_at IS NULL
    index('idx_consent_log_child_active').on(t.childId, t.grantedAt),
  ],
);

/** 采集渠道取值 */
export const CONSENT_SOURCES = ['register', 'settings', 'reconsent'] as const;
export type ConsentSource = (typeof CONSENT_SOURCES)[number];

export type UserRow = typeof user.$inferSelect;
export type NewUserRow = typeof user.$inferInsert;
export type UserProfileRow = typeof userProfile.$inferSelect;
export type NewUserProfileRow = typeof userProfile.$inferInsert;
export type ParentChildrenRow = typeof parentChildren.$inferSelect;
export type ConsentLogRow = typeof consentLog.$inferSelect;

/** 家长可见孩子 id 的最小投影（仓储层用，勿在业务层裸写 join） */
export const parentChildrenSelect = {
  childId: parentChildren.childId,
  relation: parentChildren.relation,
} as const;

