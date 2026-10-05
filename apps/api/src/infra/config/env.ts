/**
 * 环境变量 schema —— 唯一读取入口（03 文档 §9.3 敏感配置管理）
 *
 * 🔴 不用 `@nestjs/config`：03 文档 §8.5 要求「后端运行依赖 ≤ 12 个」，
 *    这里用 zod 手写解析即可（40 行），省掉一个依赖。见 ADR-0004「依赖预算」。
 *
 * 🔴 设计要点：
 * - **不设 `.strict()`**：`process.env` 天然含 PATH/HOME 等无关键，strict 会误杀。
 * - **缺必需项直接抛错**（fail-fast），不做静默兜底 —— 静默兜底会让
 *   「用了错误配置启动」变成极难排查的线上事故。
 * - 密钥类字段**只**从 env 读（`JWT_*` / `APP_SECRET_MASTER_KEY`），
 *   绝不允许写进 `app_config` 表（见 `app-secret.service.ts` 的分工说明）。
 */

import { z } from 'zod';

/** access token 有效期：15 分钟（03 文档 §5.1） */
export const ACCESS_TTL_DEFAULT_SEC = 15 * 60;

/** refresh token 有效期：30 天（03 文档 §5.1） */
export const REFRESH_TTL_DEFAULT_DAY = 30;

/** fnOS 数据卷默认媒体根目录（03 文档 §7.2 卷路径约定） */
export const MEDIA_ROOT_DEFAULT = '/vol1/1000/EnglishForge/media';

export const ENV_SCHEMA = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  // 🔴 `min(0)`：`PORT=0` 是 Node/测试的"随机端口"惯例，允许它启动后自行取一个空闲端口
  PORT: z.coerce.number().int().min(0).max(65535).default(3000),
  /** 统一路由前缀（03 文档 §5：`/api/v1`） */
  API_PREFIX: z.string().min(1).default('api/v1'),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace']).default('info'),

  // ── 数据库（03 文档 §8.1 双方言）──────────────────────────
  DATABASE_URL: z.string().min(1),
  DB_DIALECT: z.enum(['postgres', 'sqlite']).optional(),
  DB_POOL_MAX: z.coerce.number().int().min(1).max(200).default(20),

  // ── JWT ──────────────────────────────────────────────────
  /** access token 签名密钥（≥32 字符）。access/refresh 必须用**不同**密钥 */
  JWT_ACCESS_SECRET: z.string().min(32),
  JWT_REFRESH_SECRET: z.string().min(32),
  JWT_ISSUER: z.string().min(1).default('english-forge'),
  JWT_ACCESS_TTL_SEC: z.coerce.number().int().min(1).default(ACCESS_TTL_DEFAULT_SEC),
  JWT_REFRESH_TTL_DAY: z.coerce.number().int().min(1).max(365).default(REFRESH_TTL_DEFAULT_DAY),

  // ── 应用主密钥（`app_secret` 表的 AES-256-GCM 主密钥）───────
  /**
   * base64 编码的 32 字节密钥，等价于 `key_version = 1`。
   * M2 不调用云端，缺省允许启动；调用 `AppSecretStore` 时才会报错。
   */
  APP_SECRET_MASTER_KEY: z.string().min(32).optional(),
  /**
   * 多版本主密钥：JSON 对象 `{"1": "<base64>", "2": "<base64>"}`。
   * 轮换时新版本写入用新 key，存量记录按各自 `key_version` 选对应 key 解密。
   * 用 JSON 而非 `APP_SECRET_MASTER_KEY_V2` 这类散列变量，是为了让「哪些版本可用」
   * 在启动时**一次性**校验清楚，而不是逐个 key 探测。
   */
  APP_SECRET_MASTER_KEYS: z.string().optional(),

  // ── 密码哈希（03 文档 §8.6：argon2id m=64MB,t=3,p=4）──────
  ARGON2_MEMORY_KB: z.coerce.number().int().min(256).default(65536),
  ARGON2_TIME_COST: z.coerce.number().int().min(1).max(10).default(3),
  ARGON2_PARALLELISM: z.coerce.number().int().min(1).max(16).default(4),

  // ── 传输与安全头 ─────────────────────────────────────────
  CORS_ORIGINS: z.string().min(1).default('*'),
  /** 请求体上限。录音上传需较大 body（03 文档 §5.3 `POST /recordings`，音频硬门禁 64MB） */
  BODY_LIMIT: z.string().min(1).default('128mb'),

  // ── 媒体 ─────────────────────────────────────────────────
  MEDIA_ROOT: z.string().min(1).default(MEDIA_ROOT_DEFAULT),
});

export type Env = z.infer<typeof ENV_SCHEMA>;

export function parseEnv(input: NodeJS.ProcessEnv = process.env): Env {
  const parsed = ENV_SCHEMA.safeParse(input);
  if (!parsed.success) {
    const detail = parsed.error.issues
      .map((issue) => `${issue.path.map(String).join('.') || '<root>'}: ${issue.message}`)
      .join('; ');
    throw new Error(`环境变量校验失败（03 文档 §9.3）：${detail}`);
  }
  return parsed.data;
}
