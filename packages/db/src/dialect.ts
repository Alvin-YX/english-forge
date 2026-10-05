/**
 * 方言适配层 —— 03 文档 §8.1 硬性要求
 *
 * 🔴 硬性约束（03 文档 §4.4）：方言差异**只允许**收敛在 3 个文件里：
 *   1. `dialect.ts`   —— 本文件，列类型 / 主键 / 全文检索 / 能力开关
 *   2. `types.ts`     —— 双方言共享的 TS 类型导出
 *   3. `migrations/`  —— 两套手写 SQL（`migrations/` PG + `migrations-sqlite/`）
 *
 * 任何业务 schema 文件（`schema/*.ts`）**不得**出现 `if (dialect === 'sqlite')` 分支，
 * 需要差异时一律从本文件取能力开关或类型构造器。
 *
 * 为什么用 Drizzle 而非 Prisma：见 CONTRIBUTING.md 偏离登记 D-08
 * —— NAS 离线环境需要**手写可审计 SQL 迁移**（§4.4 阶段 B 明确要求人工 review）。
 */

import { customType } from 'drizzle-orm/pg-core';

// ═══════════════════════════════════════════════════════════
// 方言标识
// ═══════════════════════════════════════════════════════════

/**
 * 支持的数据库方言。
 * - `postgres`：完整档（PG 16，FTS + GIN + 物化视图 + SKIP LOCKED）
 * - `sqlite`：降级档（better-sqlite3，FTS5 + 普通表 + BEGIN IMMEDIATE）
 */
export const DIALECTS = ['postgres', 'sqlite'] as const;
export type Dialect = (typeof DIALECTS)[number];

export const DEFAULT_DIALECT: Dialect = 'postgres';

export function isDialect(value: string): value is Dialect {
  return (DIALECTS as readonly string[]).includes(value);
}

/**
 * 把 `DB_DIALECT` 环境变量解析为方言，非法值直接抛错（禁止静默降级）。
 *
 * 🔴 缺省时**不能**直接返回 DEFAULT_DIALECT：
 *    `DB_DIALECT` 未设但 `DATABASE_URL=file:./data/forge.db` 是很常见的调用方式
 *    （开发机、CI、测试都这么写）。若这里无视 URL 前缀一律判成 postgres，
 *    调用方就会拿 pg 驱动去连 SQLite 文件 → ECONNREFUSED，
 *    而错误信息通常只有一句 connection refused，排查方向完全被带偏。
 *    因此：无显式 DB_DIALECT 时，以 URL 前缀作为判据。
 */
export function resolveDialect(raw: string | undefined, url?: string): Dialect {
  if (raw !== undefined && raw !== '') {
    if (!isDialect(raw)) {
      throw new Error(
        `DB_DIALECT 非法值 "${raw}"，仅支持 ${DIALECTS.join(' | ')}（03 文档 §8.1）`,
      );
    }
    return raw;
  }
  // 兜底：按 URL 前缀判定。file: / sqlite: 开头即 SQLite 档。
  if (url !== undefined && /^(file|sqlite):/i.test(url)) {
    return 'sqlite';
  }
  return DEFAULT_DIALECT;
}

/** 零外网默认档位：单变量判断入口，调用方禁止自行拼方言字符串 */
export function isSqlite(dialect: Dialect): boolean {
  return dialect === 'sqlite';
}

// ═══════════════════════════════════════════════════════════
// 主键生成策略（03 文档 §4 约定）
// ═══════════════════════════════════════════════════════════

/**
 * 主键 DDL 片段。
 * - PG：`BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY`
 * - SQLite：`INTEGER PRIMARY KEY AUTOINCREMENT`
 *
 * ⚠️ 应用层统一把 id 当 `number` 处理；**跨服务传递用 string**（64 位精度），
 *    见 `types.ts` 的 `Id` 品牌类型。
 */
export const PK_DDL: Record<Dialect, string> = {
  postgres: 'BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY',
  sqlite: 'INTEGER PRIMARY KEY AUTOINCREMENT',
};

/** 从 `DATABASE_URL` 推断方言（未显式给 `DB_DIALECT` 时的兜底） */
export function dialectFromUrl(url: string): Dialect {
  if (url.startsWith('postgres://') || url.startsWith('postgresql://')) return 'postgres';
  if (url.startsWith('file:') || url.endsWith('.db') || url.endsWith('.sqlite')) return 'sqlite';
  throw new Error(
    `无法从 DATABASE_URL 推断方言："${url.slice(0, 32)}"。请显式设置 DB_DIALECT（03 文档 §8.1）`,
  );
}

// ═══════════════════════════════════════════════════════════
// 逻辑列类型 → 双方言映射（03 文档 §4.4 类型映射表）
// ═══════════════════════════════════════════════════════════

