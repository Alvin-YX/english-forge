/**
 * 档案上下文注入装饰器 —— 业务 Service/Controller 取 `ProfileScope` 的唯一入口。
 *
 * 🔴 `@ProfileScope()` 必须是「涉及档案数据的 Service 方法」的**显式参数**。
 *    这让 code review 有一个确定的检查点：方法签名里没有 `@ProfileScope()`
 *    就该问一句「它凭什么能查用户数据？」。
 *
 * 缺失即抛 401，绝不返回 undefined —— 否则调用方可能默默漏掉档案过滤。
 */

import { createParamDecorator, type ExecutionContext } from '@nestjs/common';

import { unauthenticatedError } from '../../common/errors.business.js';

import type { JwtProfilePayload, ProfileScope } from './profile-scope.js';

/** 注入当前请求的档案作用域（由 `ProfileGuard` 写入） */
export const CurrentUser = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): ProfileScope => {
    const req = ctx.switchToHttp().getRequest();
    if (req.scope === undefined) {
      throw unauthenticatedError('缺少档案上下文（该路由应经过 ProfileGuard）');
    }
    return req.scope;
  },
);

/** 注入 JWT 原始 payload（含登录时快照的 role，仅供调试/日志使用） */
export const CurrentPayload = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): JwtProfilePayload => {
    const req = ctx.switchToHttp().getRequest();
    if (req.user === undefined) {
      throw unauthenticatedError();
    }
    return req.user;
  },
);
