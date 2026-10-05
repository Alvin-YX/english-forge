/**
 * AI 服务内部 API 契约 —— 03 文档 §5.9
 *
 * 🔶 架构变更（04 文档 Q4 已确认）：**不接入本地 Ollama**，
 * 改为 API Key 接入商用大模型。ai 容器是**纯适配层**，
 * 通过 `ef_edge` 网络访问云端（ef_core 保持零外网）。
 *
 * 三级降级链：云 API → 规则兜底（03 文档 §3.1 llm-adapter）
 */

import type { SpeechLevel } from '../enums/index.js';

// ═══════════════════════════════════════════════════════════
// 状态
// ═══════════════════════════════════════════════════════════

export interface AiStatus {
  /**
   * 当前档位。
   * 🔶 04 文档 Q4 后只有两级：cloud（云 API）与 rule（规则兜底）
   */
  tier: 'cloud' | 'rule';
  /** 是否已配置 API Key（未配置则强制 rule 档） */
  configured: boolean;
  /** 已配置的 provider 列表 */
  providers: Array<'openai' | 'deepseek' | 'qwen' | 'custom'>;
  /** 当前使用的 provider */
  activeProvider?: string;
  /** 🔴 熔断状态 */
  circuitState: 'closed' | 'open' | 'half_open';
  /** 🔴 配额（防止 runaway 费用） */
  quota: { used: number; limit: number; resetAt: string };
  version: string;
}

// ═══════════════════════════════════════════════════════════
// 通用 LLM 调用
// ═══════════════════════════════════════════════════════════

export interface LlmRequest {
  /** 提示词 */
  prompt: string;
  /** 系统提示 */
  system?: string;
  /** 最大 token */
  maxTokens?: number;
  temperature?: number;
  /** 🔴 期望 JSON 输出（用 JSON Schema 约束，03 文档 §8.5 集成测试⑤） */
  jsonSchema?: Record<string, unknown>;
  /** 请求超时（毫秒） */
  timeoutMs?: number;
}

export interface LlmResponse {
  content: string;
  /** 实际使用的档位（可能已降级） */
  tier: 'cloud' | 'rule';
  /** 命中的降级路径（用于可观测性） */
  degradedFrom?: 'cloud';
  usage: { promptTokens: number; completionTokens: number };
  elapsedMs: number;
}

// ═══════════════════════════════════════════════════════════
// 对话（v1.1，MVP 不做，契约先定）
// ═══════════════════════════════════════════════════════════

/** 对话 5 模式（03 文档 §3.1 conversation） */
export const ConversationMode = {
  CHAT: 'chat',       // 日常聊天
  INTERVIEW: 'interview', // 面试模拟
  STORY: 'story',     // 故事接龙
  DEBATE: 'debate',   // 辩论
  QA: 'qa',           // 自由问答
} as const;
export type ConversationMode = (typeof ConversationMode)[keyof typeof ConversationMode];

/** AI Persona（04 文档 §5.7：七种人格，v1.1） */
export const AiPersona = {
  ENCOURAGING: 'encouraging',   // 鼓励型（小学 1-2）
  CORRECTIVE: 'corrective',     // 纠错型（小学 3-6）
  EXAMINER: 'examiner',         // 考官型（高中/大学）
  ACADEMIC: 'academic',         // 学术型（大学）
  INTERVIEWER: 'interviewer',   // 面试官（成人/大学）
  LIFE_PARTNER: 'life_partner', // 生活伙伴（成人）
  COLLEAGUE: 'colleague',       // 同事（成人）
} as const;
export type AiPersona = (typeof AiPersona)[keyof typeof AiPersona];

export interface ConversationRequest {
  mode: ConversationMode;
  stage: SpeechLevel;
  persona: AiPersona;
  /** 历史消息 */
  history: Array<{ role: 'user' | 'assistant'; content: string }>;
  /** 语音输入的 ASR 结果 */
  transcript?: string;
}

export interface ConversationResponse {
  reply: string;
  tier: 'cloud' | 'rule';
  /** 纠错建议 */
  corrections: Array<{
    original: string;
    corrected: string;
    reason: string;
  }>;
  elapsedMs: number;
}

// ═══════════════════════════════════════════════════════════
// 出题（lesson 模块动态生成）
// ═══════════════════════════════════════════════════════════

export interface GenerateExerciseRequest {
  /** 词表子集（30 词左右） */
  wordIds: string[];
  /** 学段（影响难度与题型） */
  stage: string;
  /** 生成数量 */
  count: number;
}

export interface GenerateExerciseResponse {
  exercises: Array<{
    type: 'word_card' | 'spell' | 'dictation';
    wordId: string;
    prompt: string;
    answer: string;
    hint?: string;
  }>;
  tier: 'cloud' | 'rule';
  elapsedMs: number;
}
