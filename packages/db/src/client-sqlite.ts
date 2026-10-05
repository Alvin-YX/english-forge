/**
 * SQLite 连接工厂（降级档，03 文档 §4.4）
 *
 * 零外网 / 无 PG 容器时的等价档位：**同一套 schema、同一套业务代码**。
 *
 * 关键差异（均由 `dialect.ts` 收敛，此处只做 SQLite 侧实现）：
 * - 数组列 → JSON 数组字符串（`exam_tags` 走 `jsonStringArray()`）
 * - tsvector → FTS5 虚拟表（`word_fts` / `sentence_fts`）
 * - JSONB GIN 索引 → 无（聚合预计算到 `word_weakness` 普通表）
 * - `SKIP LOCKED` → `BEGIN IMMEDIATE` + `LIMIT n`（见 dialect.ts `buildJobClaimSql`）
 */

import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

import Database from 'better-sqlite3';
import { drizzle, type BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';

import type { Dialect } from './dialect.js';
import { SQLITE_NOW_UDF_NAME } from './dialect.js';
import * as schema from './schema/index.js';
import type { DbConnectionConfig } from './types.js';


export type SqliteDb = BetterSQLite3Database<typeof schema> & { $client: Database.Database };

export interface SqliteClient {
  db: SqliteDb;
  raw: Database.Database;
  dialect: Dialect;
  close: () => void;
}

/**
 * SQLite 的连接「池」上限**恒为 1**。
 *
 * 原因（§4.4 队列行）：better-sqlite3 是**同步**驱动，且 SQLite 同一时刻
 * 只允许一个写事务。`shamefully-hoist` 下多连接并发写会直接抛
 * `SQLITE_BUSY`。写入靠 WAL + `busy_timeout` 排队，不靠连接池。
 */
export const SQLITE_MAX_CONNECTIONS = 1;

/** 锁等待超时（毫秒）。移动端/多进程并发写时的退避上限 */
export const SQLITE_BUSY_TIMEOUT_MS = 5_000;

export interface SqliteOpenOptions {
  /** 内存库（测试用），此时忽略 url */
  readonly inMemory?: boolean;
}

/**
 * 创建 SQLite 连接。
 *
 * 开启的 PRAGMA（§4.4 要求 WAL + FTS5）：
 * - `journal_mode=WAL`：读写不互相阻塞，SSE 长连接不会被写事务卡住
 * - `foreign_keys=ON` 🔴：**默认关闭**，必须显式开，否则所有外键约束形同虚设
 *   （这会让 §4 约定的级联删除全部失效）
 * - `busy_timeout`：并发写时等待而非立刻报 SQLITE_BUSY
 * - `synchronous=NORMAL`：WAL 下的推荐值，比 FULL 快且仍能抗进程崩溃
 */
export function createSqliteClient(
  config: DbConnectionConfig,
  options: SqliteOpenOptions = {},
): SqliteClient {
  const isMemory = options.inMemory === true;
  const filename = isMemory ? ':memory:' : resolveSqlitePath(config.url);

  if (!isMemory) {
    // 确保 data 目录存在，否则 better-sqlite3 会以「unable to open database」失败
    mkdirSync(dirname(filename), { recursive: true });
  }

  const raw = new Database(filename);
  raw.pragma('journal_mode = WAL');
  raw.pragma('foreign_keys = ON');
  raw.pragma(`busy_timeout = ${SQLITE_BUSY_TIMEOUT_MS}`);
  raw.pragma('synchronous = NORMAL');

  // 🔴 注册 `now()` UDF：Drizzle 的 `.defaultNow()` 生成字面量 `now()`（PG 专有），
  //    better-sqlite3 默认没有该函数 → 不注册则所有带 defaultNow 的表 insert
  //    都会报「no such function: now」。
  //    返回 ISO8601 而非 SQLite 的 CURRENT_TIMESTAMP（后者是
  //    「2026-10-05 05:29:28」空格分隔无时区，违反 §4.4 的 ISO8601 约定）。
  raw.function(SQLITE_NOW_UDF_NAME, () => new Date().toISOString());

  const db = drizzle(raw, { schema, logger: config.debug });

  return {
    db: db as SqliteDb,
    raw,
    dialect: 'sqlite',
    close: () => {
      if (raw.open) raw.close();
    },
  };
}

/**
 * 把 `DATABASE_URL` 规整为文件系统路径。
 * 兼容 `file:./data/forge.db`、`file:../forge.db` 与裸路径三种写法。
 */
export function resolveSqlitePath(url: string): string {
  const withoutScheme = url.startsWith('file:') ? url.slice('file:'.length) : url;
  // 去掉 better-sqlite3 的查询参数（?mode=ro 等）
  const [path] = withoutScheme.split('?');
  if (path === undefined || path === '') {
    throw new Error(`DATABASE_URL 缺少 SQLite 文件路径：${url}`);
  }
  return path;
}

/** FTS5 是否可用（部分精简版 SQLite 未编译 FTS5，启动时自检一次） */
export function assertFts5Available(raw: Database.Database): void {
  try {
    raw.exec('CREATE VIRTUAL TABLE IF NOT EXISTS __fts5_probe USING fts5(x)');
    raw.exec('DROP TABLE IF EXISTS __fts5_probe');
  } catch (err) {
    throw new Error(
      `当前 SQLite 未启用 FTS5，全文检索不可用（§4.4 依赖 FTS5）：${(err as Error).message}`,
    );
  }
}
