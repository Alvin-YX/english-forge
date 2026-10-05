/**
 * 学段 / 教材 / 册次 / 单元 —— 03 文档 §4.2.2（五级 schema，精华特性 #1）
 *
 * 覆盖表：`stage` / `textbook` / `volume` / `unit` / `enrollment`
 *
 * 链路：Stage(学段) → Textbook(教材版本) → Volume(册次) → Unit(单元) → Word(词条)
 *
 * 🔴 版权红线：这里只建**骨架结构**，不含任何教材原文。
 *    词条内容由独立 ETL 任务导入，且必须携带 license + source（见 content.ts）。
 */

import { type StageCode } from '@eng-forge/contracts/types';
import {
  bigint,
  boolean,
  index,
  pgTable,
  smallint,
  timestamp,
  uniqueIndex,
  varchar,
} from 'drizzle-orm/pg-core';


import { user } from './user.js';

// ═══════════════════════════════════════════════════════════
// stage
// ═══════════════════════════════════════════════════════════

/**
 * 学段。
 *
 * ⚠️ 03 文档 §4.2.2 的 CHECK 只列了 5 个 code（primary/junior/senior/university/adult），
 *    但 04 文档 §4.7 与 contracts 的 `StageCode` 是 **6 个**（多 `primary_low` 小学 1-2，
 *    且 college 而非 university）。照抄文档会导致小学 1-2 与大学两档无法入库。
 *    → 取舍：采用 contracts 的 6 值定义，迁移 SQL 的 CHECK 同步放宽。
 */
export const stage = pgTable('stage', {
  id: bigint('id', { mode: 'number' })
      .primaryKey()
      .generatedAlwaysAsIdentity(),
  code: varchar('code', { length: 16 }).$type<StageCode>().notNull().unique(),
  nameZh: varchar('name_zh', { length: 32 }).notNull(),
  nameEn: varchar('name_en', { length: 32 }).notNull(),
  sortOrder: smallint('sort_order').notNull(),
  /** 🔶 MVP 是否实现（04 文档 §8.2 负向清单：仅小学 3-6 与初中为 true） */
  enabledInMvp: boolean('enabled_in_mvp').notNull().default(false),
  /** 建议起始年龄（04 文档 §4.7 规则6：年龄下限 6 岁） */
  minAge: smallint('min_age'),
  maxAge: smallint('max_age'),
});

// ═══════════════════════════════════════════════════════════
// textbook
// ═══════════════════════════════════════════════════════════

/** 教材版本：人教版 PEP / 外研版 / 北师大 / 苏教 */
export const textbook = pgTable(
  'textbook',
  {
    id: bigint('id', { mode: 'number' })
      .primaryKey()
      .generatedAlwaysAsIdentity(),
    stageId: bigint('stage_id', { mode: 'number' })
      .notNull()
      .references(() => stage.id),
    code: varchar('code', { length: 64 }).notNull().unique(),
    nameZh: varchar('name_zh', { length: 64 }).notNull(),
    nameEn: varchar('name_en', { length: 64 }),
    region: varchar('region', { length: 32 }).notNull().default('CN'),
    publisher: varchar('publisher', { length: 64 }),
    /** true = 需授权（默认不内置教材内容） */
    isOfficial: boolean('is_official').notNull().default(false),
    /** 🔴 教材词表的许可（与 word.license 同源，便于按教材整体审计） */
    license: varchar('license', { length: 64 }),
    /** 🔴 教材词表来源（导入渠道标识） */
    source: varchar('source', { length: 64 }),
    enabledInMvp: boolean('enabled_in_mvp').notNull().default(false),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('idx_textbook_stage').on(t.stageId)],
);

// ═══════════════════════════════════════════════════════════
// volume
// ═══════════════════════════════════════════════════════════

