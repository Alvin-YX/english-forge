/**
 * AI 对话域服务 —— 03 文档 §4.2.11
 *
 * 🔴 覆盖：
 *   - ai_conversation  AI 对话会话（CRUD + 状态流转）
 *   - ai_message        对话消息（分页、seq 自动递增、计数器联动）
 *
 * 🔴 本模块**必须 profileWhere 过滤的是**：
 *   - aiConversation（直接有 userId 列，用语义上的档案 id）
 *   - aiMessage（无 userId 列，通过先验证 conversation 归属间接保证）
 *
 * 🔴 安全与合规（04 文档 §9.2）：
 *   - providerUsed 记录实际生效的 AI 服务（ollama/cloud/rule）
 *   - fallbackUsed 标记是否发生降级
 *   - aiMessage.filtered 记录安全过滤命中
 */

import { ErrorCode } from '@eng-forge/contracts/api';
import {
  aiConversation,
  aiMessage,
  AI_PROVIDERS,
  CONVERSATION_MODES,
  CONVERSATION_STATUSES,
  MESSAGE_INPUT_TYPES,
  MESSAGE_ROLES,
  type AiMessageRow,
  type AiConversationRow,
} from '@eng-forge/db/schema';
import { Inject, Injectable } from '@nestjs/common';
import { z } from 'zod';

import { notFoundError } from '../../common/errors.business.js';
import { DbConnection } from '../../infra/db/db.module.js';
import { and, asc, count, desc, eq, sql } from '../../infra/db/query.js';
import { profileWhere, type ProfileScope } from '../../infra/profile/profile-scope.js';

// ═══════════════════════════════════════════════════════════
// View 类型
// ═══════════════════════════════════════════════════════════

export interface ConversationView {
  id: number;
  mode: (typeof CONVERSATION_MODES)[number];
  persona: string;
  scenarioId?: string;
  level: string;
  providerUsed?: (typeof AI_PROVIDERS)[number];
  fallbackUsed: boolean;
  turnCount: number;
  totalTokens: number;
  summaryMd?: string;
  suggestionMd?: string;
  status: (typeof CONVERSATION_STATUSES)[number];
  startedAt: string;
  endedAt?: string;
}

export interface MessageView {
  id: number;
  conversationId: number;
  seq: number;
  role: (typeof MESSAGE_ROLES)[number];
  content: string;
  inputType: (typeof MESSAGE_INPUT_TYPES)[number];
  recordingId?: number;
  asrText?: string;
  translationZh?: string;
  correctionJson?: unknown;
  ttsAudioPath?: string;
  provider?: (typeof AI_PROVIDERS)[number];
  tokens?: number;
  latencyMs?: number;
  filtered: boolean;
  createdAt: string;
}

// ═══════════════════════════════════════════════════════════
// Zod schemas
// ═══════════════════════════════════════════════════════════

const POSITIVE_INT = z.coerce.number().int().positive();

export const CREATE_CONVERSATION_SCHEMA = z.object({
  mode: z.nativeEnum(CONVERSATION_MODES),
  persona: z.string().max(32).optional().default('tutor'),
  scenarioId: z.string().max(64).optional(),
  level: z.string().max(16),
});

export const LIST_CONVERSATIONS_QUERY_SCHEMA = z.object({
  page: POSITIVE_INT.optional().default(1),
  pageSize: z.coerce.number().int().positive().max(100).optional().default(20),
  mode: z.nativeEnum(CONVERSATION_MODES).optional(),
  status: z.nativeEnum(CONVERSATION_STATUSES).optional(),
  sortBy: z.enum(['startedAt', 'turnCount']).optional().default('startedAt'),
  sortDir: z.enum(['asc', 'desc']).optional().default('desc'),
});

