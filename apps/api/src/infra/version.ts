/**
 * 应用版本常量（供 `GET /api/v1/system/info` 与健康检查报告使用）。
 *
 * 🔴 与 `apps/api/package.json` 的 `version` 字段保持一致（单一来源是后者）。
 *    没有走「运行时读 package.json」，原因：
 *      - `tsc` 把 `src/` 编到 `dist/`，包根的 `package.json` 不在 `dist/` 旁边，
 *        相对路径在 dev（tsx）与 prod（node dist/）下解析结果不同；
 *      - `resolveJsonModule` 引入 .json 会让 ESM 需要 `with { type: 'json' }`，
 *        在 Node 22 上是可行但脆弱的写法。
 *    代价是两处版本号可能漂移 —— **已知的维护成本**，登记在交付报告里。
 *
 * 🔶 既存缺陷（未修）：根 `package.json` 的 `check:version` 脚本指向
 *    `ops/scripts/check-version-consistency.mjs`，但 `ops/scripts/` 目录是空的，
 *    该脚本**不存在**，`pnpm run check:version` 会直接失败。
 *    恢复它之后应把本文件也纳入四处一致性校验。
 */

export const APP_NAME = 'english-forge-api';

export const APP_VERSION = '1.0.0';
