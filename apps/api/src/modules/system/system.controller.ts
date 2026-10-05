/**
 * 系统端点 —— 03 文档 §5.7
 *
 * `healthz` / `readyz` / `info` 都是 `@Public()`：
 *   - 健康检查端点必须能被负载均衡器/容器编排**匿名**访问，
 *     一旦要求鉴权，编排系统就无法区分「进程死了」与「DB 抖动」。
 *   - 全部路径仍带 `/api/v1` 前缀（`setGlobalPrefix`），
 *     即健康检查地址为 `http://<host>:<port>/api/v1/readyz`。
 *
 * 🔴 路径穿越防护**不在本模块**：媒体路径解析（`MEDIA_PATH_INVALID: 6002`）
 *    属于 `modules/media`。本模块只做进程与依赖存活探测。
 *
 * 🔶 已知契约分歧（如实登记，未擅改任何包）：
 *   - `packages/db` 的 `PROFILE_PERF_TIERS = ['auto','smooth','standard','power_saving']`
 *     是**用户偏好**档位；`packages/contracts` 的 `PerfTier` 是**引擎**档位
 *     （fluid/standard/power_saving）。两套取值有部分重叠但无共享类型。
 *   - 本端点读写的 `speech.default_perf_tier` 是引擎默认档位，
 *     故按 `PerfTier` 校验。profile 级偏好用 `PROFILE_PERF_TIERS`，走 `/me/profile`。
 */

import { ErrorCode } from '@eng-forge/contracts/api';
import { PERF_TIERS, Role, type PerfTier } from '@eng-forge/contracts/enums';
import { CONFIG_KEY_DEFAULT_PERF_TIER } from '@eng-forge/db/schema';
import { Body, Controller, Get, HttpCode, Inject, Post } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { z } from 'zod';

import { BusinessError } from '../../common/errors.business.js';
import { zodPipe } from '../../common/zod-validation.pipe.js';
import { AppConfigStore } from '../../infra/config/app-config.store.js';
import { Public } from '../../infra/profile/public.decorator.js';
import { Roles } from '../../infra/profile/rbac.guard.js';

import { type HealthView, SystemService, type ReadinessView, type SystemInfoView } from './system.service.js';

/** `z.enum()` 要求非空元组类型，而 `PERF_TIERS` 声明为只读数组 —— 此处收窄一次 */
const TIER_VALUES = PERF_TIERS.slice() as [PerfTier, ...PerfTier[]];

export const TIER_CHANGE_SCHEMA = z.object({
  /** 引擎默认档位（§7.7）：fluid / standard / power_saving */
  tier: z.enum(TIER_VALUES),
  /** 变更理由：写入审计，便于回溯「为什么今天分数变低了」 */
  reason: z.string().min(1).max(255),
});

export type TierChangeInput = z.infer<typeof TIER_CHANGE_SCHEMA>;

export interface TierView {
  tier: PerfTier;
  /** config = 库里已设置；default = 库里无记录，用代码默认值 */
  source: 'config' | 'default';
  defaultTier: PerfTier;
}

/** 代码级默认档位（`speech.default_perf_tier` 无记录时生效） */
export const DEFAULT_PERF_TIER: PerfTier = 'standard';

@Controller('system')
@ApiTags('system')
export class SystemController {
  constructor(
    @Inject(SystemService) private readonly service: SystemService,
    @Inject(AppConfigStore) private readonly config: AppConfigStore,
  ) {}

  /** 进程存活探测：不查任何外部依赖，永远 200 */
  @Public()
  @Get('healthz')
  @ApiOperation({ summary: '进程健康检查（不查外部依赖）' })
  health(): HealthView {
    return this.service.health();
  }

  /** 就绪探测：DB 不可用即 503，容器编排据此暂停接流量 */
  @Public()
  @Get('readyz')
  @ApiOperation({ summary: '就绪检查（含数据库往返探测）' })
  async readyz(): Promise<ReadinessView> {
    const view = await this.service.ready();
    if (!view.ok) {
      throw new BusinessError(ErrorCode.SYSTEM_NOT_INITIALIZED, '服务未就绪，数据库不可用', 503, view.checks);
    }
    return view;
  }

  /** 版本与运行环境信息（仅 LAN 内使用，不返回密钥或连接串） */
  @Public()
  @Get('info')
  @ApiOperation({ summary: '服务信息（版本/方言/启动时间）' })
  info(): SystemInfoView {
    return this.service.info();
  }

  /** 全局性能档位（§7.7）。只读，任何已登录角色都可查 */
  @Get('tier')
  @ApiOperation({ summary: '读取全局性能档位' })
  async tier(): Promise<TierView> {
    const row = await this.config.getRaw(CONFIG_KEY_DEFAULT_PERF_TIER);
    if (row === null) {
      return { tier: DEFAULT_PERF_TIER, source: 'default', defaultTier: DEFAULT_PERF_TIER };
    }
    const valid = isTier(row.value);
    return {
      tier: valid ? (row.value as PerfTier) : DEFAULT_PERF_TIER,
      source: valid ? 'config' : 'default',
      defaultTier: DEFAULT_PERF_TIER,
    };
  }

  /** 变更全局性能档位。需 admin —— 降档会影响全体学生的评分模型 */
  @Roles(Role.ADMIN)
  @Post('tier')
  @HttpCode(200)
  @ApiOperation({ summary: '变更全局性能档位（admin）' })
  async changeTier(@Body(zodPipe(TIER_CHANGE_SCHEMA)) body: TierChangeInput): Promise<TierView> {
    await this.config.upsert(CONFIG_KEY_DEFAULT_PERF_TIER, body.tier, {
      valueType: 'string',
      group: 'speech',
      description: `全局性能档位（reason: ${body.reason}）`,
      editable: false,
    });
    return { tier: body.tier, source: 'config', defaultTier: DEFAULT_PERF_TIER };
  }
}

function isTier(value: unknown): value is PerfTier {
  return typeof value === 'string' && (PERF_TIERS as readonly string[]).includes(value);
}
