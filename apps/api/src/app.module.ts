/**
 * 根模块。
 *
 * 🔴 三段全局注册顺序是本项目的**契约**，改顺序就会出安全事故：
 *
 * `APP_GUARD`（从左到右依次执行）：
 *   1. `JwtAuthGuard`   —— 验签、解析 payload；`@Public()` 路由直接跳过
 *   2. `ProfileGuard`   —— 把 JWT 声明变成库中可证的事实，写 `request.scope`
 *   3. `RolesGuard`     —— 读 `request.scope.role` 判角色（必须最后）
 *
 * `APP_INTERCEPTOR`（数组顺序 = 从外到内）：
 *   1. `IdempotencyInterceptor`  —— 外层，缓存**已完成包装**的响应体
 *   2. `EnvelopeInterceptor`     —— 内层，把返回值包成 `{code,message,data}`
 *   调换后幂等重放会返回**未包装**的裸对象，客户端会解析失败。
 *
 * `APP_FILTER`：全局异常过滤器，所有异常在此收敛为统一 envelope。
 *
 * 🔴 采用「默认全鉴权 + `@Public()` 显式白名单」而不是「逐路由 `@UseGuards`」：
 *    漏写 guard 是安全事故（数据越权），漏写 `@Public()` 只是 401，
 *    后者更容易被发现和修复。
 */

import { Module } from '@nestjs/common';
import { APP_FILTER, APP_GUARD, APP_INTERCEPTOR } from '@nestjs/core';

import { EnvelopeInterceptor } from './common/envelope.interceptor.js';
import { ApiExceptionFilter } from './common/http-exception.filter.js';
import { ConfigModule } from './infra/config/config.module.js';
import { StoresModule } from './infra/config/stores.module.js';
import { DbModule } from './infra/db/db.module.js';
import { IdempotencyInterceptor } from './infra/idempotency/idempotency.interceptor.js';
import { IdempotencyModule } from './infra/idempotency/idempotency.module.js';
import { AuthInfraModule } from './infra/profile/auth-infra.module.js';
import { JwtAuthGuard } from './infra/profile/jwt-auth.guard.js';
import { ProfileGuard } from './infra/profile/profile.guard.js';
import { RolesGuard } from './infra/profile/rbac.guard.js';
import { SystemModule } from './modules/system/system.module.js';

@Module({
  imports: [ConfigModule, DbModule, StoresModule, AuthInfraModule, IdempotencyModule, SystemModule],
  providers: [
    // ── 全局守卫（顺序敏感）────────────────────────────────
    { provide: APP_GUARD, useClass: JwtAuthGuard },
    { provide: APP_GUARD, useClass: ProfileGuard },
    { provide: APP_GUARD, useClass: RolesGuard },

    // ── 全局拦截器（外层在前）──────────────────────────────
    { provide: APP_INTERCEPTOR, useClass: IdempotencyInterceptor },
    { provide: APP_INTERCEPTOR, useClass: EnvelopeInterceptor },

    // ── 全局异常过滤器 ───────────────────────────────────
    { provide: APP_FILTER, useClass: ApiExceptionFilter },
  ],
})
export class AppModule {}
