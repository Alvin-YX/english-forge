/**
 * JWT 注入令牌与选项工厂 —— **刻意单独成文件**。
 *
 * 🔴 为什么不能把这两个令牌定义在 `auth-infra.module.ts`：
 *    `JwtAuthGuard` 需要 `@Inject(JWT_ACCESS)` 拿到 access 用的 JwtService，
 *    而 `AuthInfraModule` 又把 `JwtAuthGuard` 列进 `providers` ——
 *    令牌若与模块同文件，就形成 `auth-infra.module → jwt-auth.guard → auth-infra.module`
 *    的**环形依赖**（`import/no-cycle` 零容忍，见 CONTRIBUTING.md §4 规则 1）。
 *
 *    同样的问题也出现在 config 侧（`ENV_CONFIG` 与 `ConfigModule`），
 *    解决方式一致：令牌/token 一律放进无依赖的常量文件。
 */

import { type JwtModuleOptions } from '@nestjs/jwt';

/** access token 的 JwtService（15 分钟） */
export const JWT_ACCESS = 'JWT_ACCESS';
/** refresh token 的 JwtService（30 天，独立密钥） */
export const JWT_REFRESH = 'JWT_REFRESH';

/**
 * access 与 refresh **必须**用不同密钥。
 * 两套 options 的差异只在 `secret` 与 `expiresIn`，issuer 相同。
 */
export const buildJwtOptions = (secret: string, issuer: string, expiresInSec: number): JwtModuleOptions => ({
  secret,
  signOptions: { issuer, expiresIn: expiresInSec },
  verifyOptions: { issuer },
});
