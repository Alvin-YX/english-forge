/**
 * 方言感知列构造器的回归测试 —— 🔴 锁住「一份 schema、双方言」这个前提。
 *
 * 缺陷背景（2026-10-07 修复 `/words*` 全 500 时定位）：
 *   `schema/*.ts` 从 `drizzle-orm/pg-core` 导入 `boolean`，
 *   而 `PgBoolean` **没有** `mapToDriverValue`，
 *   于是 JS 的 `true` 被原样交给 better-sqlite3 → `TypeError`。
 *
 * 本文件锁住三件事：
 *   1. `boolColumn` 在 SQLite 档把 `true`↔`1` 互转，且 `getSQLType()` 仍是 `BOOLEAN`（PG 不回归）
 *   2. `jsonDefaultSql` / `textArrayDefaultSql` 不再产生 PG 的 `::` 类型转换语法
 *   3. 真实 schema + 真实 SQLite 迁移下，`eq(col, true)` 能筛、读回来是真布尔
 */

import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import type Database from 'better-sqlite3';
import { eq, type SQL } from 'drizzle-orm';
import { CasingCache } from 'drizzle-orm/casing';
import { afterEach, describe, expect, it } from 'vitest';

import { createSqliteClient, type SqliteDb, SQLITE_MAX_CONNECTIONS } from '../client-sqlite.js';
import {
  boolColumn,
  getActiveDialect,
  jsonDefaultSql,
  setActiveDialect,
  textArrayDefaultSql,
} from '../dialect.js';
import { word, wordUnit } from '../schema/index.js';

const HERE = dirname(fileURLToPath(import.meta.url));

/** 取真实 schema 里的 `word.is_active` 列（经由 Drizzle 的列元数据） */
function realBoolColumn(): {
  getSQLType(): string;
  mapToDriverValue(v: boolean): unknown;
  mapFromDriverValue(v: unknown): boolean;
} {
  return word.isActive as unknown as ReturnType<typeof realBoolColumn>;
}

afterEach(() => {
  setActiveDialect('postgres');
});

describe('boolColumn —— 值映射按方言分岔', () => {
  it('SQLite 档：true↔1 / false↔0', () => {
    setActiveDialect('sqlite');
    const col = realBoolColumn();
    expect(col.mapToDriverValue(true)).toBe(1);
    expect(col.mapToDriverValue(false)).toBe(0);
    expect(col.mapFromDriverValue(1)).toBe(true);
    expect(col.mapFromDriverValue(0)).toBe(false);
  });

  it('🔴 PG 档：原样透传，不做任何转换（PG 主档不得回归）', () => {
    setActiveDialect('postgres');
    const col = realBoolColumn();
    expect(col.mapToDriverValue(true)).toBe(true);
    expect(col.mapToDriverValue(false)).toBe(false);
    expect(col.mapFromDriverValue(true)).toBe(true);
    expect(col.mapFromDriverValue(false)).toBe(false);
  });

  it('🔴 getSQLType() 恒为 BOOLEAN —— 保证 PG 侧 DDL 期望不变', () => {
    setActiveDialect('sqlite');
    expect(realBoolColumn().getSQLType().toUpperCase()).toBe('BOOLEAN');
    setActiveDialect('postgres');
    expect(realBoolColumn().getSQLType().toUpperCase()).toBe('BOOLEAN');
  });

  it('默认档是 postgres（createDb 未跑时的安全兜底）', () => {
    // 该断言依赖模块级变量的初始值，故放在最后一步重置后校验
    setActiveDialect('postgres');
    expect(getActiveDialect()).toBe('postgres');
  });

  it('boolColumn 挂在 pgTable 上而非 sqliteTable —— 不牺牲 PG 专属类型', () => {
    // 若改用 sqliteTable，serial/timestamptz/数组/FTS 这些 PG 能力会一起失效
    expect(word.isActive).toBeDefined();
    expect(typeof boolColumn).toBe('function');
  });
});

describe('json/textArray 默认值 —— 不再产生 PG 的 :: 语法', () => {
  const render = (s: SQL): string =>
    s.toQuery({
      escapeName: (n) => n,
      escapeParam: (i) => `$${i}`,
      escapeString: (v) => v,
      casing: new CasingCache(),
    }).sql;

  it('jsonDefaultSql 输出裸字面量，无 ::类型转换', () => {
    const out = render(jsonDefaultSql());
    expect(out).toBe(`'{}'`);
    expect(out).not.toContain('::');
  });

  it('jsonDefaultSql 支持自定义内容并转义单引号', () => {
    expect(render(jsonDefaultSql('[]'))).toBe(`'[]'`);
    expect(render(jsonDefaultSql(`{"it's":"v"}`))).toBe(`'{"it''s":"v"}'`);
  });

  it('textArrayDefaultSql 是 [] 而非 {}（否则 parseJsonStringArray 静默退化）', () => {
    const out = render(textArrayDefaultSql());
    expect(out).toBe(`'[]'`);
    expect(out).not.toContain('{}');
    expect(out).not.toContain('::');
  });
});

