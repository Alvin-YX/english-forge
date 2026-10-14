/**
 * AI 基础设施模块 —— 出网 LLM 客户端与配置门面。
 *
 * 🔴 依赖方向：`modules/**`（conversation / system）→ 本模块 → `infra/config`。
 *    业务层**不直接** import `ai-client.ts` / `llm-config.store.ts` 之外的实现细节，
 *    且本模块不反向 import 任何业务模块（规则 `infra-no-business-dep`）。
 *
 * `AppConfigStore` / `AppSecretStore` 由 `@Global()` 的 `StoresModule` 提供，无需在此 import。
 */

import { Module } from '@nestjs/common';

import { LlmConfigStore } from './llm-config.store.js';

@Module({
  providers: [LlmConfigStore],
  exports: [LlmConfigStore],
})
export class AiModule {}
