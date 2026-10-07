/**
 * 系统与班级域 —— 03 文档 §4.2.12 + 文档缺陷补齐
 *
 * 覆盖表：`class` / `class_membership` / `permission_matrix` /
 *        `app_cache` / `audit_log` / `app_config` / `app_secret` /
 *        `system_notice` / `idempotency_key` / `job_audit` / `forge_migrations`
 *
 * 🔴 本文件含 4 张「文档只引用、没给 DDL」的补齐表：
 *   `app_secret`（§9.3 敏感配置）/ `app_config`（出网白名单）/
 *   `system_notice`（降级通知、复习提醒）/ `idempotency_key`（§5 写操作去重 24h）
 */

import { type Role } from '@eng-forge/contracts/enums';
import { sql } from 'drizzle-orm';
import {
  bigint,
  index,
  integer,
  json,
  pgTable,
  primaryKey,
  smallint,
  text,
  timestamp,
  uniqueIndex,
  varchar,
} from 'drizzle-orm/pg-core';


import { IDEMPOTENCY_TTL_MS, byteaColumn, boolColumn } from '../dialect.js';

import { user } from './user.js';

// ═══════════════════════════════════════════════════════════
// class / class_membership
// ═══════════════════════════════════════════════════════════

/** 班级 */
export const classTable = pgTable(
  'class',
  {
    id: bigint('id', { mode: 'number' })
      .primaryKey()
      .generatedAlwaysAsIdentity(),
    name: varchar('name', { length: 64 }).notNull(),
    /** 五年级(3)班 */
    grade: varchar('grade', { length: 32 }),
    teacherId: bigint('teacher_id', { mode: 'number' })
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    /** 2026-2027 */
    schoolYear: varchar('school_year', { length: 16 }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('idx_class_teacher').on(t.teacherId)],
);

/** 班级成员（复合主键） */
export const classMembership = pgTable(
  'class_membership',
  {
    classId: bigint('class_id', { mode: 'number' })
      .notNull()
      .references(() => classTable.id, { onDelete: 'cascade' }),
    userId: bigint('user_id', { mode: 'number' })
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    /** 座位号（按座位排序，对齐 word-teacher） */
    seatNo: smallint('seat_no'),
    role: varchar('role', { length: 16 }).$type<Role>().notNull().default('student'),
    joinedAt: timestamp('joined_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    primaryKey({ columns: [t.classId, t.userId] }),
    // §4.3「班级进步榜」：idx_cm_user
    index('idx_cm_user').on(t.userId),
  ],
);

// ═══════════════════════════════════════════════════════════
// permission_matrix
// ═══════════════════════════════════════════════════════════

/**
 * 统一权限矩阵（管理员/教师/学生 × 11 项功能，对齐 word-teacher）。
 * 数据由 `seed/permissions.ts` 填充，运行时**只读**。
 */
export const permissionMatrix = pgTable(
  'permission_matrix',
  {
    role: varchar('role', { length: 16 }).$type<Role>().notNull(),
    /** 见 `seed/permissions.ts` 的 `PERMISSION_FEATURES`（11 项） */
    feature: varchar('feature', { length: 64 }).notNull(),
    canRead: boolColumn('can_read').notNull().default(false),
    canWrite: boolColumn('can_write').notNull().default(false),
  },
  (t) => [primaryKey({ columns: [t.role, t.feature] })],
);

// ═══════════════════════════════════════════════════════════
// app_cache
// ═══════════════════════════════════════════════════════════

/** 应用缓存（替代 Redis，§4.2.12） */
export const appCache = pgTable(
  'app_cache',
  {
    cacheKey: varchar('cache_key', { length: 191 }).primaryKey(),
    /** [PG] BYTEA 可存二进制；SQLite 用 BLOB */
    payload: byteaColumn('payload'),

    expireAt: timestamp('expire_at', { withTimezone: true }).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('idx_cache_expire').on(t.expireAt)],
);

// ═══════════════════════════════════════════════════════════
// audit_log
// ═══════════════════════════════════════════════════════════

/**
 * 审计日志（安全基线：关键操作留存 ≥ 6 个月）。
 *
 * 🔴 本次补两个 action（04 文档已确认决策）：
 *   - `system_tier_change`：§7.7 要求**自动降档必须写审计**（否则用户无法排查
 *     「为什么今天分数变低了」——这正是 04 文档 §5.6.2 风险链路的起点）
 *   - `egress_call`：§9.2 出网审计（云 API 对话会把内容发到第三方，必须留痕）
 */
export const AUDIT_ACTIONS = [
  'login',
  'logout',
  'password_change',
  'import_words',
  'delete_recording',
  'export_report',
  'role_change',
  'view_child_profile',
  // ── 本次补齐（04 文档）──
  /** §7.7 性能档位自动降档 */
  'system_tier_change',
  /** §9.2 出网调用（云 API / TTS / 翻译） */
  'egress_call',
  /** 数据导出/删除（遗忘权，PIPL） */
  'data_erasure',
] as const;
export type AuditAction = (typeof AUDIT_ACTIONS)[number];

export const auditLog = pgTable(
  'audit_log',
  {
    id: bigint('id', { mode: 'number' })
      .primaryKey()
      .generatedAlwaysAsIdentity(),
    /** 操作者；系统任务（scheduler/worker）执行时为 NULL */
    actorId: bigint('actor_id', { mode: 'number' }).references(() => user.id, {
      onDelete: 'set null',
    }),
    action: varchar('action', { length: 64 }).$type<AuditAction>().notNull(),
    targetType: varchar('target_type', { length: 32 }),
    targetId: varchar('target_id', { length: 64 }),
    detail: json('detail'),
    /** IPv6 最长 45 字符 */
    ip: varchar('ip', { length: 45 }),
    ua: varchar('ua', { length: 255 }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('idx_audit_actor_time').on(t.actorId, t.createdAt),
    index('idx_audit_action').on(t.action, t.createdAt),
  ],
);

// ═══════════════════════════════════════════════════════════
// app_config（🔴 文档缺陷补齐）
// ═══════════════════════════════════════════════════════════

/** 配置项类型 */
export const CONFIG_VALUE_TYPES = ['string', 'number', 'boolean', 'json'] as const;
export type ConfigValueType = (typeof CONFIG_VALUE_TYPES)[number];

/**
 * 应用配置（键值对）。
 *
 * 🔴 补齐依据：03 文档 §9.2/§9.3 要求「敏感配置与出网白名单可管理」，
 *    但 §4.2 从未给 `app_config` 建表语句。
 *
 * 🔴 与 `app_secret` 的分工（安全红线）：
 *   - `app_config`：**非敏感**配置（出网白名单、默认档位、功能开关）→ 明文
 *   - `app_secret`：**敏感**配置（云 API Key）→ 只存密文，永不返回明文
 *   误把 Key 写进 `app_config` 会导致密钥随备份/导出泄露，故两表严格分离。
 */
export const appConfig = pgTable('app_config', {
  key: varchar('key', { length: 128 }).primaryKey(),
  value: text('value'),
  valueType: varchar('value_type', { length: 16 })
    .$type<ConfigValueType>()
    .notNull()
    .default('string'),
  /** 配置分组，便于后台分区展示 */
  group: varchar('group', { length: 32 }).notNull().default('general'),
  description: varchar('description', { length: 255 }),
  /** 🔶 是否可在管理后台修改（出网白名单等安全项建议 false，只改文件/env） */
  editable: boolColumn('editable').notNull().default(true),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

/** 出网白名单配置键（§9.2 出网审计的白名单来源） */
export const CONFIG_KEY_EGRESS_ALLOWLIST = 'security.egress_allowlist';
/** 默认性能档位配置键（§7.7） */
export const CONFIG_KEY_DEFAULT_PERF_TIER = 'speech.default_perf_tier';

// ═══════════════════════════════════════════════════════════
// app_secret（🔴 文档缺陷补齐）
// ═══════════════════════════════════════════════════════════

/**
 * 云 API Key 加密存储。
 *
 * 🔴 补齐依据：03 文档 §9.3「敏感配置管理」要求云 API Key 不得明文落库/落盘。
 *
 * 🔴 安全设计（AES-256-GCM）：
 *   - `ciphertext` 与 `iv`（12 字节 GCM nonce）与 `auth_tag`（16 字节）**分开存**，
 *     缺一无法解密/无法验签
 *   - `key_version` 支持主密钥轮换：轮换时新写入用新版本，
 *     存量待解密时按 version 选对应主密钥
 *   - **本表不提供任何明文读取函数**，解密只在 speech/llm 客户端内部完成
 *   - 审计：解密调用应写 `audit_log` 的 `egress_call`
 */
export const appSecret = pgTable(
  'app_secret',
  {
    /** 逻辑名，如 `cloud.llm.api_key` / `cloud.tts.api_key` */
    name: varchar('name', { length: 128 }).primaryKey(),
    /** provider：openai|deepseek|tencent|…（与 `app_config` 联动做白名单校验） */
    provider: varchar('provider', { length: 32 }).notNull(),
    /** AES-256-GCM 密文（base64） */
    ciphertext: text('ciphertext').notNull(),
    /** 初始化向量（base64，12 字节） */
    iv: varchar('iv', { length: 64 }).notNull(),
    /** GCM 认证标签（base64，16 字节） */
    authTag: varchar('auth_tag', { length: 64 }).notNull(),
    /** 主密钥版本，支持轮换 */
    keyVersion: smallint('key_version').notNull().default(1),
    /** 密钥过期时间（云厂商 Token 有有效期） */
    expiresAt: timestamp('expires_at', { withTimezone: true }),
    /** 最近一次使用时间（用于识别废弃密钥） */
    lastUsedAt: timestamp('last_used_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('idx_app_secret_provider').on(t.provider)],
);

// ═══════════════════════════════════════════════════════════
// system_notice（🔴 文档缺陷补齐）
// ═══════════════════════════════════════════════════════════

/** 站内通知分类 */
export const NOTICE_CATEGORIES = [
  /** 评分降级通知（04 文档 §5.6.3「绝不静默降级」的主动告知） */
  'degrade',
  /** 错误样本即将过期提醒（§4.2.9 状态机 T-1 天） */
  'expiry',
  /** 复习提醒（今日待复习） */
  'review',
  /** 家长周报已生成 */
  'report',
  /** 系统公告 */
  'system',
] as const;
export type NoticeCategory = (typeof NOTICE_CATEGORIES)[number];

/** 通知级别 */
export const NOTICE_LEVELS = ['info', 'warning', 'critical'] as const;
export type NoticeLevel = (typeof NOTICE_LEVELS)[number];

/**
 * 站内通知。
 *
 * 🔴 补齐依据：03 文档 §4.2.9 状态机要求「T-1 天生成站内提醒」，
 *    §5.6.3 要求降级必须让用户知道，§4.2.12 无对应表 → 补齐。
 *
 * 取舍：用 `user_id` 而非 `parent_children` 关联 —— 通知是**站内**的，
 * 家长给孩子产生的通知（如周报）由 `target_user_id` 指向孩子，
 * 家长在自己 `/me/notices` 里看到的是自己那条。
 */
export const systemNotice = pgTable(
  'system_notice',
  {
    id: bigint('id', { mode: 'number' })
      .primaryKey()
      .generatedAlwaysAsIdentity(),
    /** 通知接收人 */
    userId: bigint('user_id', { mode: 'number' })
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    category: varchar('category', { length: 16 }).$type<NoticeCategory>().notNull(),
    level: varchar('level', { length: 16 }).$type<NoticeLevel>().notNull().default('info'),
    title: varchar('title', { length: 128 }).notNull(),
    body: text('body'),
    /** 点击跳转路由，如 `/error-book?category=speak` */
    link: varchar('link', { length: 255 }),
    /** 关联对象（如 error_sample.id），便于去详情 */
    refType: varchar('ref_type', { length: 32 }),
    refId: varchar('ref_id', { length: 64 }),
    readAt: timestamp('read_at', { withTimezone: true }),
    /** 幂等键：避免同一事件重复发通知（如 worker 重跑） */
    dedupeKey: varchar('dedupe_key', { length: 191 }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('idx_notice_user_read').on(t.userId, t.readAt),
    index('idx_notice_user_time').on(t.userId, t.createdAt),
    // 幂等：同一 dedupe_key 只产生一条通知
    uniqueIndex('uq_notice_dedupe').on(t.dedupeKey),
  ],
);

// ═══════════════════════════════════════════════════════════
// idempotency_key（🔴 文档缺陷补齐）
// ═══════════════════════════════════════════════════════════

/**
 * 写操作幂等键（03 文档 §5：「所有写操作接受 `Idempotency-Key` 头，
 * 服务端按 key 去重 24h」）。
 *
 * 🔴 补齐依据：§5 全表标注幂等 ✅ 的接口有 20+ 个，但 §4.2 完全没有存储去重状态的表。
 *    没有这张表，「去重 24h」无法实现 —— 移动端弱网重试会重复扣减/重复建会话。
 *
 * 设计：
 * - 主键 `(key, user_id, route)`：同一用户对同一路由的同一 key 才算重复；
 *   不同路由用同一个 key（如 UUID 复用）不应误判为重复。
 * - `request_hash`：请求体 SHA-256。**同 key 不同 request_hash = 客户端 bug**，
 *   按 HTTP 语义应返回 422 而不是复用旧响应。
 * - `response_json`：首次成功响应体缓存，重放时原样返回（保证幂等返回一致）。
 * - `expire_at`：清理任务按此字段批量删（`created_at + 24h`，见 dialect.ts）。
 */
export const idempotencyKey = pgTable(
  'idempotency_key',
  {
    /** 请求头 `Idempotency-Key` 的值 */
    key: varchar('key', { length: 191 }).notNull(),
    userId: bigint('user_id', { mode: 'number' })
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    /** 归一化路由（含方法），如 `POST:/conversations/:id/messages` */
    route: varchar('route', { length: 191 }).notNull(),
    /** 请求体 SHA-256（hex 64），用于检测「同 key 不同 body」 */
    requestHash: varchar('request_hash', { length: 64 }).notNull(),
    /** 首次成功响应体（重放时原样返回） */
    responseJson: json('response_json'),
    /** 处理中标记：并发同 key 请求据此返回 409 而非重复执行 */
    inProgress: boolColumn('in_progress').notNull().default(false),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    /** created_at + 24h */
    expireAt: timestamp('expire_at', { withTimezone: true }).notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.key, t.userId, t.route] }),
    // 过期清理扫描
    index('idx_idempotency_expire').on(t.expireAt),
  ],
);

/** `expire_at` 的计算：created_at + 24h（与 dialect.ts 的 TTL 常量同源） */
export const idempotencyExpireAt = (createdAt: Date): Date =>
  new Date(createdAt.getTime() + IDEMPOTENCY_TTL_MS);

// ═══════════════════════════════════════════════════════════
// job_audit
// ═══════════════════════════════════════════════════════════

/** 作业状态 */
export const JOB_STATUSES = ['running', 'done', 'failed'] as const;
export type JobStatus = (typeof JOB_STATUSES)[number];

/** 作业队列审计（pg-boss 自带表，此处仅登记自定义任务元数据） */
export const jobAudit = pgTable(
  'job_audit',
  {
    id: bigint('id', { mode: 'number' })
      .primaryKey()
      .generatedAlwaysAsIdentity(),
    jobName: varchar('job_name', { length: 64 }).notNull(),
    refId: bigint('ref_id', { mode: 'number' }),
    status: varchar('status', { length: 16 }).$type<JobStatus>().notNull(),
    attempts: smallint('attempts').notNull().default(0),
    error: text('error'),
    startedAt: timestamp('started_at', { withTimezone: true }),
    finishedAt: timestamp('finished_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('idx_job_audit_name_time').on(t.jobName, t.createdAt)],
);

// ═══════════════════════════════════════════════════════════
// forge_migrations
// ═══════════════════════════════════════════════════════════

/**
 * 迁移执行记录（自建，不依赖 drizzle-kit 的 `__drizzle_migrations`）。
 *
 * 用途（§4.4 阶段 B）：版本间升级时记录每个 `NNNN_name.sql` 的
 * **文件 hash**，用于「迁移文件被改过就拒绝执行」的审计红线 ——
 * 已执行过的迁移若内容变了，说明有人在破坏「SQL 透明可审计」的前提。
 */
export const forgeMigrations = pgTable('forge_migrations', {
  /** 迁移序号，如 `0000` */
  version: varchar('version', { length: 32 }).primaryKey(),
  /** 迁移文件名，如 `0000_init.sql` */
  name: varchar('name', { length: 128 }).notNull(),
  /** 迁移文件 SHA-256（hex 64） */
  hash: varchar('hash', { length: 64 }).notNull(),
  /** 执行方言（同一版本号在两套 migrations 下内容不同） */
  dialect: varchar('dialect', { length: 16 })
    .$type<'postgres' | 'sqlite'>()
    .notNull()
    .default(sql`'postgres'`),
  executionMs: integer('execution_ms'),
  appliedAt: timestamp('applied_at', { withTimezone: true }).notNull().defaultNow(),
});

/** 审计日志保留月数（03 文档 §4.2.12：安全基线 ≥ 6 个月） */
export const AUDIT_RETENTION_MONTHS = 6;

export type ClassRow = typeof classTable.$inferSelect;
export type ClassMembershipRow = typeof classMembership.$inferSelect;
export type AuditLogRow = typeof auditLog.$inferSelect;
export type IdempotencyKeyRow = typeof idempotencyKey.$inferSelect;
export type SystemNoticeRow = typeof systemNotice.$inferSelect;
export type AppSecretRow = typeof appSecret.$inferSelect;

