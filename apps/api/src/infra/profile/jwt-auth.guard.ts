/**
 * JWT 认证守卫 —— 直接把 token 交给 `JwtService.verifyAsync()`。
 *
 * 🔴 作为 `APP_GUARD` **全局**注册，因此必须自己识别 `@Public()` 路由并跳过 ——
 *    否则 `/auth/register`、`/healthz` 这类无凭证路由会被要求 Bearer token。
 *    跳过后 `request.user` 保持 undefined，由 `ProfileGuard` 按 public 分支放行。
 *
 * 🔴 刻意**不用** `@nestjs/passport` + `passport-jwt`，原因两条：
 *
 * 1. 依赖预算：`@nestjs/passport` 把 `passport` 声明为**必填** peer，
 *    而本仓库 `.npmrc` 设了 `auto-install-peers=false` + `strict-peer-dependencies=true`，
 *    必须自己显式声明 `passport`。加上它运行依赖就是 13 个，
 *    超过 03 文档 §8.5 的「≤ 12 个」上限；改用 `@nestjs/jwt`
 *    （已声明，自带 `jsonwebtoken`）后是 11 个。
 * 2. 单一认证方式：本应用只有 Bearer JWT，没有本地登录/第三方登录/ACL，
 *    passport 的 strategy 抽象层在这个规模下是纯开销，
 *    还多一层间接（strategy → request.user）不利于安全审计。
 *
 * 错误码映射分工（详见 ADR-0004「错误码映射」）：
 *
 * | 场景                          | 抛出方                          | ErrorCode           |
 * |-------------------------------|---------------------------------|---------------------|
 * | 缺少/空 Bearer token          | 本守卫 `extractBearerToken()`   | 1101 UNAUTHENTICATED|
 * | token 过期                    | `verifyAsync` → `TokenExpiredError`    | 1102 TOKEN_EXPIRED |
 * | 签名错 / issuer 不符 / 格式坏 | `verifyAsync` → `JsonWebTokenError`/`NotBeforeError` | 1103 TOKEN_INVALID |
 * | payload 形状不合法            | 本守卫 `isJwtProfilePayload()` | 1103 TOKEN_INVALID  |
 *
 * 后两类由 `ApiExceptionFilter` 按 `Error.name` 捕获 ——
 * `verifyAsync` 抛的是 jsonwebtoken 的原生错误对象，不是 `HttpException`，
 * 直接穿透到全局过滤器，不需要在本守卫里再包一层。
 */

import { type CanActivate, type ExecutionContext, Injectable, Inject } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { type JwtService } from '@nestjs/jwt';
import type { Request } from 'express';

import { tokenInvalidError, unauthenticatedError } from '../../common/errors.business.js';

import { JWT_ACCESS } from './jwt-tokens.js';
import { isJwtProfilePayload } from './profile-scope.js';
import { IS_PUBLIC_KEY } from './public.decorator.js';

const BEARER_PREFIX = 'Bearer ';

/** 从 `Authorization` 头取出 Bearer token；缺失或形态不符即抛 1101 */
function extractBearerToken(request: Request): string {
  const raw = request.headers.authorization;
  if (typeof raw !== 'string' || !raw.startsWith(BEARER_PREFIX)) {
    throw unauthenticatedError('缺少登录凭证（Authorization: Bearer <token>）');
  }
  const token = raw.slice(BEARER_PREFIX.length).trim();
  if (token === '') {
    throw unauthenticatedError('缺少登录凭证（Authorization: Bearer <token>）');
  }
  return token;
}

@Injectable()
export class JwtAuthGuard implements CanActivate {
  constructor(
    @Inject(JWT_ACCESS) private readonly jwt: JwtService,
    @Inject(Reflector) private readonly reflector: Reflector,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    if (this.isPublic(context)) return true;

    const request = context.switchToHttp().getRequest<Request>();
    const token = extractBearerToken(request);

    // issuer 校验在 `verifyOptions` 里（见 `buildJwtOptions`），
    // 因此拿别的 issuer 签出来的 token 会直接报 1103
    const payload = (await this.jwt.verifyAsync(token)) as unknown;
    if (!isJwtProfilePayload(payload)) {
      // payload 缺少 profileId 或 sub —— 这不是「token 无效」，而是「凭证不完整」
      // 按 UNAUTHENTICATED 处理，因为签名本身是合法的
      const v = payload as Record<string, unknown> | null;
      if (v && typeof v === 'object' && v.sub !== undefined && v.profileId === undefined) {
        throw unauthenticatedError('登录凭证缺少档案标识');
      }
      throw tokenInvalidError('登录凭证无效（缺少档案标识）');
    }

    request.user = payload;
    return true;
  }

  private isPublic(context: ExecutionContext): boolean {
    return this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [context.getHandler(), context.getClass()]) === true;
  }
}
