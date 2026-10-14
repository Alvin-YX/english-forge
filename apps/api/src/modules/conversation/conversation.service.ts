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

import { ErrorCode, type ErrorCodeValue } from '@eng-forge/contracts/api';
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

import { BusinessError, internalInvariantError, notFoundError } from '../../common/errors.business.js';
import { type AuditMeta } from '../../infra/audit/audit-meta.decorator.js';
import { AuditService } from '../../infra/audit/audit.service.js';
import { DbConnection } from '../../infra/db/db.module.js';
import { and, asc, count, desc, eq, type SQL, sql } from '../../infra/db/query.js';
import { profileWhere, type ProfileScope } from '../../infra/profile/profile-scope.js';

import { buildChatMessages, LlmService } from './llm.service.js';

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

/**
 * 🔴 这些枚举在 `packages/db` 里声明为 `as const` 数组（而非 TS `enum`），
 *    因此必须用 `z.enum()`；`z.nativeEnum()` 只接受「对象形态」的枚举，
 *    对 readonly 数组会直接报 TS2345。
 */
export const CREATE_CONVERSATION_SCHEMA = z.object({
  mode: z.enum(CONVERSATION_MODES),
  persona: z.string().max(32).optional().default('tutor'),
  scenarioId: z.string().max(64).optional(),
  level: z.string().max(16),
});

export const LIST_CONVERSATIONS_QUERY_SCHEMA = z.object({
  page: POSITIVE_INT.optional().default(1),
  pageSize: z.coerce.number().int().positive().max(100).optional().default(20),
  mode: z.enum(CONVERSATION_MODES).optional(),
  status: z.enum(CONVERSATION_STATUSES).optional(),
  sortBy: z.enum(['startedAt', 'turnCount']).optional().default('startedAt'),
  sortDir: z.enum(['asc', 'desc']).optional().default('desc'),
});

export const SEND_MESSAGE_SCHEMA = z.object({
  role: z.enum(MESSAGE_ROLES),
  content: z.string().max(2000),
  inputType: z.enum(MESSAGE_INPUT_TYPES).optional().default('text'),
  recordingId: POSITIVE_INT.optional(),
  asrText: z.string().max(2000).optional(),
  translationZh: z.string().max(2000).optional(),
  correctionJson: z.unknown().optional(),
  provider: z.enum(AI_PROVIDERS).optional(),
  tokens: z.number().int().min(0).optional(),
  latencyMs: z.number().int().min(0).optional(),
  filtered: z.boolean().optional().default(false),
});

export const LIST_MESSAGES_QUERY_SCHEMA = z.object({
  page: POSITIVE_INT.optional().default(1),
  pageSize: z.coerce.number().int().positive().max(100).optional().default(50),
});

/**
 * 🔴 新增端点而不是复用 `SEND_MESSAGE_SCHEMA`：那条 schema 让客户端自己声明
 *    `role`/`tokens`/`latencyMs`，是「聊天记录本」的语义。`chat()` 的语义是
 *    「我说一句话，AI 回我一句」，客户端不该（也不能）声明 assistant 的内容。
 */
export const CHAT_SCHEMA = z.object({
  content: z.string().trim().min(1).max(2000),
});

export interface ChatView {
  /** 用户消息（已落库，即使 AI 调用失败也不丢） */
  userMessage: MessageView;
  /** AI 回复；失败时为 `null`，同时 `degraded: true` */
  assistantMessage: MessageView | null;
  /** AI 调用是否降级（未配置 / 超时 / 不可达 / 额度不足） */
  degraded: boolean;
  /** 降级原因（用户可读，前端可直接展示） */
  reason?: string;
  /** 降级对应的业务错误码，前端据此精确分支 */
  code?: ErrorCodeValue;
}

