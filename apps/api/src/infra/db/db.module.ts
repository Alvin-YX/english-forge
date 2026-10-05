/**
 * 数据库连接模块 —— `@Global()`，复用 `@eng-forge/db` 的 `createDb()`。
 *
 * 🔴 业务层只允许 `import { DbConnection } from '../../infra/db/db.module.js'`，
 *    禁止直接 `import { createDb } from '@eng-forge/db'`（方言分支会散落回业务代码，
 *    违反 03 文档 §8.1「差异收敛到 3 个文件」）。
 *
 * 类型约定：与 `packages/db/src/cli/seed.ts` 的 `type SeedDb = PgDb` 保持一致 ——
 * schema 是用 `pg-core` 构造的，SQLite 实例在结构上兼容，仅在装配处做一次断言。
 */

import { type AnyDbClient, createDb, type PgDb } from '@eng-forge/db';
import { Global, Inject, Injectable, Module, type OnModuleDestroy } from '@nestjs/common';

import type { Env } from '../config/env.js';
import { ENV_CONFIG } from '../config/tokens.js';

/** 业务层唯一使用的 drizzle 句柄类型 */
export type ForgeDb = PgDb;

@Injectable()
export class DbConnection implements OnModuleDestroy {
  readonly client: AnyDbClient;

  constructor(@Inject(ENV_CONFIG) _env: Env) {
    // 🔴 注入 ENV_CONFIG 只为强制在启动阶段完成 env 校验；
    //    真正的连接参数由 createDb() 自行从 process.env 装配（保持 db 包契约不变）。
    this.client = createDb(process.env);
  }

  get db(): ForgeDb {
    return this.client.db as unknown as ForgeDb;
  }

  get dialect(): 'postgres' | 'sqlite' {
    return this.client.dialect;
  }

  /**
   * 跨方言连通性探测（`SELECT 1`）。
   *
   * PG 走 `execute()`（async），SQLite 走 `all()`（synchronous）。
   * 两者统一返回 Promise<void>，失败时抛异常由调用方捕获。
   */
  async ping(): Promise<void> {
    const { sql } = await import('./query.js');
    if (this.client.dialect === 'sqlite') {
      const sqliteDb = this.client.db as unknown as { all: (q: unknown) => unknown };
      sqliteDb.all(sql`SELECT 1`);
    } else {
      const pgDb = this.client.db as unknown as { execute: (q: unknown) => Promise<unknown> };
      await pgDb.execute(sql`SELECT 1`);
    }
  }

  async close(): Promise<void> {
    await Promise.resolve(this.client.close());
  }

  onModuleDestroy(): void {
    this.close().catch((err: unknown) => {
      console.error('[db] 关闭数据库连接失败：', err instanceof Error ? err.message : err);
    });
  }
}

@Global()
@Module({
  providers: [DbConnection],
  exports: [DbConnection],
})
export class DbModule {}
