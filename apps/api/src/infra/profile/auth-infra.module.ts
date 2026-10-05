/**
 * 认证基础设施模块 —— `@Global()`，全应用共享。
 *
 * 职责：两套独立密钥的 JwtService + 三个全局守卫。
 *
 * 🔴 为什么 access / refresh 用**两个** JwtService：
 *    access token 只活 15 分钟，泄露影响有限；refresh 活 30 天，
 *    必须用独立密钥，否则拿到 access secret 的人能自己铸 refresh token。
 *
 * 🔴 `@nestjs/jwt` 的 `registerAsync` 不支持别名（v11），
 *    故直接 `new JwtService(options)` 注入两个实例，语义等价且更省。
 *
 * 🔴 **不注册 passport**：认证只有 Bearer JWT 一种方式，
 *    `@nestjs/passport` 会把 `passport` 拉成必填 peer，超出依赖预算上限。
 *    详见 `jwt-auth.guard.ts` 头部注释。
 *
 * 🔴 本模块只提供「认证基础设施」，**不含任何业务逻辑**
 *    （注册/登录/刷新在 `modules/auth`）。分层边界见 `.dependency-cruiser.js`。
 */

import { Global, Module } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';

import type { Env } from '../config/env.js';
import { ENV_CONFIG } from '../config/tokens.js';
import { DbModule } from '../db/db.module.js';

import { JwtAuthGuard } from './jwt-auth.guard.js';
import { JWT_ACCESS, JWT_REFRESH, buildJwtOptions } from './jwt-tokens.js';
import { ProfileGuard } from './profile.guard.js';
import { RolesGuard } from './rbac.guard.js';

export { JWT_ACCESS, JWT_REFRESH, buildJwtOptions };

@Global()
@Module({
  imports: [DbModule],
  providers: [
    {
      provide: JWT_ACCESS,
      inject: [ENV_CONFIG],
      useFactory: (env: Env): JwtService =>
        new JwtService(buildJwtOptions(env.JWT_ACCESS_SECRET, env.JWT_ISSUER, env.JWT_ACCESS_TTL_SEC)),
    },
    {
      provide: JWT_REFRESH,
      inject: [ENV_CONFIG],
      useFactory: (env: Env): JwtService =>
        new JwtService(buildJwtOptions(env.JWT_REFRESH_SECRET, env.JWT_ISSUER, env.JWT_REFRESH_TTL_DAY * 86_400)),
    },
    JwtAuthGuard,
    ProfileGuard,
    RolesGuard,
  ],
  exports: [JWT_ACCESS, JWT_REFRESH, JwtAuthGuard, ProfileGuard, RolesGuard],
})
export class AuthInfraModule {}
