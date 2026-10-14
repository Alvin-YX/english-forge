/**
 * 大模型接入配置 —— 03 文档 §9.3「敏感配置管理」的可操作入口
 *
 * 🔴 全部路由 `@Roles(Role.ADMIN)`：保存 API Key 等于替整个家庭配置出网凭据，
 *    不能让普通学生/家长角色改到（`RolesGuard` 无通配符旁路，必须显式声明）。
 *
 * 🔴 只写不读：`GET /system/llm` 永不返回明文 Key，只给 `hasKey` 与 `keyHint`
 *    （末 4 位）。这是 §9.3 定的红线 —— 一旦返回明文，前端存储、浏览器扩展、
 *    代理日志都会成为泄露路径。
 *
 * 🔴 主密钥缺失时的行为：不返回 500 裸异常，而是抛带可操作提示的 `LLM_CONFIG_INVALID`。
 *    `APP_SECRET_MASTER_KEY` 未设置时服务仍能启动，但 `AppSecretStore.set()` 会抛
 *    裸 `Error`；这里提前拦下，告诉管理员具体该怎么补。
 */

import { ErrorCode } from '@eng-forge/contracts/api';
import { Role } from '@eng-forge/contracts/enums';
import { Body, Controller, Get, HttpCode, Inject, Post } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';

import { BusinessError } from '../../common/errors.business.js';
import { zodPipe } from '../../common/zod-validation.pipe.js';
import {
  LLM_TIMEOUT_DEFAULT_MS,
  LLM_TIMEOUT_MAX_MS,
  LLM_TIMEOUT_MIN_MS,
  LLM_PROVIDER_PRESETS,
  LlmConfigStore,
  LLM_SAVE_SCHEMA,
  LLM_TEST_SCHEMA,
} from '../../infra/ai/llm-config.store.js';
import type {
  LlmConfigSaveInput,
  LlmConfigTestInput,
  LlmConfigView,
  LlmTestResult,
} from '../../infra/ai/llm-config.store.js';
import { CurrentAuditMeta } from '../../infra/audit/audit-meta.decorator.js';
import type { AuditMeta } from '../../infra/audit/audit-meta.decorator.js';
import { AuditService } from '../../infra/audit/audit.service.js';
import { Roles } from '../../infra/profile/rbac.guard.js';

export interface LlmConfigViewWithEnv extends LlmConfigView {
  /** `APP_SECRET_MASTER_KEY` 是否已配置（false 时无法保存 Key） */
  hasMasterKey: boolean;
  /** 供前端展示的提示文案；`hasMasterKey` 为 true 时为 undefined */
  masterKeyHint?: string;
}

/** 前端下拉展示：把预设值一并返回，避免前端自己硬编码一份 base_url */
export interface LlmPresetsView {
  presets: typeof LLM_PROVIDER_PRESETS;
  timeoutDefaultMs: number;
  timeoutMinMs: number;
  timeoutMaxMs: number;
}

const MASTER_KEY_HINT =
  '服务器未配置 APP_SECRET_MASTER_KEY，无法加密保存 API Key。' +
  '请运行 `pnpm --filter @eng-forge/api exec tsx scripts/gen-master-key.mjs` 生成一个密钥，' +
  '写入 docker-compose 的 api 服务 env（APP_SECRET_MASTER_KEY=...）后重启。' +
  '⚠️ 该值一旦写入密钥就不可丢失，请随数据库备份一起保管。';

@Controller('system')
@ApiTags('system')
export class LlmConfigController {
  constructor(
    @Inject(LlmConfigStore) private readonly store: LlmConfigStore,
    @Inject(AuditService) private readonly audit: AuditService,
  ) {}

  /** 读取当前 LLM 配置（只写不读：不含明文 Key） */
  @Roles(Role.ADMIN)
  @Get('llm')
  @ApiOperation({ summary: '读取大模型配置（admin，不含明文 Key）' })
  async get(): Promise<LlmConfigViewWithEnv> {
    const view = await this.store.getView();
    const hasMasterKey = this.store.hasMasterKey();
    return { ...view, hasMasterKey, masterKeyHint: hasMasterKey ? undefined : MASTER_KEY_HINT };
  }

  /** 预设与边界值（前端渲染下拉与校验用，避免两端各维护一份常量） */
  @Roles(Role.ADMIN)
  @Get('llm/presets')
  @ApiOperation({ summary: '大模型预设与参数边界（admin）' })
  async presets(): Promise<LlmPresetsView> {
    return {
      presets: LLM_PROVIDER_PRESETS,
      timeoutDefaultMs: LLM_TIMEOUT_DEFAULT_MS,
      timeoutMinMs: LLM_TIMEOUT_MIN_MS,
      timeoutMaxMs: LLM_TIMEOUT_MAX_MS,
    };
  }

  /** 保存 LLM 配置（`apiKey` 可省略 = 沿用已保存的 Key） */
  @Roles(Role.ADMIN)
  @Post('llm')
  @HttpCode(200)
  @ApiOperation({ summary: '保存大模型配置（admin）' })
  async save(@CurrentAuditMeta() meta: AuditMeta, @Body(zodPipe(LLM_SAVE_SCHEMA)) body: LlmConfigSaveInput) {
    if (!this.store.hasMasterKey()) {
      // 提前拦下：否则 `AppSecretStore.set()` 会抛裸 Error → 退化成 500 UNKNOWN_ERROR
      throw new BusinessError(ErrorCode.LLM_CONFIG_INVALID, MASTER_KEY_HINT, 500);
    }

    await this.store.save(body);

    // 🔴 detail 里**只记变化了什么**，绝不记密钥本身（审计表随备份永久留存）
    await this.audit.record({
      action: 'system_config_change',
      targetType: 'app_config',
      targetId: 'llm',
      actorId: meta.actorId,
      ip: meta.ip,
      ua: meta.ua,
      detail: {
        provider: body.provider,
        model: body.model,
        baseUrl: body.baseUrl,
        timeoutMs: body.timeoutMs ?? null,
        keyChanged: body.apiKey !== undefined,
      },
    });

    const view = await this.store.getView();
    return { ...view, hasMasterKey: true };
  }

  /** 连通性测试：用表单值（缺项回落已保存配置）发一次极短请求 */
  @Roles(Role.ADMIN)
  @Post('llm/test')
  @HttpCode(200)
  @ApiOperation({ summary: '测试大模型连通性（admin，失败不抛错）' })
  async test(
    @CurrentAuditMeta() meta: AuditMeta,
    @Body(zodPipe(LLM_TEST_SCHEMA)) body: LlmConfigTestInput,
  ): Promise<LlmTestResult> {
    const result = await this.store.test(body);

    // 出网行为本身就要留痕（§9.2），无论成败 —— 失败记录才能解释「为什么一直连不上」
    await this.audit.record({
      action: 'egress_call',
      targetType: 'llm',
      targetId: body.baseUrl ?? 'stored-config',
      actorId: meta.actorId,
      ip: meta.ip,
      ua: meta.ua,
      detail: {
        kind: 'connectivity_test',
        ok: result.ok,
        provider: body.provider ?? null,
        model: body.model ?? null,
        latencyMs: result.latencyMs ?? null,
        reason: result.reason ?? null,
      },
    });

    return result;
  }
}
