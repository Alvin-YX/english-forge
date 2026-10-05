/**
 * 连接工厂统一入口 —— 按 `DB_DIALECT` / `DATABASE_URL` 自动选择（03 文档 §8.1）
 *
 * 业务层**只 import 本文件**，禁止直接 import `client-pg` / `client-sqlite`，
 * 否则方言分支会散落回业务代码，违反「差异收敛到 3 个文件」的硬性要求。
 */

import { createPgClient, type PgClient } from './client-pg.js';
import { createSqliteClient, type SqliteClient } from './client-sqlite.js';
import { resolveDialect, type Dialect } from './dialect.js';
import type { DbConnectionConfig } from './types.js';

export type { PgDb } from './client-pg.js';
export { createPgClient, PG_POOL_MAX } from './client-pg.js';
export type { SqliteDb } from './client-sqlite.js';
export {
  assertFts5Available,
  createSqliteClient,
  resolveSqlitePath,
  SQLITE_BUSY_TIMEOUT_MS,
  SQLITE_MAX_CONNECTIONS,
} from './client-sqlite.js';

/** 两种方言的连接句柄联合类型 */
export type AnyDbClient = PgClient | SqliteClient;


export interface DbConfigOverrides {
  /** 覆盖自动探测结果（测试用） */
  dialect?: Dialect;
  /** 内存 SQLite（测试用） */
  inMemorySqlite?: boolean;
}

/** PG 连接池默认上限（i5-9500T 16GB / 2-3 学生，04 文档 Q1） */
export const DEFAULT_MAX_CONNECTIONS = 20;

/**
 * 从环境变量装配连接配置。
 *
 * 🔴 不在此处设默认值兜底 `DATABASE_URL`：
 *    03 文档 §8.1 要求方言显式可知，静默猜一个连接串会让「跑错数据库」变成
 *    「数据写进了另一个库」这类极难排查的问题。缺失即抛错。
 */
export function loadDbConfig(env: NodeJS.ProcessEnv = process.env): DbConnectionConfig {
  const url = env.DATABASE_URL;
  if (url === undefined || url === '') {
    throw new Error(
      '缺少 DATABASE_URL 环境变量（03 文档 §8.1：PG 档为 postgres://…，SQLite 档为 file:./data/forge.db）',
    );
  }
  return {
    // 🔴 把 url 传给 resolveDialect：DB_DIALECT 缺省时按 URL 前缀判档，
    //    否则 DATABASE_URL=file:... 会被误判为 PG 档并触发 ECONNREFUSED
    dialect: resolveDialect(env.DB_DIALECT, url),
    url,
    maxConnections: Number(env.DB_POOL_MAX ?? DEFAULT_MAX_CONNECTIONS),
    debug: env.DB_DEBUG === '1' || env.DB_DEBUG === 'true',
  };
}

/**
 * 创建数据库连接：按方言分派。
 *
 * @example
 * ```ts
 * const client = createDb();
 * // 业务代码
 * const rows = await client.db.select().from(word).limit(10);
 * await client.close();
 * ```
 */
export function createDb(
  env: NodeJS.ProcessEnv = process.env,
  overrides: DbConfigOverrides = {},
): AnyDbClient {
  const config = loadDbConfig(env);

  if (overrides.dialect !== undefined) {
    config.dialect = overrides.dialect;
  }

  if (config.dialect === 'sqlite') {
    return createSqliteClient(config, { inMemory: overrides.inMemorySqlite === true });
  }
  return createPgClient(config);
}

/** 当前环境将使用的方言（供 worker/CLI 判断要不要走 sqlite 队列分支） */
export function currentDialect(env: NodeJS.ProcessEnv = process.env): Dialect {
  const config = loadDbConfig(env);
  return config.dialect;
}