/**
 * 逻辑类型的 SQL 片段映射。
 *
 * 🔴 只覆盖 03 文档 §4.4 表格里列出的逻辑类型；新增逻辑类型必须先在此登记。
 * `schema/*.ts` 不直接写 SQL 片段，只引用本表的键名做文档对齐与迁移生成核对。
 */
export const LOGICAL_TYPES = [
  'serial',
  'timestamptz',
  'date',
  'varchar',
  'text',
  'int',
  'smallint',
  'bigint',
  'numeric',
  'doublePrecision',
  'real',
  'boolean',
  'char',
  'bytea',
  'json',
  'textArray',
  'realArray',
  'tsvector',
] as const;
export type LogicalType = (typeof LOGICAL_TYPES)[number];

/** 逻辑类型 → 双方言 DDL 片段（供迁移审计与测试交叉校验） */
export const TYPE_MAPPING: Record<LogicalType, Record<Dialect, string>> = {
  serial: { postgres: 'BIGINT GENERATED ALWAYS AS IDENTITY', sqlite: 'INTEGER' },
  timestamptz: { postgres: 'TIMESTAMPTZ', sqlite: 'TEXT' },
  date: { postgres: 'DATE', sqlite: 'TEXT' },
  varchar: { postgres: 'VARCHAR(n)', sqlite: 'TEXT' },
  text: { postgres: 'TEXT', sqlite: 'TEXT' },
  int: { postgres: 'INTEGER', sqlite: 'INTEGER' },
  smallint: { postgres: 'SMALLINT', sqlite: 'INTEGER' },
  bigint: { postgres: 'BIGINT', sqlite: 'INTEGER' },
  numeric: { postgres: 'NUMERIC(p,s)', sqlite: 'REAL' },
  doublePrecision: { postgres: 'DOUBLE PRECISION', sqlite: 'REAL' },
  real: { postgres: 'REAL', sqlite: 'REAL' },
  boolean: { postgres: 'BOOLEAN', sqlite: 'INTEGER' },
  char: { postgres: 'CHAR(n)', sqlite: 'TEXT' },
  bytea: { postgres: 'BYTEA', sqlite: 'BLOB' },
  json: { postgres: 'JSON', sqlite: 'TEXT' },
  // exam_tags：PG 数组 vs SQLite JSON 数组字符串（§4.4 走 jsonStringArray() helper）
  textArray: { postgres: "VARCHAR(64)[] DEFAULT '{}'", sqlite: "TEXT DEFAULT '[]'" },
  // embedding：PG real[] vs SQLite BLOB（Float32Array）
  realArray: { postgres: 'REAL[]', sqlite: 'BLOB' },
  tsvector: { postgres: 'TSVECTOR', sqlite: 'TEXT' },
};

/** 取逻辑类型在指定方言下的 DDL 片段 */
export function ddlType(logical: LogicalType, dialect: Dialect): string {
  return TYPE_MAPPING[logical][dialect];
}

// ═══════════════════════════════════════════════════════════
// 能力开关（业务层用这些代替方言分支）
// ═══════════════════════════════════════════════════════════

/**
 * 方言能力矩阵。
 * 业务代码只读本对象，**禁止**自己写 `dialect === 'sqlite'`。
 */
export interface DialectCapabilities {
  /** 原生全文检索：PG 为 tsvector+GIN，SQLite 为 FTS5 虚拟表 */
  readonly fullTextSearch: boolean;
  /** `SELECT ... FOR UPDATE SKIP LOCKED`（SQLite 用 `BEGIN IMMEDIATE` 队列替代） */
  readonly skipLocked: boolean;
  /** 物化视图 + `REFRESH ... CONCURRENTLY`（SQLite 降级为普通表 + 每日 UPSERT） */
  readonly materializedView: boolean;
  /** `LISTEN/NOTIFY`（SQLite 不支持 → 1s 轮询，SSE 标为 best-effort） */
  readonly listenNotify: boolean;
  /** `pg_trgm` 相似度（SQLite 由应用层 rapidfuzz 替代） */
  readonly trigramSimilarity: boolean;
  /** JSONB GIN 索引（SQLite 无 → 聚合预计算到表） */
  readonly jsonbIndex: boolean;
  /** 部分索引 `WHERE`（双方言均支持） */
  readonly partialIndex: boolean;
  /** 数组列原生类型 */
  readonly nativeArray: boolean;
  /** 事务级队列（`pg-boss` / 自研 `sqlite-queue`） */
  readonly queueImplementation: 'pg-boss' | 'sqlite-queue';
}

