/**
 * `app_secret` 表读写 —— 03 文档 §9.3「敏感配置管理」
 *
 * 🔴 安全红线：本表**只存密文**。本文件是全仓唯一持密文读写权的地方，
 *    且**不提供**任何列出/导出明文的接口（`exists()` 只回答有无，不返回值）。
 *
 * 算法：AES-256-GCM
 *   - `iv`：12 字节随机 nonce（GCM 推荐长度），每次写入 `randomBytes` 重新生成
 *   - `auth_tag`：16 字节认证标签，与密文**分开存** —— 验证失败即拒绝解密
 *   - 密文被篡改 → `authTag` 校验失败 → `Decipher` 抛错 → 返回 null（不外泄）
 *
 * 🔴 主密钥轮换：
 *   - `APP_SECRET_MASTER_KEY` → `key_version = 1`
 *   - `APP_SECRET_MASTER_KEYS` → `{"2": "..."}` 追加更高版本
 *   - 新版本**只用于新写入**；存量记录解密时按各自的 `key_version` 取 key，
 *     因此轮换不需要停机重加密（但旧版本 key 必须留在 env 里直到存量迁完）。
 *
 * 🔴 解密调用是审计事件（03 文档 §9.2 出网审计）：M3 的 llm-adapter /
 *    tts-adapter 调用 `reveal()` 时应写 `audit_log` 的 `egress_call`。
 *    本文件自身不写审计 —— 基础设施层不依赖审计模块（见 depcruise 规则
 *    `infra-no-business-dep`），调用方负责。
 */

import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';

import { appSecret } from '@eng-forge/db/schema';
import { Inject, Injectable, Logger } from '@nestjs/common';

import { DbConnection } from '../db/db.module.js';
import { eq } from '../db/query.js';

import type { Env } from './env.js';
import { ENV_CONFIG } from './tokens.js';

const KEY_LENGTH = 32;
const IV_LENGTH = 12;
const AUTH_TAG_LENGTH = 16;
const ALGORITHM = 'aes-256-gcm';

export interface AppSecretReveal {
  plaintext: string;
  provider: string;
  keyVersion: number;
}

export interface AppSecretSetOptions {
  expiresAt?: Date;
  keyVersion?: number;
}

/** 把 env 规整为「版本 → 32 字节 key」；启动期一次性校验，缺 key 立即抛错 */
export function loadMasterKeys(env: Env): Map<number, Buffer> {
  const out = new Map<number, Buffer>();

  if (env.APP_SECRET_MASTER_KEY !== undefined) {
    out.set(1, parseMasterKey(env.APP_SECRET_MASTER_KEY, 1));
  }

  if (env.APP_SECRET_MASTER_KEYS !== undefined && env.APP_SECRET_MASTER_KEYS.trim() !== '') {
    let parsed: unknown;
    try {
      parsed = JSON.parse(env.APP_SECRET_MASTER_KEYS);
    } catch (err) {
      throw new Error(`APP_SECRET_MASTER_KEYS 不是合法 JSON：${err instanceof Error ? err.message : err}`);
    }
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
      throw new Error('APP_SECRET_MASTER_KEYS 必须是 JSON 对象，如 {"2": "<base64 32 字节>"}');
    }
    for (const [rawVersion, rawKey] of Object.entries(parsed as Record<string, unknown>)) {
      const version = Number(rawVersion);
      if (!Number.isInteger(version) || version < 1 || typeof rawKey !== 'string') {
        throw new Error(`APP_SECRET_MASTER_KEYS 项不合法：${rawVersion} = ${JSON.stringify(rawKey)}`);
      }
      out.set(version, parseMasterKey(rawKey, version));
    }
  }

  return out;
}

function parseMasterKey(raw: string, version: number): Buffer {
  const buf = Buffer.from(raw, 'base64');
  if (buf.length !== KEY_LENGTH) {
    throw new Error(
      `主密钥 v${version} 长度必须是 ${KEY_LENGTH} 字节（base64 解码后），实际 ${buf.length} 字节`,
    );
  }
  return buf;
}

@Injectable()
export class AppSecretStore {
  private readonly logger = new Logger(AppSecretStore.name);
  private readonly keys: Map<number, Buffer>;

  constructor(
    @Inject(DbConnection) private readonly conn: DbConnection,
    @Inject(ENV_CONFIG) env: Env,
  ) {
    this.keys = loadMasterKeys(env);
  }

  /**
   * 是否已配置任何版本的主密钥。
   *
   * 🔴 为什么需要这个方法：`APP_SECRET_MASTER_KEY` 未设置时 `loadMasterKeys()`
   *    返回空 Map（**不抛错**，服务能正常启动），而 `set()` 内部 `keyOf(1)`
   *    会抛裸 `Error` → 直接 500。调用方应先读本方法，给出「请先配置主密钥」
   *    这种可操作的提示，而不是让管理员看到一坨栈信息。
   *    `reveal()` / `exists()` / `remove()` 不受影响。
   */
  hasMasterKey(): boolean {
    return this.keys.size > 0;
  }