export const SEND_MESSAGE_SCHEMA = z.object({
  role: z.nativeEnum(MESSAGE_ROLES),
  content: z.string().max(2000),
  inputType: z.nativeEnum(MESSAGE_INPUT_TYPES).optional().default('text'),
  recordingId: POSITIVE_INT.optional(),
  asrText: z.string().max(2000).optional(),
  translationZh: z.string().max(2000).optional(),
  correctionJson: z.unknown().optional(),
  provider: z.nativeEnum(AI_PROVIDERS).optional(),
  tokens: z.number().int().min(0).optional(),
  latencyMs: z.number().int().min(0).optional(),
  filtered: z.boolean().optional().default(false),
});

export const LIST_MESSAGES_QUERY_SCHEMA = z.object({
  page: POSITIVE_INT.optional().default(1),
  pageSize: z.coerce.number().int().positive().max(100).optional().default(50),
});

export type CreateConversationInput = z.infer<typeof CREATE_CONVERSATION_SCHEMA>;
export type ListConversationsQuery = z.infer<typeof LIST_CONVERSATIONS_QUERY_SCHEMA>;
export type SendMessageInput = z.infer<typeof SEND_MESSAGE_SCHEMA>;
export type ListMessagesQuery = z.infer<typeof LIST_MESSAGES_QUERY_SCHEMA>;

// ═══════════════════════════════════════════════════════════
// 常量
// ═══════════════════════════════════════════════════════════

const PAGE_SIZE_MAX = 100;

// ═══════════════════════════════════════════════════════════
// Service
// ═══════════════════════════════════════════════════════════

@Injectable()
export class ConversationService {
  constructor(@Inject(DbConnection) private readonly conn: DbConnection) {}

  // ═══════════════════════════════════════════════════════════
  // 私有辅助：验证对话归属
  // ═══════════════════════════════════════════════════════════

  /**
   * 🔴 验证对话归属于当前档案。
   * aiMessage 无 userId 列，通过先验证 conversation 归属间接保证消息归属。
   * 这是防「把别人的 conversationId 填进 URL」的收口点。
   */
  private async assertConversationOwned(
    scope: ProfileScope,
    conversationId: number,
  ): Promise<void> {
    const [conv] = await this.conn.db
      .select({ id: aiConversation.id, userId: aiConversation.userId })
      .from(aiConversation)
      .where(
        profileWhere(
          scope,
          aiConversation.userId,
          eq(aiConversation.id, conversationId),
        ),
      )
      .limit(1);

    if (conv === undefined) {
      throw notFoundError(ErrorCode.CONVERSATION_NOT_FOUND, '对话不存在');
    }
  }

  // ═══════════════════════════════════════════════════════════
  // 私有辅助：Row → View 映射
  // ═══════════════════════════════════════════════════════════

  private toConversationView(row: AiConversationRow): ConversationView {
    return {
      id: row.id,
      mode: row.mode,
      persona: row.persona,
      scenarioId: row.scenarioId ?? undefined,
      level: row.level,
      providerUsed: row.providerUsed ?? undefined,
      fallbackUsed: row.fallbackUsed,
      turnCount: row.turnCount,
      totalTokens: row.totalTokens,
      summaryMd: row.summaryMd ?? undefined,
      suggestionMd: row.suggestionMd ?? undefined,
      status: row.status,
      startedAt: row.startedAt.toISOString(),
      endedAt: row.endedAt?.toISOString() ?? undefined,
    };
  }

  private toMessageView(row: AiMessageRow): MessageView {
    return {
      id: row.id,
      conversationId: row.conversationId,
      seq: row.seq,
      role: row.role,
      content: row.content,
      inputType: row.inputType,
      recordingId: row.recordingId ?? undefined,
      asrText: row.asrText ?? undefined,
      translationZh: row.translationZh ?? undefined,
      correctionJson: row.correctionJson ?? undefined,
      ttsAudioPath: row.ttsAudioPath ?? undefined,
      provider: row.provider ?? undefined,
      tokens: row.tokens ?? undefined,
      latencyMs: row.latencyMs ?? undefined,
      filtered: row.filtered,
      createdAt: row.createdAt.toISOString(),
    };
  }

