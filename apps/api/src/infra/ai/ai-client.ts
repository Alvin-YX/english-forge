/**
 * OpenAI 兼容协议的 LLM 客户端（出网）—— 03 文档 §9.2 出网审计
 *
 * 为什么不接 `apps/ai`（Python 服务）：`app_secret` 与 `reveal()` 都在 NestJS 侧，
 *  直接由本进程发请求才能保证**单一密钥持有方**，多一跳网关就要把密钥再交出去一次。
 *  Python 服务的 `OpenAIAdapter`/`CloudAPIAdapter`/降级链保持原样，留作后续增强。
 *
 * 为什么用 `globalThis.fetch` 而不是 axios/got/undici：仓库里没有 HTTP 客户端依赖，
 *  且 ADR-0004 有「后端运行依赖 ≤ 12」的硬约束。Node 22 的 fetch 已稳定可用。
 *
 * 🔴 错误归一化契约（调用方只能得到三种结局）：
 *    - `AiTimeoutError`    → `LLM_TIMEOUT`(4003)
 *    - `AiQuotaExceededError` → `LLM_QUOTA_EXCEEDED`(4004)
 *    - 其它 `AiClientError` → `LLM_UNAVAILABLE`(4002)
 *  客户端内部**不返回错误字符串里的服务端报文**之外的任何内容 —— 响应体可能被
 *  截断成几百 KB，而 `BusinessError.details` 会随备份/日志留存。
 */

import { ErrorCode } from '@eng-forge/contracts/api';

import { BusinessError } from '../../common/errors.business.js';

export type AiChatRole = 'system' | 'user' | 'assistant';

export interface AiChatMessage {
  role: AiChatRole;
  content: string;
}

export interface AiChatOptions {
  /** 不含尾斜杠也可；`/chat/completions` 由本模块追加 */
  baseUrl: string;
  model: string;
  apiKey: string;
  messages: AiChatMessage[];
  timeoutMs?: number;
  maxTokens?: number;
  temperature?: number;
}

export interface AiChatResult {
  /** 回复正文（已去掉首尾空白） */
  content: string;
  /** 实际生效的模型名（服务端可能做了 alias 重定向，以响应为准） */
  model: string;
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  /** 从发出请求到拿回结果的全部耗时（含 DNS/TLS） */
  latencyMs: number;
}

/** 请求本身失败（网络不可达 / DNS / TLS / HTTP 非 2xx / 响应形状不对） */
export class AiClientError extends Error {
  readonly status?: number;

  constructor(message: string, status?: number) {
    super(message);
    this.name = 'AiClientError';
    this.status = status;
  }
}

/** 超时（客户端主动中断） */
export class AiTimeoutError extends AiClientError {
  constructor(timeoutMs: number) {
    super(`请求超时（${timeoutMs}ms）`);
    this.name = 'AiTimeoutError';
  }
}

/** 额度或限流（429 / rate limit 语义） */
export class AiQuotaExceededError extends AiClientError {
  constructor(message: string) {
    super(message, 429);
    this.name = 'AiQuotaExceededError';
  }
}

/** 把客户端异常映射成业务异常（唯一一处，避免各调用点各自映射） */
export function toBusinessError(err: unknown, hint = ''): BusinessError {
  if (err instanceof AiTimeoutError) {
    return new BusinessError(ErrorCode.LLM_TIMEOUT, `大模型响应超时${hint}`, 504);
  }
  if (err instanceof AiQuotaExceededError) {
    return new BusinessError(ErrorCode.LLM_QUOTA_EXCEEDED, `大模型额度不足或触发限流${hint}`, 429);
  }
  const detail = err instanceof AiClientError ? err.message : err instanceof Error ? err.message : String(err);
  return new BusinessError(ErrorCode.LLM_UNAVAILABLE, `无法调用大模型：${detail}`, 502);
}

