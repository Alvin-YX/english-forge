/**
 * 双方言共享的 TS 类型 —— 03 文档 §8.1「方言差异收敛到 3 个文件」之二
 *
 * 本文件是**纯类型 + 少量零依赖值**，不含任何方言分支。
 * 目的是让 `apps/api`、`apps/web`、`packages/*` 在**不关心当前用哪个数据库**
 * 的前提下引用同一套类型。
 */

import type { Dialect } from './dialect.js';

// ═══════════════════════════════════════════════════════════
// ID 类型
// ═══════════════════════════════════════════════════════════

/**
 * 数据库自增主键在**应用层**的表示。
 *
 * ⚠️ §4 类型映射表已警告：「应用层均转 number/string 需注意 64 位」。
 * PG 的 `BIGINT` 超出 JS `number` 安全整数范围（2^53-1），
 * 因此约定：
 *   - **进程内**（刚 insert 拿到的返回值）用 `number`
 *   - **跨服务/HTTP/JSON** 一律转 `string`，由 `toIdString()` / `parseId()` 转换
 */
export type Id = number;

/** 跨服务传递的 ID 形态（十进制字符串，避免 JSON number 精度丢失） */
export type IdString = string;

export function toIdString(id: Id): IdString {
  return String(id);
}

export function parseId(raw: IdString): Id {
  const n = Number(raw);
  if (!Number.isSafeInteger(n) || n <= 0) {
    throw new Error(`非法 id：${raw}`);
  }
  return n;
}

// ═══════════════════════════════════════════════════════════
// 时间戳
// ═══════════════════════════════════════════════════════════

/**
 * 时间戳的跨服务表示：ISO8601 UTC 字符串。
 *
 * 双方言统一（§4 约定）：
 * - PG `timestamptz` → 驱动返回 `Date`，序列化时转 ISO8601
 * - SQLite `TEXT` → 直接存 ISO8601 UTC 字符串（**无原生时间类型**）
 */
export type IsoDateTime = string;

/** `date` 列的表示：YYYY-MM-DD */
export type IsoDate = string;

/** `timestamptz` 列在应用层的表示（SQLite 侧解析 ISO8601 后同样是 Date） */
export type Timestamp = Date;

export const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
export const ISO_DATETIME_RE = /^\d{4}-\d{2}-\d{2}T[\d:.]+(?:Z|[+-]\d{2}:\d{2})$/;

/** 校验 `date` 列格式（SQLite 侧无类型约束，只能靠应用层 zod + 此断言） */
export function assertIsoDate(value: string): IsoDate {
  if (!ISO_DATE_RE.test(value)) {
    throw new Error(`非法 date 格式（应为 YYYY-MM-DD）：${value}`);
  }
  return value;
}

/** 校验 ISO8601 时间戳 */
export function assertIsoDateTime(value: string): IsoDateTime {
  if (!ISO_DATETIME_RE.test(value)) {
    throw new Error(`非法 timestamp 格式（应为 ISO8601）：${value}`);
  }
  return value;
}

// ═══════════════════════════════════════════════════════════
// 数据库连接
// ═══════════════════════════════════════════════════════════

/** 连接配置（由环境变量装配，见 `client.ts`） */
export interface DbConnectionConfig {
  dialect: Dialect;
  /** PG：`postgres://...`；SQLite：`file:./data/forge.db` 或绝对路径 */
  url: string;
  /** 连接池上限（SQLite 恒为 1，见 client-sqlite.ts 说明） */
  maxConnections: number;
  /** SQL 追踪日志开关 */
  debug: boolean;
}

/** 迁移执行结果 */
export interface MigrationResult {
  dialect: Dialect;
  /** 本次实际执行的迁移文件名 */
  applied: string[];
  /** 已在库中、被跳过的迁移文件名 */
  skipped: string[];
  executionMs: number;
}

// ═══════════════════════════════════════════════════════════
// 通用 JSON 列
// ═══════════════════════════════════════════════════════════

/** `json` 列的应用层类型（§4.4：写入前 stringify，读取时 parse） */
export type JsonValue =
  | string
  | number
  | boolean
  | null
  | JsonValue[]
  | { [key: string]: JsonValue };

/** 常见 JSON 列的具体形状（与 §4.2 各表的 `*_json` 列对应） */
export type PassRuleJson = {
  masteryMin?: number;
  scoreMin?: number;
  attemptsMin?: number;
};

export type WeightJson = {
  acoustic: number;
  per: number;
  wer: number;
};

export type LatencyJson = {
  asr?: number;
  align?: number;
  phone?: number;
  score?: number;
  total?: number;
};

/** 逐音素明细（§4.2.8 `phone_score.phones_json`） */
export type PhonesJson = Array<{
  i: number;
  expected: string;
  actual: string | null;
  op: 'match' | 'substitution' | 'deletion' | 'insertion';
  conf: number;
  start: number;
  end: number;
  type: string;
}>;

/** 拼写/听写四色 diff（§4.2.6 `diff_json`） */
export type DiffJson = Array<{
  word: string;
  color: 'correct' | 'wrong' | 'missing' | 'extra';
  refIndex: number;
  hypIndex: number;
}>;

/** 三段式纠错卡（§4.2.11 `correction_json`） */
export type CorrectionJson = {
  correction: string;
  why: string;
  continue: string;
};

/** `lesson_block.word_ids`：5 个 word_id */
export type WordIdsJson = Id[];

/** `game_record.wrong_words`：[{word_id, count}] */
export type WrongWordsJson = Array<{ word_id: Id; count: number }>;

// ═══════════════════════════════════════════════════════════
// 查询结果包装
// ═══════════════════════════════════════════════════════════

/** 分页结果（§5.2 列表接口统一 `{items,total,page,pageSize}`） */
export interface Paged<T> {
  items: T[];
  total: number;
  page: number;
  pageSize: number;
}

/** 家长可见孩子 id 的查询结果（安全红线的返回类型） */
export interface VisibleChildIds {
  parentId: Id;
  childIds: Id[];
}
