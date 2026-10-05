/**
 * 幂等模块 —— `@Global()`。
 *
 * 只提供两件基础设施：`IdempotencyStore`（表读写）与
 * `IdempotencyInterceptor`（请求去重）。无任何业务语义。
 *
 * 🔴 全局注册为 `APP_INTERCEPTOR` 必须放在 `EnvelopeInterceptor` **外层**
 *    （`app.module.ts` 的数组顺序即该约定），详见 idempotency.interceptor.ts 头部。
 */

import { Global, Module } from '@nestjs/common';

import { DbModule } from '../db/db.module.js';

import { IdempotencyInterceptor } from './idempotency.interceptor.js';
import { IdempotencyStore } from './idempotency.store.js';

@Global()
@Module({
  imports: [DbModule],
  providers: [IdempotencyStore, IdempotencyInterceptor],
  exports: [IdempotencyStore, IdempotencyInterceptor],
})
export class IdempotencyModule {}