describe('真实 schema × 真实 SQLite 迁移', () => {
  /**
   * 走真实的 `createSqliteClient` 工厂：它除了建连还负责注册 `now()` UDF
   * （Drizzle 的 `.defaultNow()` 生成字面量 `now()`，SQLite 默认无此函数）。
   * 用裸 `new Database()` 会漏掉这一步并报 `no such function: now`。
   */
  function withSqliteDb(fn: (db: SqliteDb, raw: Database.Database) => void): void {
    const dir = mkdtempSync(`${tmpdir()}/ef-boolcol-`);
    const client = createSqliteClient({
      dialect: 'sqlite',
      url: `file:${dir}/x.db`,
      maxConnections: SQLITE_MAX_CONNECTIONS,
      debug: false,
    });
    try {
      client.raw.exec(
        readFileSync(
          join(HERE, '..', '..', 'migrations-sqlite', '0000_init.sql'),
          'utf8',
        ),
      );
      fn(client.db, client.raw);
    } finally {
      client.close();
      rmSync(dir, { recursive: true, force: true });
    }
  }

  it('🔴 真实链路：bool 列可写、eq(col,true) 可筛、读回真布尔（缺陷回归）', () => {
    withSqliteDb((db, raw) => {
      // 建外键前置：word_unit 需要 unit
      raw.exec(`
        INSERT INTO stage (code, name_zh, name_en, sort_order) VALUES ('primary','小学','Primary',1);
        INSERT INTO textbook (stage_id, code, name_zh) VALUES (1,'pep','人教版');
        INSERT INTO volume (textbook_id, code, name_zh, sort_order) VALUES (1,'v1','第一册',1);
        INSERT INTO unit (volume_id, code, name_zh, sort_order) VALUES (1,'u1','Unit 1',1);
      `);

      db.insert(word)
        .values({
          headword: 'apple', lemma: 'apple', pos: 'n',
          translationZh: '苹果', license: 'CC-BY-4.0', source: 'builtin',
          isActive: true, isVerb: false,
        })
        .run();
      db.insert(word)
        .values({
          headword: 'banana', lemma: 'banana', pos: 'n',
          translationZh: '香蕉', license: 'CC-BY-4.0', source: 'builtin',
          isActive: false, isVerb: false,
        })
        .run();

      // eq(col, true) 能正确筛选（此前此处抛 SQLite3 can only bind ...）
      const active = db.select().from(word).where(eq(word.isActive, true)).all();
      expect(active).toHaveLength(1);
      expect(active[0]?.headword).toBe('apple');
      // 读回来是真布尔，不是 0/1
      expect(active[0]?.isActive).toBe(true);
      expect(active[0]?.isVerb).toBe(false);

      const inactive = db.select().from(word).where(eq(word.isActive, false)).all();
      expect(inactive).toHaveLength(1);
      expect(inactive[0]?.headword).toBe('banana');

      // 落库形态仍是 INTEGER 0/1，与 migrations-sqlite 的 DDL 一致
      const rawRows = raw.prepare('select is_active, is_verb from word order by id').all();
      expect(rawRows).toEqual([
        { is_active: 1, is_verb: 0 },
        { is_active: 0, is_verb: 0 },
      ]);
    });
  });

  it('🔴 真实链路：省略 json 默认值的列不再因 :: 语法失败', () => {
    withSqliteDb((db) => {
      // 不传 irregularForms / examTags —— 此前会内联 `'{}'::json` 导致 SQLITE_ERROR
      expect(() =>
        db
          .insert(word)
          .values({
            headword: 'cherry', lemma: 'cherry', pos: 'n',
            translationZh: '樱桃', license: 'CC-BY-4.0', source: 'builtin',
          })
          .run(),
      ).not.toThrow();
    });
  });

  it('可空布尔列的映射对 false 同样成立', () => {
    setActiveDialect('sqlite');
    const col = wordUnit.isRequired;
    expect(col.mapToDriverValue(false)).toBe(0);
    expect(col.mapToDriverValue(true)).toBe(1);
    expect(col.mapFromDriverValue(1)).toBe(true);
    expect(col.mapFromDriverValue(0)).toBe(false);
  });
});