  // ═══════════════════════════════════════════════════════════
  // ai_conversation CRUD
  // ═══════════════════════════════════════════════════════════

  /** 创建对话 */
  async createConversation(
    scope: ProfileScope,
    input: CreateConversationInput,
  ): Promise<ConversationView> {
    const now = new Date();

    const result = await this.conn.db
      .insert(aiConversation)
      .values({
        userId: scope.profileId,
        mode: input.mode,
        persona: input.persona,
        scenarioId: input.scenarioId,
        level: input.level,
        status: 'active',
        startedAt: now,
      })
      .returning();

    const row = result[0];
    return this.toConversationView(row);
  }

  /** 对话列表 */
  async listConversations(
    scope: ProfileScope,
    query: ListConversationsQuery,
  ): Promise<{ items: ConversationView[]; total: number; page: number; pageSize: number; totalPages: number }> {
    const page = query.page;
    const pageSize = Math.min(query.pageSize, PAGE_SIZE_MAX);

    // 动态过滤条件（直接传给 profileWhere）
    const where = profileWhere(
      scope,
      aiConversation.userId,
      query.mode ? eq(aiConversation.mode, query.mode) : undefined,
      query.status ? eq(aiConversation.status, query.status) : undefined,
    );

    // 排序
    const dir = query.sortDir;
    const sortField = query.sortBy === 'turnCount' ? aiConversation.turnCount : aiConversation.startedAt;
    const orderBy = [
      dir === 'asc' ? asc(sortField) : desc(sortField),
      desc(aiConversation.id),
    ];

    // 总数
    const countRows = await this.conn.db
      .select({ total: count() })
      .from(aiConversation)
      .where(where)
      .limit(1);
    const total = countRows[0]?.total ?? 0;
    const totalPages = Math.max(1, Math.ceil(total / pageSize));

    // 分页查询
    const rows = await this.conn.db
      .select()
      .from(aiConversation)
      .where(where)
      .orderBy(...(orderBy as any[]))
      .limit(pageSize)
      .offset((page - 1) * pageSize);

    const items: ConversationView[] = rows.map((row: AiConversationRow) => this.toConversationView(row));

    return { items, total, page, pageSize, totalPages };
  }

  /** 对话详情 */
  async getConversation(
    scope: ProfileScope,
    id: number,
  ): Promise<ConversationView> {
    const rows = await this.conn.db
      .select()
      .from(aiConversation)
      .where(
        profileWhere(
          scope,
          aiConversation.userId,
          eq(aiConversation.id, id),
        ),
      )
      .limit(1);

    const row = rows[0];
    if (row === undefined) {
      throw notFoundError(ErrorCode.CONVERSATION_NOT_FOUND, '对话不存在');
    }

    return this.toConversationView(row);
  }

  /** 结束对话 */
  async finishConversation(
    scope: ProfileScope,
    id: number,
  ): Promise<ConversationView> {
    // 先验证存在
    await this.assertConversationOwned(scope, id);

    const now = new Date();
    await this.conn.db
      .update(aiConversation)
      .set({
        status: 'finished',
        endedAt: now,
      } as any)
      .where(
        profileWhere(
          scope,
          aiConversation.userId,
          eq(aiConversation.id, id),
        ),
      );

    // 返回更新后的视图
    return this.getConversation(scope, id);
  }

  /** 删除对话 */
  async deleteConversation(scope: ProfileScope, id: number): Promise<void> {
    // 先验证存在
    await this.assertConversationOwned(scope, id);

    await this.conn.db
      .delete(aiConversation)
      .where(
        profileWhere(
          scope,
          aiConversation.userId,
          eq(aiConversation.id, id),
        ),
      );
    // aiMessage 通过 FK ON DELETE CASCADE 自动删除
  }

