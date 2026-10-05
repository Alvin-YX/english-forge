/**
 * Express `Request` 的档案上下文扩展（全局声明，全仓共享）。
 *
 * 🔴 只有 `ProfileGuard` 能写 `scope` / `userId` / `profileId` / `role`，
 *    业务层**只读**。这些字段无法从请求体或 query 注入 ——
 *    这正是「架构级强制」的第一层：数据来源被物理隔离在认证守卫之后。
 */

import type { Role } from '@eng-forge/contracts/enums';

import type { JwtProfilePayload, ProfileScope } from './profile-scope.js';

declare module 'express-serve-static-core' {
  interface Request {
    /** JWT 校验通过后的 payload（passport-jwt strategy 写入） */
    user?: JwtProfilePayload;
    /** 🔴 档案作用域：所有按档案隔离的查询必须用它 */
    scope?: ProfileScope;
    /** 账号 id（冗余暴露，便于日志与幂等键计算） */
    userId?: number;
    /** 档案 id（🔴 不接受客户端传入值，只由 JWT 解析得到） */
    profileId?: number;
    role?: Role;
  }
}
