/**
 * 系统健康检查 —— 03 文档 §5.7
 *
 * 两个端点的分工（**不要合并**，它们回答的是不同问题）：
 *   - `healthz`：进程活着吗？—— **不碰任何外部依赖**，永远 200。
 *     用途：负载均衡器/反向代理判断要不要把流量打过来。
 *   - `readyz`：能正常干活吗？—— 探测 DB（+ 媒体根目录），任一失败返回 503。
 *     用途：容器编排判断要不要开始接流量（迁移未完成时不接）。
 *
 * 🔴 `healthz` 绝不查 DB：DB 抖动时不能让整个 API 被判死，
 *    否则会出现「DB 短时不可用 → 全部实例被判不健康 → 全部重启 → 雪崩」。
 */

import { Inject, Injectable } from '@nestjs/common';

import type { Env } from '../../infra/config/env.js';
import { ENV_CONFIG } from '../../infra/config/tokens.js';
import { DbConnection } from '../../infra/db/db.module.js';
import { APP_NAME, APP_VERSION } from '../../infra/version.js';

/** 进程启动时刻（模块加载时取一次，避免每次请求重算） */
const STARTED_AT_MS = Date.now();

export interface HealthView {
  status: 'ok';
  app: string;
  version: string;
  uptimeSec: number;
  node: string;
}

export interface ReadinessCheck {
  name: string;
  ok: boolean;
  detail?: string;
  ms?: number;
}

export interface ReadinessView {
  status: 'ok' | 'not_ready';
  ok: boolean;
  dialect: 'postgres' | 'sqlite';
  checks: ReadinessCheck[];
}

export interface SystemInfoView {
  app: string;
  version: string;
  node: string;
  env: 'development' | 'test' | 'production';
  dialect: 'postgres' | 'sqlite';
  startedAt: string;
  mediaRoot: string;
}

@Injectable()
export class SystemService {
  constructor(
    @Inject(DbConnection) private readonly conn: DbConnection,
    @Inject(ENV_CONFIG) private readonly env: Env,
  ) {}

  /** 进程级健康，无 I/O，永远成功 */
  health(): HealthView {
    return {
      status: 'ok',
      app: APP_NAME,
      version: APP_VERSION,
      uptimeSec: Math.round(process.uptime()),
      node: process.version,
    };
  }

  async ready(): Promise<ReadinessView> {
    const checks: ReadinessCheck[] = [];

    // DB 往返探测。用 `SELECT 1` 而非业务表查询：
    // 迁移未完成时业务表可能不存在，但那不是「DB 不通」，是「未就绪」——
    // 两者都要报 503，但明细不同。
    const t0 = Date.now();
    try {
      await this.conn.ping();
      checks.push({ name: 'database', ok: true, ms: Date.now() - t0 });
    } catch (err) {
      checks.push({
        name: 'database',
        ok: false,
        detail: err instanceof Error ? err.message : String(err),
        ms: Date.now() - t0,
      });
    }

    return {
      status: checks.every((c) => c.ok) ? 'ok' : 'not_ready',
      ok: checks.every((c) => c.ok),
      dialect: this.conn.dialect,
      checks,
    };
  }

  info(): SystemInfoView {
    return {
      app: APP_NAME,
      version: APP_VERSION,
      node: process.version,
      env: this.env.NODE_ENV,
      dialect: this.conn.dialect,
      startedAt: new Date(STARTED_AT_MS).toISOString(),
      mediaRoot: this.env.MEDIA_ROOT,
    };
  }
}
