/**
 * Drizzle 查询算子**唯一出口** —— profile_id 隔离的机械防线之一（ADR-0004）。
 *
 * 规则：`src/modules/**` 下的任何文件**禁止** `import ... from 'drizzle-orm'`，
 * 一律从本文件取算子（`.dependency-cruiser.js` 的 `profile-scope-chokepoint` 规则强制）。
 *
 * 收益：
 * 1. 算子入口收敛到一处，`profileWhere()` 是唯一被认可的档案过滤入口；
 * 2. 若将来要换成 SQL 审计中间件 / ORM 适配，只改这一个文件；
 * 3. 新增算子必须先过本文件，防止业务层绕过基础设施直接摸到 ORM。
 */

import { sql, type Column, type SQL } from 'drizzle-orm';

export {
  and,
  asc,
  count,
  desc,
  eq,
  gt,
  gte,
  inArray,
  isNull,
  isNotNull,
  like,
  lt,
  lte,
  ne,
  not,
  or,
  sql,
} from 'drizzle-orm';

/**
 * 大小写不敏感模糊匹配 —— 双方言可用的 `ilike` 替身。
 *
 * 🔴 为什么不能直接用 Drizzle 的 `ilike()`：
 *    它生成 PG 专有的 `ILIKE` 运算符，SQLite 解析到`ilike` 直接报
 *    `near "ilike": syntax error` → 词条搜索接口全500。
 *    与 `boolColumn` 同属一类缺陷：PG 方言假设泄漏进了双方言共用的查询层。
 *
 * 为什么 `like` 够用：
 * - SQLite 的 `LIKE` 对 ASCII **默认大小写不敏感**，
 *   故 SQLite 档无需额外处理；
 * - PG 的 `LIKE` 是大小写敏感，故两侧统一用 `lower()` 包裹，
 *   语义与 `ILIKE` 等价（对中文无影响，对 ASCII 与 SQLite 对齐）。
 *
 * @param column 文本列
 * @param pattern 含 `%` / `_` 通配的匹配串（**不要**自行拼 `lower()`）
 */
export function ilike(column: Column | SQL.Aliased | SQL, pattern: string): SQL {
  return sql`lower(${column}) like lower(${pattern})`;
}

/**
 * `.update(t).set(...)` 的入参类型 —— 由本模块转出，业务层才能给
 * 「动态拼装的更新字段」拿到真正的列类型约束，而不是退化成 `Record<string, unknown>` + `as any`。
 */
export type { PgUpdateSetSource } from 'drizzle-orm/pg-core';

/** `sql` 模板的产物类型，供业务层声明「条件数组 / orderBy 数组」的元素类型 */
export type { SQL };
