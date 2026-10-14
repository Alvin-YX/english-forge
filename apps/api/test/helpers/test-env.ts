/**
 * 测试夹具：环境变量 + 真实 SQLite 库（跑真实迁移 SQL）。
 *
 * 🔴 为什么用真实库而不是 mock：
 *    本层的职责就是「把 SQL 跑对」——方言差异、`now()` UDF、FTS5 虚拟表、
 *    `defaultNow()` 生成字面量、JSON 列的跨方言读取……这些用 mock 全测不到。
 *    SQLite 档与 PG 档走同一套 schema，本机有 better-sqlite3 预编译二进制，
 *    零外部依赖即可跑。
 *
 * 🔴 迁移 SQL 来自 `packages/db/migrations-sqlite/0000_init.sql`，
 *    **整份脚本一次性执行**：better-sqlite3 的 `exec()` 用 SQLite 自己的
 *    解析器切分语句，能正确处理触发器体内的 `END;`，
 *    所以测试里不需要复刻 `splitSqlStatements()` 那个状态机。
 *
 * 注意：本夹具**不写** `forge_migrations` 表。库是临时库，只验证
 * 「结构可建、查询可跑」；迁移幂等性由 migrate CLI 自身负责。
 */

import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';

import { createDb, type AnyDbClient } from '@eng-forge/db';

/** 测试用密钥：满足 ≥32 字符校验，值本身无安全含义 */
export const TEST_ACCESS_SECRET = 'test-access-secret-minimum-32-chars!!!';
export const TEST_REFRESH_SECRET = 'test-refresh-secret-minimum-32-chars!!!';
export const TEST_ISSUER = 'english-forge-test';

/**
 * 测试用主密钥：`APP_SECRET_MASTER_KEY` 要求 base64 解码后恰好 32 字节。
 * 值本身无安全含义（测试库是临时库，测完即删）。
 *
 * 🔴 不设它时服务照样能启动，但 `AppSecretStore.set()` 会抛裸 Error，
 *    导致所有写密钥的断言变成 500 —— 这里必须给。
 */
export const TEST_MASTER_KEY = 'MDEyMzQ1Njc4OTAxMjM0NTY3ODkwMTIzNDU2Nzg5MDE=';

/** 组装一套可用的测试环境变量 */
export function setupTestEnv(sqliteFile: string): Record<string, string> {
  return {
    NODE_ENV: 'test',
    PORT: '0',
    DATABASE_URL: `file:${sqliteFile}`,
    DB_DIALECT: 'sqlite',
    JWT_ACCESS_SECRET: TEST_ACCESS_SECRET,
    JWT_REFRESH_SECRET: TEST_REFRESH_SECRET,
    JWT_ISSUER: TEST_ISSUER,
    JWT_ACCESS_TTL_SEC: '900',
    JWT_REFRESH_TTL_DAY: '30',
    APP_SECRET_MASTER_KEY: TEST_MASTER_KEY,
    CORS_ORIGINS: '*',
    BODY_LIMIT: '2mb',
    MEDIA_ROOT: tmpdir(),
    LOG_LEVEL: 'error',
  };
}

export interface TestDbHandle {
  path: string;
  cleanup: () => void;
}

/** 建一个临时 SQLite 库并把迁移脚本全部执行完 */
export async function createTestDb(): Promise<TestDbHandle> {
  const dir = mkdtempSync(`${tmpdir()}/ef-api-test-`);
  const path = `${dir}/forge-test.db`;

  const client = createDb({
    ...setupTestEnv(path),
  } as NodeJS.ProcessEnv);
  await applyMigrations(client);
  await client.close();

  return {
    path,
    cleanup: () => rmSync(dir, { recursive: true, force: true }),
  };
}

/** 整份迁移脚本一次执行（SQLite 用自己的解析器切分语句） */
async function applyMigrations(client: AnyDbClient): Promise<void> {
  const migrationDir = client.dialect === 'sqlite' ? 'migrations-sqlite' : 'migrations';
  const url = new URL(`../../../../packages/db/${migrationDir}/0000_init.sql`, import.meta.url);
  const sqlText = readFileSync(fileURLToPath(url), 'utf8');

  // `SqliteClient` / `PgClient` 接口未在 `@eng-forge/db` 的包出口导出
  // （只导出了 `SqliteDb` / `PgDb` 与连接工厂），故按结构断言取底层句柄。
  // 🔶 若后续需要在测试中常用，建议在 db 包补充导出这两个类型。
  if (client.dialect === 'sqlite') {
    const raw = (client as unknown as { raw: { exec(sql: string): unknown } }).raw;
    raw.exec(sqlText);
    return;
  }

  // PG 走简单查询协议：单次 `query()` 可跑多条语句（含 DO $$ 块）
  const pool = (client as unknown as { pool: { query(sql: string): Promise<unknown> } }).pool;
  await pool.query(sqlText);
}
