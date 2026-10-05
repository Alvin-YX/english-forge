/**
 * RBAC 守卫 —— 03 文档 §5.1「学生/家长/教师/管理员四角色」。
 *
 * 用法：`@Roles(Role.PARENT)` 或 `@Roles(Role.TEACHER, Role.ADMIN)`。
 * 未标 `@Roles` 的路由只要过了 `ProfileGuard` 即可访问（如 `GET /me`、`GET /me/profile`）。
 *
 * 🔴 必须排在 `ProfileGuard` **之后**：它读的 `request.scope.role` 由 ProfileGuard 写入。
 *    顺序在 `app.module.ts` 的 `APP_GUARD` 数组中固定。
 */

import { type Role } from '@eng-forge/contracts/enums';
import { type CanActivate, type ExecutionContext, Injectable, SetMetadata, Inject } from '@nestjs/common';
import { Reflector } from '@nestjs/core';

import { rbacDeniedError, unauthenticatedError } from '../../common/errors.business.js';

import { IS_PUBLIC_KEY } from './public.decorator.js';

export const ROLES_KEY = 'auth:roles';

export const Roles = (...roles: Role[]): MethodDecorator & ClassDecorator => SetMetadata(ROLES_KEY, roles);

@Injectable()
export class RolesGuard implements CanActivate {
  constructor(@Inject(Reflector) private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    if (this.read<boolean>(IS_PUBLIC_KEY, context) === true) return true;

    const required = this.read<Role[] | undefined>(ROLES_KEY, context);
    if (required === undefined || required.length === 0) return true;

    const request = context.switchToHttp().getRequest();
    if (request.scope === undefined) {
      // 理论不可达（ProfileGuard 在其之前）；防御性兜底
      throw unauthenticatedError('缺少档案上下文，无法判定角色');
    }
    if (!required.includes(request.scope.role)) {
      throw rbacDeniedError();
    }
    return true;
  }

  private read<T>(key: string, context: ExecutionContext): T | undefined {
    return this.reflector.getAllAndOverride<T | undefined>(key, [context.getHandler(), context.getClass()]);
  }
}
