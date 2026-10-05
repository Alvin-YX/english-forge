/**
 * 认证模块 —— 业务层，注册 / 登录 / 刷新。
 *
 * 🔴 与 `infra/profile/auth-infra.module.ts` 的分工：
 *    - `AuthInfraModule`（infra）：提供 JwtService 实例 + 全局守卫（@Global）
 *    - `AuthModule`（modules）：注册业务路由与 service，不含任何全局 provider
 *
 * 🔴 本模块不 `imports` 任何 DB 或 JWT 模块 ——
 *    那些都是 `@Global()` 模块（`DbModule` / `AuthInfraModule`），
 *    已在全应用范围内自动提供 provider。
 */

import { Module } from '@nestjs/common';

import { AuthController } from './auth.controller.js';
import { AuthService } from './auth.service.js';

@Module({
  controllers: [AuthController],
  providers: [AuthService],
})
export class AuthModule {}
