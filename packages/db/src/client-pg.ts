/**
 * PostgreSQL 连接工厂（完整档，03 文档 §8.1）
 *
 * 与 `client-sqlite.ts` 构成**同一套接口**的两种实现：
 * 业务层通过 `client.ts` 的 `createDb()` 拿到连接，**不感知方言**。
 */

import { drizzle, type NodePgDatabase } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';

import { setActiveDialect, type Dialect } from './dialect.js';
import * as schema from './schema/index.js';
import type { DbConnectionConfig } from './types.js';

/** PG 侧的 drizzle 数据库类型（业务层用它做仓储方法的类型标注） */
export type PgDb = NodePgDatabase<typeof schema> & { $client: Pool };

/** 连接池默认上限：NAS 规格 2-3 学生（04 文档 Q1），20 足够且不挤占 16GB 内存 */
export const PG_POOL_MAX = 20;

export interface PgClient {
  db: PgDb;
  pool: Pool;
  dialect: Dialect;
  close: () => Promise<void>;
}

/**
 * 创建 PG 连接池。
 *
 * ⚠️ 必须由调用方在服务停止时调用 `close()`，否则 worker 进程不会退出
 *    （`pnpm -r test` 会挂住）。
 */
export function createPgClient(config: DbConnectionConfig): PgClient {
  // 🔴 与 SQLite 档对称：在此登记方言，保证 `boolColumn` 的值映射按PG 档透传
  //    （本工厂可能被测试/脚本直接调用，绕过 `createDb`）。
  setActiveDialect('postgres');

  const pool = new Pool({
    connectionString: config.url,
    max: config.maxConnections > 0 ? config.maxConnections : PG_POOL_MAX,
    // 池内连接空闲 30s 回收；10s 拿不到连接就报错（避免请求无限挂起）
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 10_000,
  });

  // 🔴 连接池错误必须有监听器，否则 idle client 上的错误会冒泡成 unhandledRejection
  //    并静默杀掉进程（Node 已知行为，pg 文档明确要求）。
  pool.on('error', (err: Error) => {
    console.error('[db] PostgreSQL 空闲连接异常：', err.message);
  });

  const db = drizzle(pool, { schema, logger: config.debug });

  return {
    db: db as PgDb,
    pool,
    dialect: 'postgres',
    close: async () => {
      await pool.end();
    },
  };
}
