/**
 * schema 统一出口 —— 业务层只从 `@eng-forge/db/schema` 导入。
 *
 * 🔴 依赖方向（防循环依赖，`.dependency-cruiser.js` 零容忍）：
 *   user.ts      → （无内部依赖）
 *   taxonomy.ts  → user.ts
 *   content.ts   → taxonomy.ts
 *   learning.ts  → content.ts, taxonomy.ts, user.ts
 *   speech.ts    → content.ts, learning.ts, user.ts
 *   errorbook.ts → content.ts, learning.ts, speech.ts, user.ts
 *   gamification.ts / conversation.ts / system.ts → user.ts（+ 少量同域引用）
 *   本文件仅重导出，**不引入新的横向依赖**。
 */

// ── 用户域 ─────────────────────────────────────────────────
export * from './user.js';

// ── 学段 / 教材 ────────────────────────────────────────────
export * from './taxonomy.js';

// ── 词条 / 例句 ────────────────────────────────────────────
export * from './content.js';

// ── 学习 / FSRS / 统计 ─────────────────────────────────────
export * from './learning.js';

// ── 录音 / 评分 ────────────────────────────────────────────
export * from './speech.js';

// ── 错题本 ─────────────────────────────────────────────────
export * from './errorbook.js';

// ── 游戏化 ─────────────────────────────────────────────────
export * from './gamification.js';

// ── AI 对话 ────────────────────────────────────────────────
export * from './conversation.js';

// ── 班级 / 系统 ────────────────────────────────────────────
export * from './system.js';
