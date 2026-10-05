/**
 * 迁移执行器 —— `pnpm --filter @eng-forge/db migrate`
 *
 * 🔴 为什么自己写而不用 drizzle-kit 的 migrate（§4.4 阶段 B）：
 *   NAS 离线环境要求「SQL 透明可审计」，drizzle-kit 生成的迁移需人工 review，
 *   且本次 schema 含**物化视图**（PG）/ **FTS5 虚拟表**（SQLite）等
 *   drizzle-kit 无法表达的对象，必须手写 SQL。
 *
 * 幂等保证（§8.5 集成测试⑦）：
 *   1. 迁移文件用 `IF NOT EXISTS` 语义编写
 *   2. 执行前查 `forge_migrations`，已应用的版本直接跳过
 *   3. 已应用文件的 hash 与库中记录不一致 → **拒绝执行并报错**
 *      （防止有人改历史迁移，破坏可审计性）
 */

/* eslint-disable no-console -- 本文件是 CLI 入口，输出迁移结果到 stdout 是其职责 */
import { createHash } from 'node:crypto';
import { readFileSync, readdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { assertFts5Available } from '../client-sqlite.js';
import { loadDbConfig } from '../client.js';
import { dialectFromUrl, type Dialect } from '../dialect.js';
import type { MigrationResult } from '../types.js';

/** 判断本模块是否作为入口被直接执行（被 import 时返回 false） */
function isMainModule(importMetaUrl: string): boolean {
  if (process.argv[1] === undefined) return false;
  return resolve(fileURLToPath(importMetaUrl)) === resolve(process.argv[1]);
}


/** 迁移目录（按方言分列，§4.4「两套 SQL」） */
export const MIGRATION_DIRS: Record<Dialect, string> = {
  postgres: 'migrations',
  sqlite: 'migrations-sqlite',
};

export interface MigrationFile {
  version: string;
  name: string;
  sql: string;
  hash: string;
}

/** 迁移文件名的版本前缀，如 `0000_init.sql` → `0000` */
const VERSION_RE = /^(\d+)_(.+)\.sql$/;

export function listMigrationFiles(dir: string): MigrationFile[] {
  const files = readdirSync(dir)
    .filter((f) => f.endsWith('.sql'))
    .sort();
  const out: MigrationFile[] = [];
  for (const file of files) {
    const m = VERSION_RE.exec(file);
    if (m === null || m === undefined) {
      throw new Error(`迁移文件名不合规（须为 NNNN_name.sql）：${file}`);
    }
    const sql = readFileSync(join(dir, file), 'utf8');
    out.push({
      version: m[1] as string,
      name: m[2] as string,
      sql,
      hash: createHash('sha256').update(sql).digest('hex'),
    });
  }
  return out;
}

/** 已在库中执行的迁移（版本 → hash） */
async function readApplied(
  exec: (sql: string) => Promise<unknown[]>,
): Promise<Map<string, string>> {
  const rows = await exec('SELECT version, hash FROM forge_migrations');
  return new Map(
    rows.map((r) => {
      const row = r as { version: string; hash: string };
      return [row.version, row.hash];
    }),
  );
}

/**
 * 把整份迁移 SQL 拆成可逐条执行的语句。
 *
 * 🔴 三类语句内部都有分号，不能按 `;` 盲切，否则会切出「incomplete input」：
 *   1. PG 的 `$$ ... $$` 函数体 / `DO $$ ... $$` 块
 *   2. SQLite 的 `CREATE TRIGGER ... BEGIN ... END;` 触发器体
 *   3. 字符串字面量里的分号（如 `'{"a":1;2}'`）
 *
 * 逐行状态机：
 * - `inDollarQuote`：进出 `$$` 引用（PG）
 * - `inTriggerBody`：进入 `CREATE TRIGGER ... BEGIN` 之后，直到独立的 `END;` 行
 * - 引号状态：跟踪 `'`（含 `''` 转义），引号内不切分
 */
export function splitSqlStatements(sql: string): string[] {
  const statements: string[] = [];
  let buf = '';
  let inDollarQuote = false;
  let inTriggerBody = false;
  let inQuote = false;

  for (const line of sql.split('\n')) {
    const trimmed = line.trim();
    // 仅在语句外跳过注释行（语句内的 `--` 是注释但不能丢后续内容）
    if (!inDollarQuote && !inTriggerBody && !inQuote && (trimmed === '' || trimmed.startsWith('--'))) {
      continue;
    }
    buf += `${line}\n`;

    // 引号状态机（先算，因为它影响 $$ 与分号判定）
    for (let i = 0; i < line.length; i++) {
      const ch = line[i];
      if (ch === "'") {
        if (inQuote && line[i + 1] === "'") {
          i++; // 转义的双引号
          continue;
        }
        inQuote = !inQuote;
      }
    }

    if (!inQuote) {
      if (trimmed.includes('$$')) inDollarQuote = !inDollarQuote;
    }

    if (!inDollarQuote && !inTriggerBody) {
      // 检测触发器体起点：CREATE TRIGGER ... BEGIN
      if (/^\s*CREATE\s+TRIGGER\b/i.test(buf) && /\bBEGIN\s*$/i.test(trimmed)) {
        inTriggerBody = true;
        continue;
      }
      if (trimmed.endsWith(';')) {
        statements.push(buf.trim());
        buf = '';
      }
      continue;
    }

    if (inTriggerBody && /^END\s*;\s*$/i.test(trimmed)) {
      inTriggerBody = false;
      statements.push(buf.trim());
      buf = '';
    }
  }

  const tail = buf.trim();
  if (tail !== '') statements.push(tail);
  return statements;
}


/** 执行 PG 迁移 */
async function migratePostgres(
  config: ReturnType<typeof loadDbConfig>,
  dir: string,
): Promise<MigrationResult> {
  const { default: pg } = await import('pg');
  const pool = new pg.Pool({ connectionString: config.url, max: 1 });
  const started = Date.now();
  const applied: string[] = [];
  const skipped: string[] = [];
  try {
    const client = await pool.connect();
    try {
      await client.query(
        `CREATE TABLE IF NOT EXISTS forge_migrations (
           version varchar(32) PRIMARY KEY,
           name varchar(128) NOT NULL,
           hash varchar(64) NOT NULL,
           dialect varchar(16) NOT NULL DEFAULT 'postgres',
           execution_ms integer,
           applied_at timestamptz NOT NULL DEFAULT now()
         )`,
      );
      const existing = await readApplied((q) => client.query(q).then((r) => r.rows));
      for (const f of listMigrationFiles(dir)) {
        const known = existing.get(f.version);
        if (known !== undefined) {
          if (known !== f.hash) {
            throw new Error(
              `迁移 ${f.version}_${f.name}.sql 内容已被修改（hash ${known} → ${f.hash}）。` +
                `历史迁移不可变更，请新增一个版本号。`,
            );
          }
          skipped.push(`${f.version}_${f.name}`);
          continue;
        }
        const t0 = Date.now();
        await client.query('BEGIN');
        try {
          for (const stmt of splitSqlStatements(f.sql)) {
            await client.query(stmt);
          }
          await client.query(
            `INSERT INTO forge_migrations (version, name, hash, dialect, execution_ms)
             VALUES ($1,$2,$3,'postgres',$4)`,
            [f.version, f.name, f.hash, Date.now() - t0],
          );
          await client.query('COMMIT');
        } catch (err) {
          await client.query('ROLLBACK');
          throw new Error(
            `迁移 ${f.version}_${f.name}.sql 执行失败：${(err as Error).message}`,
          );
        }
        applied.push(`${f.version}_${f.name}`);
      }
    } finally {
      client.release();
    }
  } finally {
    await pool.end();
  }
  return { dialect: 'postgres', applied, skipped, executionMs: Date.now() - started };
}

/** 执行 SQLite 迁移 */
async function migrateSqlite(
  config: ReturnType<typeof loadDbConfig>,
  dir: string,
): Promise<MigrationResult> {
  const { default: Database } = await import('better-sqlite3');
  const { resolveSqlitePath } = await import('../client-sqlite.js');
  const { mkdirSync } = await import('node:fs');
  const { dirname } = await import('node:path');

  const filename = resolveSqlitePath(config.url);
  mkdirSync(dirname(filename), { recursive: true });
  const raw = new Database(filename);
  const started = Date.now();
  const applied: string[] = [];
  const skipped: string[] = [];
  try {
    raw.pragma('foreign_keys = ON');
    assertFts5Available(raw);
    raw.exec(
      `CREATE TABLE IF NOT EXISTS forge_migrations (
         version TEXT PRIMARY KEY,
         name TEXT NOT NULL,
         hash TEXT NOT NULL,
         dialect TEXT NOT NULL DEFAULT 'sqlite',
         execution_ms INTEGER,
         applied_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
       )`,
    );
    const existing = new Map(
      (raw.prepare('SELECT version, hash FROM forge_migrations').all() as Array<{
        version: string;
        hash: string;
      }>).map((r) => [r.version, r.hash]),
    );
    for (const f of listMigrationFiles(dir)) {
      const known = existing.get(f.version);
      if (known !== undefined) {
        if (known !== f.hash) {
          throw new Error(
            `迁移 ${f.version}_${f.name}.sql 内容已被修改（hash ${known} → ${f.hash}）。` +
              `历史迁移不可变更，请新增一个版本号。`,
          );
        }
        skipped.push(`${f.version}_${f.name}`);
        continue;
      }
      const t0 = Date.now();
      raw.transaction(() => {
        for (const stmt of splitSqlStatements(f.sql)) {
          raw.exec(stmt);
        }
        raw
          .prepare(
            `INSERT INTO forge_migrations (version, name, hash, dialect, execution_ms)
             VALUES (?,?,?,'sqlite',?)`,
          )
          .run(f.version, f.name, f.hash, Date.now() - t0);
      })();
      applied.push(`${f.version}_${f.name}`);
    }
  } finally {
    if (raw.open) raw.close();
  }
  return { dialect: 'sqlite', applied, skipped, executionMs: Date.now() - started };
}

/** CLI 入口 */
export async function main(argv: readonly string[]): Promise<void> {
  const dialectArg = argv.find((a) => a.startsWith('--dialect='));
  const env = { ...process.env };
  if (dialectArg !== undefined) {
    env.DB_DIALECT = dialectArg.slice('--dialect='.length);
  }
  const config = loadDbConfig(env);
  const dialect = env.DB_DIALECT === undefined ? dialectFromUrl(config.url) : config.dialect;
  const dir = join(process.cwd(), MIGRATION_DIRS[dialect]);
  const result =
    dialect === 'sqlite'
      ? await migrateSqlite(config, dir)
      : await migratePostgres(config, dir);
  console.log(
    `[db] 方言=${result.dialect} 新应用=${result.applied.length} 跳过=${result.skipped.length} 耗时=${result.executionMs}ms`,
  );
  for (const name of result.applied) console.log(`  + ${name}`);
}

// 直接执行本文件时运行（被 import 时不自动执行）
if (process.argv[1] !== undefined && isMainModule(import.meta.url)) {
  main(process.argv.slice(2)).catch((err: unknown) => {
    console.error('[db] 迁移失败：', (err as Error).message);
    process.exitCode = 1;
  });
}