/** 册次：三上 / 三下 / 七下 / 必修一 / Book 3 */
export const volume = pgTable(
  'volume',
  {
    id: bigint('id', { mode: 'number' })
      .primaryKey()
      .generatedAlwaysAsIdentity(),
    textbookId: bigint('textbook_id', { mode: 'number' })
      .notNull()
      .references(() => textbook.id, { onDelete: 'cascade' }),
    /** 如 g3a / g3b / g4a …（年级 + 上下册） */
    code: varchar('code', { length: 32 }).notNull(),
    nameZh: varchar('name_zh', { length: 32 }).notNull(),
    /** 年级 3~6（承 `textbook.stage_id`，冗余便于筛选） */
    grade: smallint('grade'),
    /** 上册/下册（承 contracts `VolumeType` 的语义，落库为 1/2；全一册为 NULL） */
    term: smallint('term'),
    sortOrder: smallint('sort_order').notNull(),
    enabledInMvp: boolean('enabled_in_mvp').notNull().default(false),
  },
  (t) => [
    uniqueIndex('uq_volume_textbook_code').on(t.textbookId, t.code),
    index('idx_volume_textbook').on(t.textbookId, t.sortOrder),
  ],
);

// ═══════════════════════════════════════════════════════════
// unit
// ═══════════════════════════════════════════════════════════

/** 单元：Unit 1 / Welcome Unit / Chapter 2 */
export const unit = pgTable(
  'unit',
  {
    id: bigint('id', { mode: 'number' })
      .primaryKey()
      .generatedAlwaysAsIdentity(),
    volumeId: bigint('volume_id', { mode: 'number' })
      .notNull()
      .references(() => volume.id, { onDelete: 'cascade' }),
    code: varchar('code', { length: 32 }).notNull(),
    nameZh: varchar('name_zh', { length: 64 }).notNull(),
    nameEn: varchar('name_en', { length: 64 }),
    wordCount: smallint('word_count').notNull().default(0),
    sortOrder: smallint('sort_order').notNull(),
  },
  (t) => [
    uniqueIndex('uq_unit_volume_code').on(t.volumeId, t.code),
    index('idx_unit_volume').on(t.volumeId, t.sortOrder),
  ],
);

// ═══════════════════════════════════════════════════════════
// enrollment
// ═══════════════════════════════════════════════════════════

/** 选课状态 */
export const ENROLLMENT_STATUSES = ['active', 'completed', 'archived'] as const;
export type EnrollmentStatus = (typeof ENROLLMENT_STATUSES)[number];

/**
 * 用户在学段/教材上的学习关系（§4.1 ER：`User(1)─(N)Enrollment`）。
 *
 * 03 文档 §4.1 的 ER 图引用了 `Enrollment`，但 §4.2 没有给建表 SQL
 * → 文档缺陷，按 ER 语义补齐。
 * 一个孩子可同时在多套教材上学习（如主线 PEP + 补充外研版），故不设全局唯一。
 */
export const enrollment = pgTable(
  'enrollment',
  {
    id: bigint('id', { mode: 'number' })
      .primaryKey()
      .generatedAlwaysAsIdentity(),
    userId: bigint('user_id', { mode: 'number' })
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    stageId: bigint('stage_id', { mode: 'number' })
      .notNull()
      .references(() => stage.id),
    /** 当前学习到的册次（进度游标） */
    currentVolumeId: bigint('current_volume_id', { mode: 'number' }).references(() => volume.id, {
      onDelete: 'set null',
    }),
    /** 当前学习到的单元（进度游标） */
    currentUnitId: bigint('current_unit_id', { mode: 'number' }).references(() => unit.id, {
      onDelete: 'set null',
    }),
    status: varchar('status', { length: 16 })
      .$type<EnrollmentStatus>()
      .notNull()
      .default('active'),
    startedAt: timestamp('started_at', { withTimezone: true }).notNull().defaultNow(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('idx_enrollment_user').on(t.userId, t.status),
    index('idx_enrollment_stage').on(t.stageId),
  ],
);

export type StageRow = typeof stage.$inferSelect;
export type TextbookRow = typeof textbook.$inferSelect;
export type VolumeRow = typeof volume.$inferSelect;
export type UnitRow = typeof unit.$inferSelect;
export type EnrollmentRow = typeof enrollment.$inferSelect;

/** `stage` 列表接口用的最小投影 */
export const stageSelect = {
  id: stage.id,
  code: stage.code,
  nameZh: stage.nameZh,
  enabledInMvp: stage.enabledInMvp,
} as const;

