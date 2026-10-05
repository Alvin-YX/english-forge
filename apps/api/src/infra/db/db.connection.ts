/**
 * 数据库连接管理 —— 双方言（SQLite/PostgreSQL）
 *
 * 封装 Drizzle ORM 连接，支持运行时方言切换。
 */

import { eq, sql } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import { schema } from '@eng-forge/db';
import { type SchemaError } from '@eng-forge/db';
import type { Env } from '../config/env.js';

/** Drizzle DB 实例类型（PG） */
export type PgDb = ReturnType<typeof drizzle<typeof schema>>;

/** SQLite Drizzle DB 实例类型 */
export type SqliteDb = import('drizzle-orm/better-sqlite3').BetterSQLite3Database<typeof schema>;

/** 统一 DB 类型 */
export type AnyDb = PgDb | SqliteDb;

export class DbConnection {
  #db: AnyDb;
  #dialect: 'sqlite' | 'postgres';
  #client: postgres.Sql | import('better-sqlite3').Database | null = null;

  constructor(env: Env) {
    if (env.DB_DIALECT === 'sqlite') {
      this.#dialect = 'sqlite';
      const Database = require('better-sqlite3') as typeof import('better-sqlite3').Database;
      const dbPath = env.DATABASE_URL.replace('sqlite://', '');
      this.#client = new Database(dbPath);
      this.#client.pragma('journal_mode = WAL');
      this.#client.pragma('synchronous = NORMAL');
      this.#client.pragma('foreign_keys = ON');

      const { drizzle: drizzleSqlite } = require('drizzle-orm/better-sqlite3') as typeof import('drizzle-orm/better-sqlite3');
      this.#db = drizzleSqlite(this.#client as import('better-sqlite3').Database, { schema }) as SqliteDb;
    } else {
      this.#dialect = 'postgres';
      this.#client = postgres(env.DATABASE_URL, { max: 10 });
      this.#db = drizzle(this.#client, { schema });
    }
  }

  get db(): AnyDb {
    return this.#db;
  }

  get dialect(): 'sqlite' | 'postgres' {
    return this.#dialect;
  }

  /** 检查数据库连通性 */
  async ping(): Promise<boolean> {
    try {
      if (this.#dialect === 'sqlite') {
        const sqliteDb = this.#db as SqliteDb;
        sqliteDb.run(sql`SELECT 1`);
      } else {
        const pgDb = this.#db as PgDb;
        await pgDb.execute(sql`SELECT 1`);
      }
      return true;
    } catch {
      return false;
    }
  }

  /** 检查 schema 是否已初始化（migrations_version 表存在且有数据） */
  async checkSchema(): Promise<boolean> {
    try {
      if (this.#dialect === 'sqlite') {
        const sqliteDb = this.#db as SqliteDb;
        const rows = sqliteDb.select({ version: schema.migrationsVersion.version }).from(schema.migrationsVersion).all();
        return rows.length > 0;
      } else {
        const pgDb = this.#db as PgDb;
        const result = await pgDb.select({ version: schema.migrationsVersion.version }).from(schema.migrationsVersion).limit(1);
        return result.length > 0;
      }
    } catch (err) {
      // 表不存在 = schema 未初始化
      return false;
    }
  }

  async close(): Promise<void> {
    if (this.#client && this.#dialect === 'postgres') {
      await (this.#client as postgres.Sql).end({ timeout: 5 });
    } else if (this.#client && this.#dialect === 'sqlite') {
      (this.#client as import('better-sqlite3').Database).close();
    }
  }
}