  // ═══════════════════════════════════════════════════════════
  // ai_message
  // ═══════════════════════════════════════════════════════════

  /** 消息列表 */
  async listMessages(
    scope: ProfileScope,
    conversationId: number,
    query: ListMessagesQuery,
  ): Promise<{ items: MessageView[]; total: number; page: number; pageSize: number; totalPages: number }> {
    // 验证对话归属
    await this.assertConversationOwned(scope, conversationId);

    const page = query.page;
    const pageSize = Math.min(query.pageSize, PAGE_SIZE_MAX);

    // 总数
    const countRows = await this.conn.db
      .select({ total: count() })
      .from(aiMessage)
      .where(eq(aiMessage.conversationId, conversationId))
      .limit(1);
    const total = countRows[0]?.total ?? 0;
    const totalPages = Math.max(1, Math.ceil(total / pageSize));

    // 分页查询（按 seq 升序）
    const rows = await this.conn.db
      .select()
      .from(aiMessage)
      .where(eq(aiMessage.conversationId, conversationId))
      .orderBy(asc(aiMessage.seq))
      .limit(pageSize)
      .offset((page - 1) * pageSize);

    const items: MessageView[] = rows.map((row: AiMessageRow) => this.toMessageView(row));

    return { items, total, page, pageSize, totalPages };
  }

  /** 发送消息 */
  async sendMessage(
    scope: ProfileScope,
    conversationId: number,
    input: SendMessageInput,
  ): Promise<MessageView> {
    // 验证对话归属
    await this.assertConversationOwned(scope, conversationId);

    // 获取当前最大 seq
    const [maxRow] = await this.conn.db
      .select({ max: sql`MAX(${aiMessage.seq})` })
      .from(aiMessage)
      .where(eq(aiMessage.conversationId, conversationId))
      .limit(1);
    const nextSeq = (maxRow?.max ?? 0) + 1;

    // 插入消息
    const result = await this.conn.db
      .insert(aiMessage)
      .values({
        conversationId,
        seq: nextSeq,
        role: input.role,
        content: input.content,
        inputType: input.inputType,
        recordingId: input.recordingId,
        asrText: input.asrText,
        translationZh: input.translationZh,
        correctionJson: input.correctionJson,
        provider: input.provider,
        tokens: input.tokens,
        latencyMs: input.latencyMs,
        filtered: input.filtered,
      } as any)
      .returning();

    const row = result[0];

    // 更新会话计数器
    if (input.role === 'user') {
      await this.conn.db
        .update(aiConversation)
        .set({ turnCount: sql`${aiConversation.turnCount} + 1` })
        .where(
          profileWhere(
            scope,
            aiConversation.userId,
            eq(aiConversation.id, conversationId),
          ),
        );
    }
    if (input.role === 'assistant' && input.tokens) {
      await this.conn.db
        .update(aiConversation)
        .set({ totalTokens: sql`${aiConversation.totalTokens} + ${input.tokens}` })
        .where(
          profileWhere(
            scope,
            aiConversation.userId,
            eq(aiConversation.id, conversationId),
          ),
        );
    }

    return this.toMessageView(row);
  }

  /** 单条消息详情 */
  async getMessage(
    scope: ProfileScope,
    conversationId: number,
    messageId: number,
  ): Promise<MessageView> {
    // 验证对话归属
    await this.assertConversationOwned(scope, conversationId);

    const rows = await this.conn.db
      .select()
      .from(aiMessage)
      .where(
        and(
          eq(aiMessage.conversationId, conversationId),
          eq(aiMessage.id, messageId),
        ),
      )
      .limit(1);

    const row = rows[0];
    if (row === undefined) {
      throw notFoundError(ErrorCode.RESOURCE_NOT_FOUND, '消息不存在');
    }

    return this.toMessageView(row);
  }
}
