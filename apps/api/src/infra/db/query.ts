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
