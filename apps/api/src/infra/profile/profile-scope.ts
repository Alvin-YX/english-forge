/**
 * 🔴 profile_id 隔离核心原语 —— 04 文档 REQ-011「账号隔离改为架构保证」
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * 语义区分（**这是本文件最重要的注释，删掉它就会有下一个人搞混**）：
 *
 *   userId    = 账号身份（登录主体，`user.id`）—— 谁在登录
 *   profileId = 学习档案（数据归属，`user_profile.id`）—— 数据属于谁
 *
 * 二者在**当前 schema 下数值相等**（`user_profile` 以 `user_id` 为主键，1:1），
 * 但**语义必须分开**：
 *   - 04 文档 REQ-011 明确「≤10 档案」，v2.0 可能一账号多档案；
 *   - 到那时只需改「签发 JWT」与「解析 profile」两处，
 *     所有业务查询（都用 `scope.profileId` 过滤）一行不用动。
 * 反过来，若把两者直接混用（拿 `scope.userId` 去过滤业务表），
 * 多档案那天就是全站数据串号。
 *
 * ⚠️ 已知 schema 偏差（如实登记，未擅自改包）：落地 schema 里**没有** `profile_id`
 * 列，所有用户归属表用的是 `user_id`（`user_profile` / `parent_children` /
 * `enrollment` / `idempotency_key` / `learning_record` …）。
 * 因此 `profileWhere(scope, table.userId, ...)` 的列名是 `userId`，
 * 但传入的值语义上是「档案 id」。详见 ADR-0004「schema 偏差」章节。
 * ═══════════════════════════════════════════════════════════════════════════
 */

import { type Role, ROLES } from '@eng-forge/contracts/enums';
import type { AnyColumn, SQL } from 'drizzle-orm';

import { profileForbiddenError } from '../../common/errors.business.js';
import { and, eq } from '../db/query.js';

/** JWT payload 中承载的档案三元组（`sub` 用标准字段名，便于跨语言互通） */
export interface JwtProfilePayload {
  /** 账号 id（`user.id`） */
  sub: number;
  /** 档案 id（`user_profile.id`） */
  profileId: number;
  /** 登录时快照的角色；运行时以 `ProfileGuard` 从库里读的值为准 */
  role: Role;
}

/** 每个已认证请求的档案作用域（`ProfileGuard` 注入到 `request.scope`） */
export interface ProfileScope {
  readonly userId: number;
  readonly profileId: number;
  readonly role: Role;
}

function isPositiveSafeInt(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value > 0;
}

function isRole(value: unknown): value is Role {
  return typeof value === 'string' && (ROLES as readonly string[]).includes(value);
}

/** 仅校验 JWT payload 的**形状**；身份真实性由 JWT 签名保证，此处不重复验签 */
export function isJwtProfilePayload(value: unknown): value is JwtProfilePayload {
  if (typeof value !== 'object' || value === null) return false;
  const v = value as Record<string, unknown>;
  return isPositiveSafeInt(v.sub) && isPositiveSafeInt(v.profileId) && isRole(v.role);
}

/**
 * 🔴 所有「按档案隔离」的查询**必须**通过本函数进入 `where` 子句。
 *
 * 用法：
 * ```ts
 * const rows = await db
 *   .select()
 *   .from(learningRecord)
 *   .where(profileWhere(scope, learningRecord.userId, eq(learningRecord.kind, 'spell')))
 *   .limit(20);
 * ```
 *
 * 🔴 失效模式与三层防线（「Service 手写 `eq(table.userId, 123)` 忘加档案条件」）：
 *   1. `request.scope` 只由 `ProfileGuard` 写入，**无法**从请求体/query 注入；
 *   2. `ProfileGuard` 是 `APP_GUARD` 全局守卫，档案上下文缺失即 401/403，
 *      业务层拿不到 scope 就写不出档案过滤条件；
 *   3. `depcruise` 规则 `profile-scope-chokepoint` 禁止模块层直连 `drizzle-orm`，
 *      算子必须经 `infra/db/query.ts` 取用；本文件是全仓唯一放置档案过滤逻辑的
 *      位置，code review 有固定检查点。
 */
export function profileWhere(
  scope: ProfileScope,
  ownerColumn: AnyColumn,
  ...extra: Array<SQL | undefined>
): SQL {
  // `and()` 运行时会自动忽略 `undefined`，调用方因此可以写
  // `cond ? eq(...) : undefined` 表达可选条件。
  // 断言只用于收敛 drizzle 的返回类型（首元素恒为档案条件，结果不可能 undefined）。
  return and(eq(ownerColumn, scope.profileId), ...extra) as SQL;
}

/**
 * 断言某条数据归当前档案所有，否则抛 `PROFILE_FORBIDDEN (1107)`。
 *
 * 用于任何接收**外部传入 id** 的读/写接口（`PATCH /me/profile`、家长看板按
 * `childId` 查周报、`POST /me/children/bind` …）。
 * 这是防「把别人的 id 填进 URL/请求体」这条攻击路径的收口点。
 *
 * @param ownerId 被查记录上的档案归属列值（通常是 `user_id`）
 */
export function assertOwned(ownerId: number | null | undefined, scope: ProfileScope, resourceLabel = '该资源'): void {
  if (ownerId !== scope.profileId) {
    throw profileForbiddenError(`${resourceLabel}不属于当前档案`);
  }
}
