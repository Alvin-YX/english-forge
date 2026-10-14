/**
 * 审计模块 —— 提供 `AuditService` 与审计上下文装饰器。
 *
 * 刻意**不做** `@Global()`：审计是有意的动作，模块显式 `imports: [AuditModule]`
 * 让 code review 能看到「这个模块会写审计」，隐式全局提供反而掩盖这一信息。
 * （`StoresModule` 用 `@Global()` 是为了解 `ConfigModule → DbModule → ConfigModule`
 *  的循环，本模块只依赖 `DbModule`，没有这个约束。）
 */

import { Module } from '@nestjs/common';

import { DbModule } from '../db/db.module.js';

import { AuditService } from './audit.service.js';

@Module({
  imports: [DbModule],
  providers: [AuditService],
  exports: [AuditService],
})
export class AuditModule {}
