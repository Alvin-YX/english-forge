/**
 * LLM 配置的读写门面 —— 03 文档 §9.3「敏感与非敏感配置严格分离」
 *
 * 存放分工（**红线**）：
 *   - `app_config`：`llm.provider` / `llm.model` / `llm.base_url` / `llm.timeout_ms`
 *     → **非敏感**，明文可读
 *   - `app_secret`：`cloud.llm.api_key` → **只存密文**，全仓唯一读写点在
 *     `app-secret.store.ts`，本文件只调用它的 `reveal()`/`set()`
 * 把 Key 写进 `app_config` 会让密钥随数据库备份与导出一起外泄，所以两处永不混用。
 *
 * 🔴 「只写不读」：`getView()` 永远不返回明文 Key，只给 `hasKey` 与 `keyHint`
 *    （末 4 位）。明文只在 `loadActive()` 里短暂出现一次，用于本次请求的出网调用，
 *    不出这个方法的调用栈。
 *
 * 放在 `infra/ai/` 而非 `modules/system/`：依赖边界规则禁止业务层（conversation
 * 等）依赖 system 这种基础层模块，而 system 控制器本身也要读这些配置。
 */

import {
  CONFIG_KEY_LLM_BASE_URL,
  CONFIG_KEY_LLM_MODEL,
  CONFIG_KEY_LLM_PROVIDER,
  CONFIG_KEY_LLM_TIMEOUT_MS,
  LLM_PROVIDERS,
  SECRET_KEY_LLM_API,
  type LlmProvider,
} from '@eng-forge/db/schema';
import { Inject, Injectable, Logger } from '@nestjs/common';
import { z } from 'zod';


import { AppConfigStore } from '../config/app-config.store.js';
import { AppSecretStore } from '../config/app-secret.store.js';

import { AiClientError, AiQuotaExceededError, AiTimeoutError, chatCompletion } from './ai-client.js';

const CONFIG_GROUP = 'llm';