/** 规整 base_url：去掉尾斜杠与已带的 `/chat/completions`，统一拼出完整地址 */
export function buildCompletionsUrl(baseUrl: string): string {
  const base = baseUrl.trim().replace(/\/chat\/completions$/, '').replace(/\/+$/, '');
  return `${base}/chat/completions`;
}

/** 默认超时：单次对话，超过即视为不可用（§9.2 要求出网必须有硬超时） */
export const DEFAULT_TIMEOUT_MS = 12_000;
const MAX_TIMEOUT_MS = 120_000;
const DETAIL_MAX = 300;

interface OpenAiResponse {
  id?: string;
  model?: string;
  choices?: Array<{ message?: { content?: string | null }; finish_reason?: string | null }>;
  usage?: {
    prompt_tokens?: number | string;
    completion_tokens?: number | string;
    total_tokens?: number | string;
  };
  error?: { message?: string; type?: string };
}

function asTokenCount(value: number | string | undefined): number {
  const n = typeof value === 'string' ? Number(value) : value;
  return typeof n === 'number' && Number.isFinite(n) && n >= 0 ? Math.round(n) : 0;
}

/** 截断用于日志/错误信息的片段（响应体可能非常大，且会随审计留存） */
function clip(text: string, max = DETAIL_MAX): string {
  const trimmed = text.trim();
  return trimmed.length > max ? `${trimmed.slice(0, max)}…` : trimmed;
}

export async function chatCompletion(options: AiChatOptions): Promise<AiChatResult> {
  const timeoutMs = Math.min(Math.max(options.timeoutMs ?? DEFAULT_TIMEOUT_MS, 1000), MAX_TIMEOUT_MS);
  const startedAt = Date.now();

  let res: Response;
  try {
    res = await fetch(buildCompletionsUrl(options.baseUrl), {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${options.apiKey}`,
        accept: 'application/json',
      },
      body: JSON.stringify({
        model: options.model,
        messages: options.messages,
        stream: false,
        temperature: options.temperature ?? 0.4,
        max_tokens: options.maxTokens ?? 512,
      }),
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch (err) {
    if (err instanceof Error && (err.name === 'TimeoutError' || err.name === 'AbortError')) {
      throw new AiTimeoutError(timeoutMs);
    }
    // DNS / 连接拒绝 / TLS 失败 / 代理超时 —— 全部归为「服务不可达」
    throw new AiClientError(err instanceof Error ? err.message : String(err));
  }

  const text = await res.text();
  let payload: OpenAiResponse;
  try {
    payload = JSON.parse(text) as OpenAiResponse;
  } catch {
    throw new AiClientError(`服务端返回非 JSON 响应（HTTP ${res.status}）`, res.status);
  }

  if (!res.ok) {
    const reason = clip(payload.error?.message ?? text);
    if (res.status === 429 || /rate[ _-]?limit|quota/i.test(reason)) {
      throw new AiQuotaExceededError(reason);
    }
    if (res.status === 401 || res.status === 403) {
      throw new AiClientError(`认证失败（HTTP ${res.status}），请检查 API Key`, res.status);
    }
    throw new AiClientError(`服务端拒绝请求（HTTP ${res.status}）：${reason}`, res.status);
  }

  const content = payload.choices?.[0]?.message?.content;
  if (typeof content !== 'string' || content.trim() === '') {
    throw new AiClientError('服务端响应中没有可用回复内容');
  }

  const promptTokens = asTokenCount(payload.usage?.prompt_tokens);
  const completionTokens = asTokenCount(payload.usage?.completion_tokens);
  let totalTokens = asTokenCount(payload.usage?.total_tokens);
  // 部分厂商不返回 total，但分项齐全 —— 自行相加，避免 total_tokens 恒为 0
  if (totalTokens === 0 && (promptTokens > 0 || completionTokens > 0)) {
    totalTokens = promptTokens + completionTokens;
  }

  return {
    content: content.trim(),
    model: typeof payload.model === 'string' && payload.model.length > 0 ? payload.model : options.model,
    promptTokens,
    completionTokens,
    totalTokens,
    latencyMs: Date.now() - startedAt,
  };
}
