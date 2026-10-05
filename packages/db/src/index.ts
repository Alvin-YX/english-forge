/**
 * `@eng-forge/db` 包入口
 *
 * 业务层推荐从本文件导入；需要细粒度时用子路径 `@eng-forge/db/schema` 等。
 */

// ── 方言与类型（§8.1：差异收敛的 3 个文件之二）──────────
export * from './dialect.js';
export * from './types.js';

// ── 连接工厂 ────────────────────────────────────────────
export * from './client.js';

// ── 全部表定义 ──────────────────────────────────────────
export * from './schema/index.js';

// ── 种子数据（供 CLI 与测试复用）────────────────────────
export * from './seed/index.js';
