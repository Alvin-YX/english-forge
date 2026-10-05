/**
 * `ENV_CONFIG` 注入令牌 —— **刻意单独成文件**。
 *
 * 🔴 为什么不能把令牌定义在 `config.module.ts`：
 *    `ConfigModule` 要注册 `AppConfigStore` / `AppSecretStore`（配置表读写），
 *    而这两个 store 依赖 `DbConnection`（`db.module.ts`），
 *    `DbModule` 又要注入 `ENV_CONFIG` ——
 *    令牌若与模块同文件，就形成 `config.module → store → db.module → config.module`
 *    的**环形依赖**（`import/no-cycle` 零容忍，见 CONTRIBUTING.md §4 规则 1）。
 *
 *    把令牌抽成无依赖的常量文件后，依赖变成纯单向：
 *    `config.module → app-config.store → db.module → tokens`
 *
 * 这也意味着：任何文件都可以安全 import 本文件取令牌，不会引入额外依赖。
 */

export const ENV_CONFIG = 'ENV_CONFIG';
