/**
 * 对话域的 LLM 出网入口 —— 业务层唯一调用点。
 *
 * 职责边界：
 *   - 配置读取与密钥解密 → `infra/ai/llm-config.store.ts`（`app_config` + `app_secret`）
 *   - HTTP 传输与协议 → `infra/ai/ai-client.ts`（OpenAI 兼容协议）
 *   - 本文件只做「取配置 → 发请求 → 把传输层异常翻译成业务错误码」
 *
 * 🔴 抛出的 `BusinessError` 已归一为四个既有错误码，调用方只需按 code 分支：
 *    4005 LLM_NOT_CONFIGURED / 4003 LLM_TIMEOUT / 4004 LLM_QUOTA_EXCEEDED / 4002 LLM_UNAVAILABLE
 *
 * 🔴 出网审计（§9.2 `egress_call`）由调用方（`ConversationService.chat()`）负责，
 *    因为它才知道「这次调用的业务上下文」是哪条对话 —— 见 `app-secret.store.ts` 的
 *    「本文件自身不写审计」约定，infra 层不依赖审计模块。
 */

import { ErrorCode } from '@eng-forge/contracts/api';
import { Inject, Injectable } from '@nestjs/common';

import { BusinessError } from '../../common/errors.business.js';
import {
  type AiChatMessage,
  type AiChatResult,
  chatCompletion,
  toBusinessError,
} from '../../infra/ai/ai-client.js';
import { LlmConfigStore } from '../../infra/ai/llm-config.store.js';

/** 单条消息的长度上限（与 `SEND_MESSAGE_SCHEMA` 的 2000 字对齐） */
const MAX_MESSAGE_CHARS = 2000;
/** 一次对话送入的历史轮数（控制 token 消耗与上下文窗口） */
const MAX_HISTORY_MESSAGES = 12;

export interface LlmSystemPrompt {
  /** 人设/场景，来自 `ai_conversation.persona` 与 `level` */
  persona: string;
  /** 学生英语水平（`ai_conversation.level`） */
  level: string;
}

/** 拼出带系统提示的对话消息序列 */
export function buildChatMessages(system: LlmSystemPrompt, history: AiChatMessage[]): AiChatMessage[] {
  const recent = history.slice(-MAX_HISTORY_MESSAGES).map((message) => ({
    role: message.role,
    content: message.content.slice(0, MAX_MESSAGE_CHARS),
  }));
  const persona = system.persona.trim();
  const level = system.level.trim();
  return [
    {
      role: 'system',
      content: [
        '你是一位耐心的英语老师，正在和学生一对一练习英语口语。',
        '始终用**简单、地道、符合学生水平**的英文回答，每次不超过 3 句。',
        persona ? `你的人设是：${persona}` : '',
        level ? `学生英语水平：${level}` : '',
        '若学生的表达有明显语法或发音问题，用一句话温和指出并给出正确说法。',
      ]
        .filter((line) => line.length > 0)
        .join('\n'),
    },
    ...recent,
  ];
}

@Injectable()
export class LlmService {
  constructor(@Inject(LlmConfigStore) private readonly config: LlmConfigStore) {}

  /** 是否已配置为可用（缺 base_url / model / Key 任一即为 false） */
  async isConfigured(): Promise<boolean> {
    return (await this.config.loadActive()) !== null;
  }

  /**
   * 调用一次大模型。
   * 🔴 永不返回 `null` 表示失败 —— 失败一律抛 `BusinessError`，
   *    调用方必须显式 catch，避免「降级」变成静默的空回复。
   */
  async chat(messages: AiChatMessage[]): Promise<AiChatResult> {
    const active = await this.config.loadActive();
    if (active === null) {
      throw new BusinessError(
        ErrorCode.LLM_NOT_CONFIGURED,
        '未配置大模型：请在管理后台「AI 设置」填写 base_url、模型与 API Key',
        503,
      );
    }

    try {
      return await chatCompletion({
        baseUrl: active.baseUrl,
        model: active.model,
        apiKey: active.apiKey,
        messages,
        timeoutMs: active.timeoutMs,
      });
    } catch (err) {
      throw toBusinessError(err, `（provider=${active.provider}）`);
    }
  }
}