  /** 写入/覆盖一条密钥（调用方传明文，本方法内部立即加密落库） */
  async set(name: string, provider: string, plaintext: string, options: AppSecretSetOptions = {}): Promise<void> {
    const version = options.keyVersion ?? this.latestVersion();
    const key = this.keyOf(version);
    const iv = randomBytes(IV_LENGTH);

    const cipher = createCipheriv(ALGORITHM, key, iv);
    const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
    const authTag = cipher.getAuthTag();
    if (authTag.length !== AUTH_TAG_LENGTH) {
      // GCM 默认标签就是 16 字节；长度不对说明 Node 行为变了，直接失败
      throw new Error(`GCM 认证标签长度异常：期望 ${AUTH_TAG_LENGTH}，实际 ${authTag.length}`);
    }

    await this.conn.db
      .insert(appSecret)
      .values({
        name,
        provider,
        ciphertext: ciphertext.toString('base64'),
        iv: iv.toString('base64'),
        authTag: authTag.toString('base64'),
        keyVersion: version,
        expiresAt: options.expiresAt ?? null,
        lastUsedAt: null,
      })
      .onConflictDoUpdate({
        target: appSecret.name,
        set: {
          provider,
          ciphertext: ciphertext.toString('base64'),
          iv: iv.toString('base64'),
          authTag: authTag.toString('base64'),
          keyVersion: version,
          expiresAt: options.expiresAt ?? null,
          lastUsedAt: null,
          updatedAt: new Date(),
        },
      });
  }

  /**
   * 解密并返回明文。
   * 返回 `null` 的三种情形：密钥不存在 / 已过期 / 解密或认证标签校验失败。
   * 失败不抛错 —— 调用方（llm/tts 适配层）需要据此走降级链，不能因为一条
   * 脏密钥记录就让整个评分请求 500。
   */
  async reveal(name: string): Promise<AppSecretReveal | null> {
    const rows = await this.conn.db.select().from(appSecret).where(eq(appSecret.name, name)).limit(1);
    const row = rows[0];
    if (row === undefined) return null;
    if (row.expiresAt !== null && row.expiresAt.getTime() < Date.now()) {
      this.logger.warn(`[app-secret] ${name} 已过期，跳过解密`);
      return null;
    }

    const key = this.keys.get(row.keyVersion);
    if (key === undefined) {
      // 轮换后旧版本 key 从 env 移除了 —— 这是运维事故，必须显式可见
      this.logger.error(`[app-secret] ${name} 需要 key_version=${row.keyVersion}，但当前未配置该版本`);
      return null;
    }

    let plaintext: string;
    try {
      const decipher = createDecipheriv(ALGORITHM, key, Buffer.from(row.iv, 'base64'));
      decipher.setAuthTag(Buffer.from(row.authTag, 'base64'));
      plaintext = Buffer.concat([
        decipher.update(Buffer.from(row.ciphertext, 'base64')),
        decipher.final(),
      ]).toString('utf8');
    } catch {
      // authTag 校验失败 = 密文被篡改或 key 不匹配。不输出任何密文内容。
      this.logger.error(`[app-secret] ${name} 解密失败（认证标签校验未通过）`);
      return null;
    }

    // 有意的副作用：`last_used_at` 用于识别废弃密钥（见 schema 注释）。
    // 单家庭量级下一次额外写入可忽略。
    await this.conn.db
      .update(appSecret)
      .set({ lastUsedAt: new Date() })
      .where(eq(appSecret.name, name));

    return { plaintext, provider: row.provider, keyVersion: row.keyVersion };
  }

  /** 只回答「有没有」，绝不返回任何值（避免明文经日志/响应体泄漏） */
  async exists(name: string): Promise<boolean> {
    const rows = await this.conn.db.select({ name: appSecret.name }).from(appSecret).where(eq(appSecret.name, name)).limit(1);
    return rows.length > 0;
  }

  async remove(name: string): Promise<void> {
    await this.conn.db.delete(appSecret).where(eq(appSecret.name, name));
  }

  /** 新写入默认使用最高可用版本（轮换后自动用新 key） */
  private latestVersion(): number {
    let latest = 1;
    for (const v of this.keys.keys()) {
      if (v > latest) latest = v;
    }
    return latest;
  }

  private keyOf(version: number): Buffer {
    const key = this.keys.get(version);
    if (key === undefined) {
      throw new Error(`缺少 key_version=${version} 的主密钥（请检查 APP_SECRET_MASTER_KEY / APP_SECRET_MASTER_KEYS）`);
    }
    return key;
  }
}