export const CAPABILITIES: Record<Dialect, DialectCapabilities> = {
  postgres: {
    fullTextSearch: true,
    skipLocked: true,
    materializedView: true,
    listenNotify: true,
    trigramSimilarity: true,
    jsonbIndex: true,
    partialIndex: true,
    nativeArray: true,
    queueImplementation: 'pg-boss',
  },
  sqlite: {
    // FTS5 虚拟表（§4.4：word_fts / sentence_fts）
    fullTextSearch: true,
    // ⚠️ better-sqlite3 无行级锁；队列靠 `BEGIN IMMEDIATE` + `LIMIT n` 语义对齐（§4.4）
    skipLocked: false,
    materializedView: false,
    listenNotify: false,
    trigramSimilarity: false,
    jsonbIndex: false,
    partialIndex: true,
    nativeArray: false,
    queueImplementation: 'sqlite-queue',
  },
};

/** 工厂函数而非直接读常量，便于测试注入替身 */
export function capabilitiesOf(dialect: Dialect): DialectCapabilities {
  return CAPABILITIES[dialect];
}

// ═══════════════════════════════════════════════════════════
// 能力查询
// ═══════════════════════════════════════════════════════════

/** 是否支持 `FOR UPDATE SKIP LOCKED`（worker 抢占任务前必须判断） */
export function supportsSkipLocked(dialect: Dialect): boolean {
  return CAPABILITIES[dialect].skipLocked;
}

/** 是否支持物化视图（`word_weakness` 的两种实现分叉点） */
export function supportsMaterializedView(dialect: Dialect): boolean {
  return CAPABILITIES[dialect].materializedView;
}

/**
 * worker 抢占任务的两种 SQL 形态（03 文档 §4.4「队列」行）。
 * 调用方只传表名与批次大小，不自己拼方言。
 */
export function buildJobClaimSql(
  dialect: Dialect,
  params: { table: string; batchSize: number },
): string {
  const { table, batchSize } = params;
  if (!Number.isInteger(batchSize) || batchSize < 1) {
    throw new Error(`buildJobClaimSql: batchSize 必须为正整数，收到 ${batchSize}`);
  }
  if (supportsSkipLocked(dialect)) {
    return (
      `UPDATE ${table} SET status = 'running', started_at = now() ` +
      `WHERE id IN (SELECT id FROM ${table} WHERE status = 'pending' ` +
      `ORDER BY created_at LIMIT ${batchSize} FOR UPDATE SKIP LOCKED) ` +
      `RETURNING id`
    );
  }
  // SQLite：无行级锁，用 `BEGIN IMMEDIATE` 事务包裹 + 单条 UPDATE ... WHERE id IN (...)
  return (
    `-- sqlite: 需包裹在 BEGIN IMMEDIATE 事务内\n` +
    `UPDATE ${table} SET status = 'running', started_at = CURRENT_TIMESTAMP ` +
    `WHERE id IN (SELECT id FROM ${table} WHERE status = 'pending' ` +
    `ORDER BY created_at LIMIT ${batchSize}) RETURNING id`
  );
}

// ═══════════════════════════════════════════════════════════
// 全文检索（§4.3 查询路径对照表）
// ═══════════════════════════════════════════════════════════

/**
 * 词条/句子搜索的 SQL 片段。
 * - PG：`search_tsv @@ plainto_tsquery('simple', ?)` + GIN 索引 `idx_word_search_gin`
 * - SQLite：FTS5 虚拟表 `word_fts MATCH ?`
 *
 * ⚠️ `simple` 配置（不用 `english`）：词条含大量专有名词与缩写，
 *    stemming 会把不相关词形合并，03 文档 §4.3 已明确指定 `simple`。
 */
export function buildFullTextSql(
  dialect: Dialect,
  params: { ftsTable: string; tsvectorColumn: string },
): string {
  const { ftsTable, tsvectorColumn } = params;
  if (dialect === 'postgres') {
    return `${tsvectorColumn} @@ plainto_tsquery('simple', $1)`;
  }
  return `${ftsTable} MATCH ?`;
}

/** SQLite FTS5 虚拟表建表语句（PG 侧对应 GIN 索引，迁移脚本各自维护） */
export const FTS5_CREATE = {
  word: `CREATE VIRTUAL TABLE IF NOT EXISTS word_fts USING fts5(
  headword, translation_zh, definition_en,
  content='word', content_rowid='id',
  tokenize="porter unicode61 remove_diacritics 2"
)`,
  sentence: `CREATE VIRTUAL TABLE IF NOT EXISTS sentence_fts USING fts5(
  text, translation_zh,
  content='sentence', content_rowid='id',
  tokenize="porter unicode61 remove_diacritics 2"
)`,
} as const;

