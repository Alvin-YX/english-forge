/**
 * AI 对话域控制器 —— 覆盖 ai_conversation / ai_message
 *
 * 🔴 所有路由都需要档案上下文（全局 ProfileGuard 已注册），
 *    @CurrentUser() 是唯一获取 ProfileScope 的入口。
 */

import {
  Body,
  Controller,
  Delete,
  Get,
  Inject,
  Param,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { z } from 'zod';

import { zodPipe } from '../../common/zod-validation.pipe.js';
import { CurrentUser } from '../../infra/profile/current-user.decorator.js';
import { type ProfileScope } from '../../infra/profile/profile-scope.js';

import {
  type ConversationView,
  type CreateConversationInput,
  type ListConversationsQuery,
  type ListMessagesQuery,
  type MessageView,
  type SendMessageInput,
  ConversationService,
  CREATE_CONVERSATION_SCHEMA,
  LIST_CONVERSATIONS_QUERY_SCHEMA,
  LIST_MESSAGES_QUERY_SCHEMA,
  SEND_MESSAGE_SCHEMA,
} from './conversation.service.js';

const POSITIVE_INT = z.coerce.number().int().positive();

@Controller('conversations')
@ApiTags('conversation')
export class ConversationController {
  constructor(@Inject(ConversationService) private readonly service: ConversationService) {}

  // ═══════════════════════════════════════════════════════════
  // ai_conversation CRUD
  // ═══════════════════════════════════════════════════════════

  /** POST /conversations —— 创建对话 */
  @Post()
  @ApiOperation({ summary: '创建对话' })
  async create(
    @CurrentUser() scope: ProfileScope,
    @Body(zodPipe(CREATE_CONVERSATION_SCHEMA)) body: CreateConversationInput,
  ): Promise<ConversationView> {
    return this.service.createConversation(scope, body);
  }

  /** GET /conversations —— 对话列表 */
  @Get()
  @ApiOperation({ summary: '对话列表（分页、按模式/状态过滤、排序）' })
  async list(
    @CurrentUser() scope: ProfileScope,
    @Query(zodPipe(LIST_CONVERSATIONS_QUERY_SCHEMA)) query: ListConversationsQuery,
  ): Promise<{ items: ConversationView[]; total: number; page: number; pageSize: number; totalPages: number }> {
    return this.service.listConversations(scope, query);
  }

  /** GET /conversations/:id —— 对话详情 */
  @Get(':id')
  @ApiOperation({ summary: '对话详情' })
  async get(
    @CurrentUser() scope: ProfileScope,
    @Param('id', zodPipe(POSITIVE_INT)) id: number,
  ): Promise<ConversationView> {
    return this.service.getConversation(scope, id);
  }

  /** PATCH /conversations/:id/finish —— 结束对话 */
  @Patch(':id/finish')
  @ApiOperation({ summary: '结束对话（标记为 finished，记录结束时间）' })
  async finish(
    @CurrentUser() scope: ProfileScope,
    @Param('id', zodPipe(POSITIVE_INT)) id: number,
  ): Promise<ConversationView> {
    return this.service.finishConversation(scope, id);
  }

  /** DELETE /conversations/:id —— 删除对话 */
  @Delete(':id')
  @ApiOperation({ summary: '删除对话（级联删除消息）' })
  async delete(
    @CurrentUser() scope: ProfileScope,
    @Param('id', zodPipe(POSITIVE_INT)) id: number,
  ): Promise<void> {
    return this.service.deleteConversation(scope, id);
  }

  // ═══════════════════════════════════════════════════════════
  // ai_message
  // ═══════════════════════════════════════════════════════════

  /** GET /conversations/:conversationId/messages —— 消息列表 */
  @Get(':conversationId/messages')
  @ApiOperation({ summary: '消息列表（分页、按 seq 升序）' })
  async listMessages(
    @CurrentUser() scope: ProfileScope,
    @Param('conversationId', zodPipe(POSITIVE_INT)) conversationId: number,
    @Query(zodPipe(LIST_MESSAGES_QUERY_SCHEMA)) query: ListMessagesQuery,
  ): Promise<{ items: MessageView[]; total: number; page: number; pageSize: number; totalPages: number }> {
    return this.service.listMessages(scope, conversationId, query);
  }

  /** POST /conversations/:conversationId/messages —— 发送消息 */
  @Post(':conversationId/messages')
  @ApiOperation({ summary: '发送消息（自动递增 seq，联动会话计数器）' })
  async sendMessage(
    @CurrentUser() scope: ProfileScope,
    @Param('conversationId', zodPipe(POSITIVE_INT)) conversationId: number,
    @Body(zodPipe(SEND_MESSAGE_SCHEMA)) body: SendMessageInput,
  ): Promise<MessageView> {
    return this.service.sendMessage(scope, conversationId, body);
  }

  /** GET /conversations/:conversationId/messages/:messageId —— 单条消息详情 */
  @Get(':conversationId/messages/:messageId')
  @ApiOperation({ summary: '单条消息详情' })
  async getMessage(
    @CurrentUser() scope: ProfileScope,
    @Param('conversationId', zodPipe(POSITIVE_INT)) conversationId: number,
    @Param('messageId', zodPipe(POSITIVE_INT)) messageId: number,
  ): Promise<MessageView> {
    return this.service.getMessage(scope, conversationId, messageId);
  }
}