/** 前端预设下拉的默认值。provider 只是选择器，真正生效的是 `base_url` */
export const LLM_PROVIDER_PRESETS: Record<LlmProvider, { baseUrl: string; model: string; label: string }> = {
  openai: { baseUrl: 'https://api.openai.com/v1', model: 'gpt-4o-mini', label: 'OpenAI' },
  deepseek: { baseUrl: 'https://api.deepseek.com/v1', model: 'deepseek-chat', label: 'DeepSeek' },
  qwen: { baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1', model: 'qwen-plus', label: '通义千问' },
  custom: { baseUrl: '', model: '', label: '自定义（OpenAI 兼容）' },
};

/** 单次对话超时（毫秒）的边界；超过上限按上限截断 */
export const LLM_TIMEOUT_MIN_MS = 1000;
export const LLM_TIMEOUT_MAX_MS = 60_000;
export const LLM_TIMEOUT_DEFAULT_MS = 12_000;

const PROVIDER_VALUES = LLM_PROVIDERS.slice() as [LlmProvider, ...LlmProvider[]];

export const LLM_SAVE_SCHEMA = z.object({
  provider: z.enum(PROVIDER_VALUES),
  model: z.string().trim().min(1).max(64),
  baseUrl: z.string().trim().url().max(255),
  /** 留空表示「沿用已保存的 Key」—— 只改模型不必重填一遍密钥 */
  apiKey: z.string().trim().min(1).max(255).optional(),
  /** 缺省用 `LLM_TIMEOUT_DEFAULT_MS`；越界由 store 截断而不是报错 */
  timeoutMs: z.number().int().min(LLM_TIMEOUT_MIN_MS).max(LLM_TIMEOUT_MAX_MS).optional(),
});

export type LlmConfigSaveInput = z.infer<typeof LLM_SAVE_SCHEMA>;

/** 连通性测试的入参：全部可选，缺项回落已保存的配置 */
export const LLM_TEST_SCHEMA = z.object({
  provider: z.enum(PROVIDER_VALUES).optional(),
  model: z.string().trim().min(1).max(64).optional(),
  baseUrl: z.string().trim().url().max(255).optional(),
  /** 留空 = 用已保存的 Key（此时必须已保存过） */
  apiKey: z.string().trim().min(1).max(255).optional(),
  timeoutMs: z.number().int().min(LLM_TIMEOUT_MIN_MS).max(LLM_TIMEOUT_MAX_MS).optional(),
});

export type LlmConfigTestInput = z.infer<typeof LLM_TEST_SCHEMA>;

/** 🔴 返回体绝不含明文 Key（§9.3「只写不读」） */
export interface LlmConfigView {
  provider: LlmProvider;
  model: string;
  baseUrl: string;
  timeoutMs: number;
  hasKey: boolean;
  /** 末 4 位掩码，如 `****abcd`；无 Key 时为 null */
  keyHint: string | null;
  /** `llm.model` 的 `updated_at`（ISO）；从未保存过为 null */
  updatedAt: string | null;
}

/** `loadActive()` 的返回：本次调用真正使用的三元组 */
export interface LlmActiveConfig {
  provider: LlmProvider;
  baseUrl: string;
  model: string;
  apiKey: string;
  timeoutMs: number;
}

export interface LlmTestResult {
  ok: boolean;
  latencyMs?: number;
  model?: string;
  totalTokens?: number;
  /** 失败原因（用户可读，不含 Key） */
  error?: string;
  /** 失败时前端可据此精确分支：`timeout` / `quota` / `unreachable` */
  reason?: 'timeout' | 'quota' | 'unreachable';
}

/** 连通性测试用的极短提示词：省额度、结果可预期 */
const TEST_PROMPT = [
  { role: 'system' as const, content: '你是一个只回复一个单词的接口测试助手。' },
  { role: 'user' as const, content: '回复 OK' },
];

function hintOf(plaintext: string): string {
  const tail = plaintext.slice(-4);
  return `****${tail}`;
}

function clampTimeout(value: number | null | undefined): number {
  if (value === null || value === undefined || !Number.isFinite(value)) return LLM_TIMEOUT_DEFAULT_MS;
  return Math.min(Math.max(Math.round(value), LLM_TIMEOUT_MIN_MS), LLM_TIMEOUT_MAX_MS);
}

function isProvider(value: unknown): value is LlmProvider {
  return typeof value === 'string' && (LLM_PROVIDERS as readonly string[]).includes(value);
}

@Injectable()
export class LlmConfigStore {
  private readonly logger = new Logger(LlmConfigStore.name);

  constructor(
    @Inject(AppConfigStore) private readonly config: AppConfigStore,
    @Inject(AppSecretStore) private readonly secret: AppSecretStore,
  ) {}

  /** 未配置任何主密钥 → 无法加密 Key。调用方应提前把它变成可操作提示而非 500 */
  hasMasterKey(): boolean {
    return this.secret.hasMasterKey();
  }

  /** 读取配置视图（绝不含明文） */
  async getView(): Promise<LlmConfigView> {
    const [providerRaw, modelRaw, baseUrlRaw, timeoutRaw, modelRow] = await Promise.all([
      this.config.get<string>(CONFIG_KEY_LLM_PROVIDER),
      this.config.get<string>(CONFIG_KEY_LLM_MODEL),
      this.config.get<string>(CONFIG_KEY_LLM_BASE_URL),
      this.config.get<number>(CONFIG_KEY_LLM_TIMEOUT_MS),
      this.config.getRaw(CONFIG_KEY_LLM_MODEL),
    ]);

    const hasKey = await this.secret.exists(SECRET_KEY_LLM_API);
    const revealed = hasKey ? await this.secret.reveal(SECRET_KEY_LLM_API) : null;

    return {
      provider: isProvider(providerRaw) ? providerRaw : 'openai',
      model: typeof modelRaw === 'string' ? modelRaw : '',
      baseUrl: typeof baseUrlRaw === 'string' ? baseUrlRaw : '',
      timeoutMs: clampTimeout(timeoutRaw),
      hasKey,
      keyHint: revealed ? hintOf(revealed.plaintext) : null,
      updatedAt: modelRow ? modelRow.updatedAt.toISOString() : null,
    };
  }

  /**
   * 保存配置。
   * 🔴 先写非敏感项再写密钥：若密钥写入失败（主密钥缺失），非敏感项已落库但
   *    配置整体不可用 —— 这是可接受的中间态，比「先写密钥再写配置失败」更安全
   *    （后者会留下一个没有任何可用参数的孤儿密钥）。
   */
  async save(input: LlmConfigSaveInput): Promise<LlmConfigView> {
    const timeoutMs = clampTimeout(input.timeoutMs);

    await Promise.all([
      this.config.upsert(CONFIG_KEY_LLM_PROVIDER, input.provider, {
        valueType: 'string',
        group: CONFIG_GROUP,
        description: 'LLM 供应商预设',
      }),
      this.config.upsert(CONFIG_KEY_LLM_MODEL, input.model, {
        valueType: 'string',
        group: CONFIG_GROUP,
        description: 'LLM 模型名',
      }),
      this.config.upsert(CONFIG_KEY_LLM_BASE_URL, input.baseUrl, {
        valueType: 'string',
        group: CONFIG_GROUP,
        description: 'OpenAI 兼容端点 base_url',
      }),
      this.config.upsert(CONFIG_KEY_LLM_TIMEOUT_MS, timeoutMs, {
        valueType: 'number',
        group: CONFIG_GROUP,
        description: '单次对话超时（毫秒）',
      }),
    ]);

    if (input.apiKey !== undefined) {
      await this.secret.set(SECRET_KEY_LLM_API, input.provider, input.apiKey);
    }

    return this.getView();
  }

  /**
   * 供出网调用方取用：一次性给出「本次调用」的完整凭据。
   * 返回 `null` 表示未配置（缺 Key 或缺 base_url），调用方应走降级分支而不是报错。
   */
  async loadActive(): Promise<LlmActiveConfig | null> {
    const [providerRaw, modelRaw, baseUrlRaw, timeoutRaw] = await Promise.all([
      this.config.get<string>(CONFIG_KEY_LLM_PROVIDER),
      this.config.get<string>(CONFIG_KEY_LLM_MODEL),
      this.config.get<string>(CONFIG_KEY_LLM_BASE_URL),
      this.config.get<number>(CONFIG_KEY_LLM_TIMEOUT_MS),
    ]);

    const baseUrl = typeof baseUrlRaw === 'string' && baseUrlRaw.trim() !== '' ? baseUrlRaw.trim() : null;
    const model = typeof modelRaw === 'string' && modelRaw.trim() !== '' ? modelRaw.trim() : null;
    if (baseUrl === null || model === null) return null;

    const revealed = await this.secret.reveal(SECRET_KEY_LLM_API);
    if (revealed === null || revealed.plaintext.trim() === '') return null;

    return {
      provider: isProvider(providerRaw) ? providerRaw : 'custom',
      baseUrl,
      model,
      apiKey: revealed.plaintext,
      timeoutMs: clampTimeout(timeoutRaw),
    };
  }

  /**
   * 用「表单值（缺项回落已保存配置）」发一次极短请求，验证端点与密钥是否可用。
   * 🔴 永不抛错 —— 连通性测试的全部产出都装在返回体里，供前端直接展示。
   */
  async test(input: LlmConfigTestInput = {}): Promise<LlmTestResult> {
    const stored = await this.getView();
    const baseUrl = input.baseUrl ?? stored.baseUrl;
    const model = input.model ?? stored.model;
    const timeoutMs = clampTimeout(input.timeoutMs ?? stored.timeoutMs);
    const provider = input.provider ?? stored.provider;

    if (baseUrl.trim() === '' || model.trim() === '') {
      return { ok: false, error: '请先填写 base_url 与模型名', reason: 'unreachable' };
    }

    let apiKey = input.apiKey;
    if (apiKey === undefined) {
      const revealed = await this.secret.reveal(SECRET_KEY_LLM_API);
      if (revealed === null || revealed.plaintext.trim() === '') {
        return { ok: false, error: '尚未保存 API Key，无法测试连通性', reason: 'unreachable' };
      }
      apiKey = revealed.plaintext;
    }

    try {
      const result = await chatCompletion({
        baseUrl,
        model,
        apiKey,
        messages: TEST_PROMPT,
        timeoutMs,
        maxTokens: 8,
        temperature: 0,
      });
      return { ok: true, latencyMs: result.latencyMs, model: result.model, totalTokens: result.totalTokens };
    } catch (err) {
      if (err instanceof AiTimeoutError) return { ok: false, error: err.message, reason: 'timeout' };
      if (err instanceof AiQuotaExceededError) return { ok: false, error: err.message, reason: 'quota' };
      if (err instanceof AiClientError) {
        this.logger.warn(`[llm] 连通性测试失败 provider=${provider}：${err.message}`);
        return { ok: false, error: err.message, reason: 'unreachable' };
      }
      return { ok: false, error: '测试执行失败，请稍后重试', reason: 'unreachable' };
    }
  }
}
