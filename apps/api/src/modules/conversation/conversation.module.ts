/**
 * AI 对话域模块 —— 03 文档 §4.2.11
 *
 * 🔴 全部路由需要档案上下文（全局 ProfileGuard 已注册）。
 * ConversationService 导出给上层模块复用。
 */

import { Module } from '@nestjs/common';

import { AiModule } from '../../infra/ai/ai.module.js';
import { AuditModule } from '../../infra/audit/audit.module.js';

import { ConversationController } from './conversation.controller.js';
import { ConversationService } from './conversation.service.js';
import { LlmService } from './llm.service.js';

@Module({
  imports: [AuditModule, AiModule],
  controllers: [ConversationController],
  providers: [ConversationService, LlmService],
  exports: [ConversationService, LlmService],
})
export class ConversationModule {}
