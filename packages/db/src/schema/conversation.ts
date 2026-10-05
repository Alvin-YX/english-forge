/**
 * AI 对话域 —— 03 文档 §4.2.11
 *
 * 覆盖表：`ai_conversation` / `ai_message`
 *
 * 🔴 合规（04 文档 §9.2）：邢工确认使用云 API，**对话内容会发送至第三方 AI 服务**。
 *    对应设计：`provider_used` 记录实际生效者（ollama|cloud|rule），
 *    `fallback_used` 标记降级，`ai_message.filtered` 记录安全过滤命中，
 *    `ai_conversation.user_id` 使对话可按用户删除（导出/遗忘权）。
 */

import {
  bigint,
  boolean,
  index,
  integer,
  json,
  pgTable,
  smallint,
  text,
  timestamp,
  uniqueIndex,
  varchar,
} from 'drizzle-orm/pg-core';

import { recording } from './speech.js';
import { user } from './user.js';

// ═══════════════════════════════════════════════════════════
// ai_conversation
// ═══════════════════════════════════════════════════════════

/** 对话模式（§4.2.11 CHECK） */
export const CONVERSATION_MODES = ['chat', 'interview', 'story', 'debate', 'qa'] as const;
export type ConversationMode = (typeof CONVERSATION_MODES)[number];

/** AI 实际生效者（云 API / 本地 / 规则兜底） */
export const AI_PROVIDERS = ['ollama', 'cloud', 'rule'] as const;
export type AiProvider = (typeof AI_PROVIDERS)[number];

/** 会话状态 */
export const CONVERSATION_STATUSES = ['active', 'finished', 'error'] as const;
export type ConversationStatus = (typeof CONVERSATION_STATUSES)[number];

/** AI 对话会话 */
export const aiConversation = pgTable(
  'ai_conversation',
  {
    id: bigint('id', { mode: 'number' })
      .primaryKey()
      .generatedAlwaysAsIdentity(),
    userId: bigint('user_id', { mode: 'number' })
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    mode: varchar('mode', { length: 16 }).$type<ConversationMode>().notNull(),
    /** 可换 AI 人格（AIEnglishTutor 借鉴；7 Persona 见 04 文档 §5.7） */
    persona: varchar('persona', { length: 32 }).notNull().default('tutor'),
    /** 场景库 id（生活化场景） */
    scenarioId: varchar('scenario_id', { length: 64 }),
    /** 由学段推导 */
    level: varchar('level', { length: 16 }).notNull(),
    /** 实际生效者 */
    providerUsed: varchar('provider_used', { length: 16 }).$type<AiProvider>(),
    /** 是否发生降级 */
    fallbackUsed: boolean('fallback_used').notNull().default(false),
    turnCount: smallint('turn_count').notNull().default(0),
    totalTokens: integer('total_tokens').notNull().default(0),
    /** 会话摘要（EngAgent 借鉴） */
    summaryMd: text('summary_md'),
    /** 个性化改进建议 */
    suggestionMd: text('suggestion_md'),
    status: varchar('status', { length: 16 })
      .$type<ConversationStatus>()
      .notNull()
      .default('active'),
    startedAt: timestamp('started_at', { withTimezone: true }).notNull().defaultNow(),
    endedAt: timestamp('ended_at', { withTimezone: true }),
  },
  (t) => [
    // §4.2.11：idx_conv_user_time
    index('idx_conv_user_time').on(t.userId, t.startedAt),
    // §5.4 `GET /conversations?mode=` 的筛选索引
    index('idx_conv_user_mode').on(t.userId, t.mode, t.startedAt),
  ],
);

// ═══════════════════════════════════════════════════════════
// ai_message
// ═══════════════════════════════════════════════════════════

/** 消息角色 */
export const MESSAGE_ROLES = ['user', 'assistant', 'system'] as const;
export type MessageRole = (typeof MESSAGE_ROLES)[number];

/** 输入类型 */
export const MESSAGE_INPUT_TYPES = ['text', 'voice'] as const;
export type MessageInputType = (typeof MESSAGE_INPUT_TYPES)[number];

/** 对话消息（SSE 断线续传靠 `seq` 排序） */
export const aiMessage = pgTable(
  'ai_message',
  {
    id: bigint('id', { mode: 'number' })
      .primaryKey()
      .generatedAlwaysAsIdentity(),
    conversationId: bigint('conversation_id', { mode: 'number' })
      .notNull()
      .references(() => aiConversation.id, { onDelete: 'cascade' }),
    seq: integer('seq').notNull(),
    role: varchar('role', { length: 16 }).$type<MessageRole>().notNull(),
    content: text('content').notNull(),
    inputType: varchar('input_type', { length: 16 })
      .$type<MessageInputType>()
      .notNull()
      .default('text'),
    /** 语音输入 */
    recordingId: bigint('recording_id', { mode: 'number' }).references(() => recording.id, {
      onDelete: 'set null',
    }),
    /** 语音转写（保留原文便于复盘） */
    asrText: text('asr_text'),
    translationZh: text('translation_zh'),
    /** 三段式 {correction, why, continue} */
    correctionJson: json('correction_json'),
    /** 回复音频（缓存） */
    ttsAudioPath: varchar('tts_audio_path', { length: 255 }),
    provider: varchar('provider', { length: 16 }).$type<AiProvider>(),
    tokens: integer('tokens'),
    latencyMs: integer('latency_ms'),
    /** 安全过滤命中（04 文档 §9.2 内容安全） */
    filtered: boolean('filtered').notNull().default(false),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    // §4.2.11：UNIQUE (conversation_id, seq) —— seq 是 SSE 续传游标，必须唯一
    uniqueIndex('uq_ai_message_conv_seq').on(t.conversationId, t.seq),
    index('idx_msg_conv_seq').on(t.conversationId, t.seq),
  ],
);

export type AiConversationRow = typeof aiConversation.$inferSelect;
export type AiMessageRow = typeof aiMessage.$inferSelect;