/** FTS 索引重建（迁移后必须调用，§4.4 阶段 A 第 5 步） */
export function buildFtsRebuildSql(dialect: Dialect, ftsTable: 'word' | 'sentence'): string {
  const name = `${ftsTable}_fts`;
  if (dialect === 'postgres') return `-- PG: GIN 索引随表创建，无需 rebuild（${name}）`;
  return `INSERT INTO ${name}(${name}) VALUES('rebuild')`;
}

// ═══════════════════════════════════════════════════════════
// JSON 列 helper（§4.4「统一 JsonCol 抽象」）
// ═══════════════════════════════════════════════════════════

/**
 * JSON 列的写入/读取 helper。
 * 🔴 §4.4 硬性要求：**写入前一律 stringify，读取时 parse**。
 * 双方言都存文本形态，PG 侧由 `JSON` 列类型承接。
 */
export const jsonStringify = (value: unknown): string => JSON.stringify(value ?? null);

export function jsonParse<T>(raw: string | null | undefined, fallback: T): T {
  if (raw === null || raw === undefined || raw === '') return fallback;
  try {
    return JSON.parse(raw) as T;
  } catch {
    // 损坏的 JSON 不应让整个列表接口 500，降级为 fallback
    return fallback;
  }
}

/** `text[]` 列的读写（`exam_tags` 专用，§4.4 类型映射表第 3 行） */
export function jsonStringArray(value: readonly string[] | null | undefined): string {
  return JSON.stringify(value ?? []);
}

export function parseJsonStringArray(raw: string | null | undefined): string[] {
  const parsed = jsonParse<unknown>(raw, []);
  return Array.isArray(parsed) ? parsed.filter((v): v is string => typeof v === 'string') : [];
}

// ═══════════════════════════════════════════════════════════
// 方言专属列类型（Drizzle 0.38 未内置的少数几个）
// ═══════════════════════════════════════════════════════════

/**
 * `BYTEA` 列（PG）/ `BLOB`（SQLite）。
 *
 * Drizzle 0.38 的 `pg-core` 未导出 `bytea()` 构造器（只有 text/json/uuid/inet 等），
 * 故按 §4.4「统一列类型抽象」的要求在本文件自定义，业务侧只 import 本符号。
 *
 * 应用层统一用 `Uint8Array`：pg 驱动返回 `Buffer`（Buffer 是 Uint8Array 子类），
 * better-sqlite3 返回 `Buffer`，两边都兼容，无需分支。
 */
export const byteaColumn = customType<{ data: Uint8Array; driverData: Buffer }>({
  dataType() {
    return 'bytea';
  },
});

// ═══════════════════════════════════════════════════════════
// 时间戳
// ═══════════════════════════════════════════════════════════

/**
 * 当前时间戳的方言原生字面量。
 * - PG：`now()`（timestamptz）
 * - SQLite：ISO8601 UTC 字符串
 *
 * ⚠️ SQLite 的 `CURRENT_TIMESTAMP` 产出 `2026-10-05 05:29:28`（空格分隔、无时区），
 *    **不符合 §4.4 要求的 ISO8601**，也不能被 `new Date()` 稳定解析成 UTC。
 *    故 SQLite 侧统一用 `strftime('%Y-%m-%dT%H:%M:%fZ','now')`。
 *    迁移 SQL 里的列默认值与此保持一致（见 migrations-sqlite/0000_init.sql）。
 */
export const NOW_SQL: Record<Dialect, string> = {
  postgres: 'now()',
  sqlite: "strftime('%Y-%m-%dT%H:%M:%fZ','now')",
};

/** `date` 列的默认值（YYYY-MM-DD） */
export const CURRENT_DATE_SQL: Record<Dialect, string> = {
  postgres: 'CURRENT_DATE',
  sqlite: "strftime('%Y-%m-%d','now')",
};

/**
 * Drizzle 的 `.defaultNow()` 会生成**字面量 `now()`**（PG 专有函数）。
 *
 * 🔴 better-sqlite3 默认没有 `now()` 函数 → 任何带 `defaultNow()` 的表
 *    在 SQLite 档 insert 时都会报 `no such function: now`。
 *    解决：`client-sqlite.ts` 注册同名 UDF 返回 ISO8601 字符串。
 *    这样**同一份 Drizzle schema 无需任何方言分支**即可在双方言工作，
 *    正是 §8.1「差异收敛到 3 个文件」想要的收益。
 */
export const SQLITE_NOW_UDF_NAME = 'now';


/**
 * 幂等键过期时长（03 文档 §5：服务端按 key 去重 24h）。
 * 同时用于 `idempotency_key.expire_at` 的计算与迁移脚本。
 */
export const IDEMPOTENCY_TTL_HOURS = 24;
export const IDEMPOTENCY_TTL_MS = IDEMPOTENCY_TTL_HOURS * 60 * 60 * 1000;
