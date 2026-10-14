/**
 * system 模块（基础层）—— 03 文档 §5.7
 *
 * 只做进程/依赖存活探测与全局运行参数读写。
 * 🔴 本模块是基础层（见 CONTRIBUTING.md §4 分层表），
 *    不得被任何业务层模块当作反向依赖使用。
 *
 * 依赖方向：system → infra/audit、infra/ai（都是基础设施层），不依赖任何业务模块。
 */

import { Module } from '@nestjs/common';

import { AiModule } from '../../infra/ai/ai.module.js';
import { AuditModule } from '../../infra/audit/audit.module.js';

import { LlmConfigController } from './llm-config.controller.js';
import { SystemController } from './system.controller.js';
import { SystemService } from './system.service.js';

@Module({
  imports: [AuditModule, AiModule],
  controllers: [SystemController, LlmConfigController],
  providers: [SystemService],
  exports: [SystemService],
})
export class SystemModule {}