export type CreateConversationInput = z.infer<typeof CREATE_CONVERSATION_SCHEMA>;
export type ListConversationsQuery = z.infer<typeof LIST_CONVERSATIONS_QUERY_SCHEMA>;
export type SendMessageInput = z.infer<typeof SEND_MESSAGE_SCHEMA>;
export type ListMessagesQuery = z.infer<typeof LIST_MESSAGES_QUERY_SCHEMA>;
export type ChatInput = z.infer<typeof CHAT_SCHEMA>;

// ═══════════════════════════════════════════════════════════
// 常量
// ═══════════════════════════════════════════════════════════

const PAGE_SIZE_MAX = 100;

/** `system` 角色不进入 LLM 上下文（本表的 system 消息是本地规则产生的，不是模型提示） */
function isChatRole(row: AiMessageRow): row is AiMessageRow & { role: 'user' | 'assistant' } {
  return row.role === 'user' || row.role === 'assistant';
}

// ═══════════════════════════════════════════════════════════
// Service
// ═══════════════════════════════════════════════════════════

@Injectable()
export class ConversationService {
  constructor(
    @Inject(DbConnection) private readonly conn: DbConnection,
    @Inject(LlmService) private readonly llm: LlmService,
    @Inject(AuditService) private readonly audit: AuditService,
  ) {}

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

  /** 读取当前档案的对话行（`chat()` 需要 `persona` / `level` 组系统提示） */
  private async getOwnedConversation(scope: ProfileScope, conversationId: number): Promise<AiConversationRow> {
    const rows = await this.conn.db
      .select()
      .from(aiConversation)
      .where(profileWhere(scope, aiConversation.userId, eq(aiConversation.id, conversationId)))
      .limit(1);

    const row = rows[0];
    if (row === undefined) {
      throw notFoundError(ErrorCode.CONVERSATION_NOT_FOUND, '对话不存在');
    }
    return row;
  }

  /** 插入一条对话消息并返回视图（`chat()` 的两条消息共用） */
  private async insertMessage(
    conversationId: number,
    values: {
      seq: number;
      role: (typeof MESSAGE_ROLES)[number];
      content: string;
      inputType?: (typeof MESSAGE_INPUT_TYPES)[number];
      provider?: (typeof AI_PROVIDERS)[number];
      tokens?: number;
      latencyMs?: number;
    },
  ): Promise<MessageView> {
    const result = await this.conn.db
      .insert(aiMessage)
      .values({
        conversationId,
        seq: values.seq,
        role: values.role,
        content: values.content,
        inputType: values.inputType ?? 'text',
        provider: values.provider,
        tokens: values.tokens,
        latencyMs: values.latencyMs,
        filtered: false,
      })
      .returning();

    const row = result[0];
    // 🔴 与 sendMessage 同样处理：INSERT ... RETURNING 必然回一行，空数组属不变量破坏
    if (row === undefined) {
      throw internalInvariantError('消息写入后未返回任何行');
    }
    return this.toMessageView(row);
  }

  /** 取最近若干条消息作为上下文（seq 升序返回） */
  private async loadHistory(conversationId: number, limit = 13): Promise<AiMessageRow[]> {
    const rows = await this.conn.db
      .select()
      .from(aiMessage)
      .where(eq(aiMessage.conversationId, conversationId))
      .orderBy(desc(aiMessage.seq))
      .limit(limit);
    return rows.reverse();
  }

