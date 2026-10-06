/**
 * AI 对话域模块 —— 03 文档 §4.2.11
 *
 * 🔴 全部路由需要档案上下文（全局 ProfileGuard 已注册）。
 * ConversationService 导出给上层模块复用。
 */

import { Module } from '@nestjs/common';

import { ConversationController } from './conversation.controller.js';
import { ConversationService } from './conversation.service.js';

@Module({
  controllers: [ConversationController],
  providers: [ConversationService],
  exports: [ConversationService],
})
export class ConversationModule {}
