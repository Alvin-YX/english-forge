/**
 * 🔴 档案守卫 —— REQ-011 架构级隔离的第二层（第一层是 JWT 里的 profileId）。
 *
 * 职责：把「JWT 里的声明」变成「库中可证的事实」，并注入 `request.scope`。
 *
 * 校验链（任一步失败即拒绝）：
 *   1. JWT 存在且形状合法（`sub`/`profileId`/`role`）；
 *   2. `user_profile` 中该档案**存在**；
 *   3. 该档案**属于**该账号（`user_profile.user_id === jwt.sub`）——
 *      防「用 A 的 token 去声明 B 的档案 id」；
 *   4. 账号状态为 `active`。
 *
 * 🔴 角色以**库里**的为准，不用 JWT 里的快照：
 *    JWT 有效期 15 分钟，管理员改角色后不应等 token 过期才生效。
 *    JWT 里的 `role` 仅作 shape 校验与冷启动兜底。
 *
 * 🔴 作为 `APP_GUARD` 全局注册（`app.module.ts`），
 *    **默认所有路由都需要档案上下文**，只有 `@Public()` 才豁免。
 */

import { user, userProfile } from '@eng-forge/db/schema';
import { type CanActivate, type ExecutionContext, Injectable, Inject } from '@nestjs/common';
import { Reflector } from '@nestjs/core';

import { profileForbiddenError, unauthenticatedError } from '../../common/errors.business.js';
import { DbConnection } from '../db/db.module.js';
import { eq } from '../db/query.js';

import { type ProfileScope, isJwtProfilePayload } from './profile-scope.js';
import { IS_PUBLIC_KEY } from './public.decorator.js';

@Injectable()
export class ProfileGuard implements CanActivate {
  constructor(
    @Inject(DbConnection) private readonly conn: DbConnection,
    @Inject(Reflector) private readonly reflector: Reflector,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    if (this.isPublic(context)) return true;

    const request = context.switchToHttp().getRequest();
    const payload = request.user;

    if (!isJwtProfilePayload(payload)) {
      throw unauthenticatedError('JWT 缺少档案标识，拒绝解析档案上下文');
    }

    // 档案必须存在且属于该账号 —— 一次 join 同时拿到 role 与 status，避免两次往返
    const rows = await this.conn.db
      .select({ profileUserId: userProfile.userId, role: user.role, status: user.status })
      .from(userProfile)
      .leftJoin(user, eq(userProfile.userId, user.id))
      .where(eq(userProfile.userId, payload.profileId))
      .limit(1);

    const row = rows[0];
    if (row === undefined || row.role === null || row.status === null) {
      throw profileForbiddenError('档案不存在或已删除');
    }
    if (row.profileUserId !== payload.sub) {
      throw profileForbiddenError('该档案不属于当前账号');
    }
    if (row.status !== 'active') {
      throw profileForbiddenError('账号已被停用');
    }

    // 🔴 写入 request 的唯一位置。字段是 `optional` 的，无法从客户端伪造。
    const scope: ProfileScope = {
      userId: row.profileUserId,
      profileId: row.profileUserId,
      role: row.role,
    };
    request.scope = scope;
    request.userId = scope.userId;
    request.profileId = scope.profileId;
    request.role = scope.role;
    return true;
  }

  private isPublic(context: ExecutionContext): boolean {
    return (
      this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [context.getHandler(), context.getClass()]) === true
    );
  }
}
