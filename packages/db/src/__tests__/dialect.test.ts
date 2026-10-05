/**
 * 方言解析回归测试 —— 🔴 锁住一个真实缺陷。
 *
 * 缺陷背景（2026-10-05 独立验收时发现）：
 *   `resolveDialect(undefined)` 一律返回 'postgres'，不看 `DATABASE_URL`。
 *   于是 `DATABASE_URL=file:./data/forge.db pnpm seed` 会拿 pg 驱动去连
 *   SQLite 文件 → AggregateError [ECONNREFUSED]，
 *   而错误信息只有一句 connection refused，排查方向被完全带偏
 *   （第一反应会是"是不是 PG 服务没起"，实际是方言判错）。
 *
 * 本测试确保这类调用方式永远不会再退化成 PG 档。
 */

import { describe, expect, it } from 'vitest';

import { loadDbConfig } from '../client.js';
import { DEFAULT_DIALECT, isDialect, isSqlite, resolveDialect } from '../dialect.js';

describe('resolveDialect', () => {
  it('显式 DB_DIALECT 优先于 URL', () => {
    expect(resolveDialect('sqlite', 'postgres://u:p@h/db')).toBe('sqlite');
    expect(resolveDialect('postgres', 'file:./data/forge.db')).toBe('postgres');
  });

  it('🔴 DB_DIALECT 缺省时按 URL 前缀判档（缺陷回归）', () => {
    // file: 前缀必须是 SQLite 档，否则 pg 驱动会 ECONNREFUSED
    expect(resolveDialect(undefined, 'file:./data/forge.db')).toBe('sqlite');
    expect(resolveDialect('', 'file:./data/forge.db')).toBe('sqlite');
    expect(resolveDialect(undefined, 'sqlite:///tmp/x.db')).toBe('sqlite');
    // 大写 FILE: 也要认
    expect(resolveDialect(undefined, 'FILE:./x.db')).toBe('sqlite');
  });

  it('postgres:// 走 PG 档', () => {
    expect(resolveDialect(undefined, 'postgres://user:pw@localhost:5432/forge')).toBe('postgres');
    expect(resolveDialect(undefined, 'postgresql://u:p@h/db')).toBe('postgres');
  });

  it('两者都给不了线索时回落到默认档', () => {
    expect(resolveDialect(undefined, undefined)).toBe(DEFAULT_DIALECT);
    expect(resolveDialect(undefined)).toBe(DEFAULT_DIALECT);
  });

  it('非法 DB_DIALECT 抛错（禁止静默降级）', () => {
    expect(() => resolveDialect('mysql', 'file:./x.db')).toThrow(/DB_DIALECT 非法值/);
  });
});

describe('loadDbConfig', () => {
  it('🔴 缺 DATABASE_URL 直接抛错，不静默兜底', () => {
    expect(() => loadDbConfig({})).toThrow(/缺少 DATABASE_URL/);
    expect(() => loadDbConfig({ DATABASE_URL: '' })).toThrow(/缺少 DATABASE_URL/);
  });

  it('file: URL 自动判为 sqlite 档（缺陷回归）', () => {
    const cfg = loadDbConfig({ DATABASE_URL: 'file:./data/forge.db' });
    expect(cfg.dialect).toBe('sqlite');
    expect(isSqlite(cfg.dialect)).toBe(true);
  });

  it('postgres URL 判为 postgres 档', () => {
    const cfg = loadDbConfig({ DATABASE_URL: 'postgres://u:p@localhost:5432/forge' });
    expect(cfg.dialect).toBe('postgres');
  });

  it('DB_DIALECT 可覆盖 URL 推断', () => {
    const cfg = loadDbConfig({
      DATABASE_URL: 'file:./data/forge.db',
      DB_DIALECT: 'postgres',
    });
    expect(cfg.dialect).toBe('postgres');
  });

  it('池上限可用 DB_POOL_MAX 覆盖', () => {
    const cfg = loadDbConfig({ DATABASE_URL: 'postgres://u:p@h/d', DB_POOL_MAX: '5' });
    expect(cfg.maxConnections).toBe(5);
  });
});

describe('方言判定工具', () => {
  it('isDialect 正确识别', () => {
    expect(isDialect('postgres')).toBe(true);
    expect(isDialect('sqlite')).toBe(true);
    expect(isDialect('mysql')).toBe(false);
  });

  it('isSqlite 只对 sqlite 为真', () => {
    expect(isSqlite('sqlite')).toBe(true);
    expect(isSqlite('postgres')).toBe(false);
  });
});