  /**
   * 一次真实的 AI 往返：用户消息 + AI 回复。
   *
   * 🔴 **永不因为 AI 失败而抛错**（除对话不存在/无归属）：AI 不可用时
   *    用户消息必须照常落库，返回 `degraded: true` 与明确 reason。
   *    否则学生会以为「消息没发出去」而重复发送，且看不到「请去管理后台配置 AI」的提示。
   *
   * 🔴 每次出网调用写 `audit_log.egress_call`（04 文档 §9.2），成败都记。
   */
  async chat(
    scope: ProfileScope,
    conversationId: number,
    input: ChatInput,
    meta: AuditMeta,
  ): Promise<ChatView> {
    const conversation = await this.getOwnedConversation(scope, conversationId);

    // 1) 用户消息先落库 —— AI 调用失败也不能丢输入
    const [maxRow] = await this.conn.db
      .select({ max: sql<number>`COALESCE(MAX(${aiMessage.seq}), 0)` })
      .from(aiMessage)
      .where(eq(aiMessage.conversationId, conversationId))
      .limit(1);
    const userSeq = (maxRow?.max ?? 0) + 1;

    const userMessage = await this.insertMessage(conversationId, {
      seq: userSeq,
      role: 'user',
      content: input.content,
    });

    // 2) 回合计数（与 sendMessage 的语义一致：每条 user 消息 +1）
    await this.conn.db
      .update(aiConversation)
      .set({ turnCount: sql`${aiConversation.turnCount} + 1` })
      .where(eq(aiConversation.id, conversationId));

    // 3) 组上下文并调用 LLM（只送 user/assistant 两条角色，system 由 llm.service 拼）
    const history = (await this.loadHistory(conversationId)).filter(isChatRole);
    const messages = buildChatMessages(
      { persona: conversation.persona, level: conversation.level },
      history.map((message) => ({ role: message.role, content: message.content })),
    );

    try {
      const result = await this.llm.chat(messages);

      const assistantMessage = await this.insertMessage(conversationId, {
        seq: userSeq + 1,
        role: 'assistant',
        content: result.content,
        provider: 'cloud',
        tokens: result.totalTokens,
        latencyMs: result.latencyMs,
      });

      await this.conn.db
        .update(aiConversation)
        .set({
          providerUsed: 'cloud',
          fallbackUsed: false,
          totalTokens: sql`${aiConversation.totalTokens} + ${result.totalTokens}`,
        })
        .where(eq(aiConversation.id, conversationId));

      await this.audit.record({
        action: 'egress_call',
        targetType: 'ai_conversation',
        targetId: String(conversationId),
        actorId: meta.actorId,
        ip: meta.ip,
        ua: meta.ua,
        detail: {
          provider: 'cloud',
          model: result.model,
          ok: true,
          tokens: result.totalTokens,
          latencyMs: result.latencyMs,
        },
      });

      return { userMessage, assistantMessage, degraded: false };
    } catch (err) {
      const business =
        err instanceof BusinessError
          ? err
          : new BusinessError(ErrorCode.LLM_UNAVAILABLE, 'AI 服务暂时不可用，请稍后重试', 503);

      // 标记降级：provider_used='rule' + fallback_used=true，
      // 报告/统计能据此知道「这段对话没有真正用到云 API」
      await this.conn.db
        .update(aiConversation)
        .set({ providerUsed: 'rule', fallbackUsed: true })
        .where(eq(aiConversation.id, conversationId));

      await this.audit.record({
        action: 'egress_call',
        targetType: 'ai_conversation',
        targetId: String(conversationId),
        actorId: meta.actorId,
        ip: meta.ip,
        ua: meta.ua,
        detail: { provider: 'cloud', ok: false, code: business.code, latencyMs: null },
      });

      return { userMessage, assistantMessage: null, degraded: true, reason: business.message, code: business.code };
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
    // 🔴 同learning.service：`INSERT ... RETURNING` 必然回一行，空数组属不变量破坏
    if (row === undefined) {
      throw internalInvariantError('对话创建后未返回任何行');
    }
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
    const orderBy: SQL[] = [
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
      .orderBy(...orderBy)
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
      })
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
    // 🔴 sql`` 的返回类型是 unknown，必须用泛型参数声明真实类型（这里是 integer），
    //    否则下游的算术运算会退化成 {} + number。
    //    MAX() 在无行时返回 null，用 COALESCE 兜成 0 避免 null 参与算术。
    const [maxRow] = await this.conn.db
      .select({ max: sql<number>`COALESCE(MAX(${aiMessage.seq}), 0)` })
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
      })
      .returning();

    const row = result[0];
    if (row === undefined) {
      throw internalInvariantError('消息写入后未返回任何行');
    }

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
