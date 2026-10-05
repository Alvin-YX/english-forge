/**
 * @eng-forge/contracts —— OpenAPI 3.1 契约与共享类型
 *
 * 全仓类型单一来源。apps/* 与 packages/* 均从此导入，
 * 🔴 禁止跨 app 复制类型（见 .dependency-cruiser.js 规则 web-no-api-internal）。
 */

// ── 枚举 ─────────────────────────────────────────────────
export * from './enums/index.js';

// ── 领域类型 ─────────────────────────────────────────────
export * from './types/domain.js';

// ── API 契约 ─────────────────────────────────────────────
export * from './api/response.js';
export * from './api/speech.js';
export * from './api/ai.js';
