/**
 * 认证业务服务 —— register / login / refresh 三端点。
 *
 * 🔴 分层：本文件只做业务逻辑（校验、哈希、查库、签发 JWT），
 *    HTTP 层由 `auth.controller.ts` 负责。
 *
 * 🔴 密码：argon2id，参数从 env 读（m/t/p），不硬编码。
 * 🔴 JWT：access + refresh 双 token，独立密钥（`JWT_ACCESS` / `JWT_REFRESH`）。
 * 🔴 登录失败不泄露具体原因（用户名不存在 vs 密码错误返回同一错误码）。
 */

import { randomUUID } from 'node:crypto';

import { ErrorCode } from '@eng-forge/contracts/api';
import { Role } from '@eng-forge/contracts/enums';
import { user, userProfile, type UserRow } from '@eng-forge/db/schema';
import { Inject, Injectable, Logger } from '@nestjs/common';
import { type JwtService } from '@nestjs/jwt';
import { z } from 'zod';

import { BusinessError } from '../../common/errors.business.js';
import type { Env } from '../../infra/config/env.js';
import { ENV_CONFIG } from '../../infra/config/tokens.js';
import { DbConnection } from '../../infra/db/db.module.js';
import { eq, sql } from '../../infra/db/query.js';
import { JWT_ACCESS, JWT_REFRESH } from '../../infra/profile/jwt-tokens.js';
import type { JwtProfilePayload } from '../../infra/profile/profile-scope.js';

// ═══════════════════════════════════════════════════════════
// Zod schemas（导出供 controller 的 @Body 校验使用）
// ═══════════════════════════════════════════════════════════

export const REGISTER_SCHEMA = z.object({
  username: z.string().min(3).max(64),
  password: z.string().min(8).max(128),
  displayName: z.string().min(1).max(64),
  role: z.nativeEnum(Role).optional(),
  email: z.string().email().optional(),
  phone: z.string().max(32).optional(),
});

export const LOGIN_SCHEMA = z.object({
  username: z.string().min(1).max(64),
  password: z.string().min(1).max(128),
});

export const REFRESH_SCHEMA = z.object({
  refreshToken: z.string().min(1).max(4096),
});

// ═══════════════════════════════════════════════════════════
// 类型
// ═══════════════════════════════════════════════════════════

export interface RegisterInput {
  username: string;
  password: string;
  displayName: string;
  role?: Role;
  email?: string;
  phone?: string;
}

export interface LoginInput {
  username: string;
  password: string;
}

export interface AuthTokens {
  accessToken: string;
  refreshToken: string;
  tokenType: 'Bearer';
  expiresIn: number;
}

// ═══════════════════════════════════════════════════════════
// 服务实现
// ═══════════════════════════════════════════════════════════

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);

  constructor(
    @Inject(DbConnection) private readonly conn: DbConnection,
    @Inject(ENV_CONFIG) private readonly env: Env,
    @Inject(JWT_ACCESS) private readonly jwtAccess: JwtService,
    @Inject(JWT_REFRESH) private readonly jwtRefresh: JwtService,
  ) {}

  // ── 注册 ─────────────────────────────────────────────────

  async register(input: RegisterInput): Promise<AuthTokens> {
    // 1. 校验用户名唯一性（大小写不敏感，双方言用 LOWER()）
    const existing = await this.conn.db
      .select({ id: user.id })
      .from(user)
      .where(sql`LOWER(${user.username}) = LOWER(${input.username})`)
      .limit(1);

    if (existing.length > 0) {
      throw new BusinessError(ErrorCode.USERNAME_TAKEN, '用户名已被注册', 409);
    }

    // 2. 哈希密码
    const passwordHash = await this.hashPassword(input.password);

    // 3. 插入 user 表，取回自增 id
    const role = input.role ?? Role.STUDENT;
    const inserted = await this.conn.db
      .insert(user)
      .values({
        username: input.username,
        passwordHash,
        role,
        displayName: input.displayName,
        email: input.email ?? null,
        phone: input.phone ?? null,
        status: 'active',
      })
      .returning({ id: user.id });

    const userId = inserted[0]?.id;
    if (userId === undefined) {
      throw new Error('insert user failed: no id returned');
    }

    // 4. 插入 user_profile（1:1 扩展表）
    await this.conn.db.insert(userProfile).values({
      userId,
      locale: 'zh-CN',
      accent: 'us',
      speechRate: '1.00',
      perfTier: 'auto',
      asrModel: 'base',
      dailyGoalMin: 15,
      reportFrequency: 'weekly',
      calibrationDone: false as unknown as boolean,
    });

    // 5. 签发双 token
    const userRow = (await this.conn.db
      .select()
      .from(user)
      .where(eq(user.id, userId))
      .limit(1))[0] as UserRow;

    return this.issueTokens(userRow);
  }

  // ── 登录 ─────────────────────────────────────────────────

  async login(input: LoginInput): Promise<AuthTokens> {
    // 1. 按用户名查询（大小写不敏感）
    const rows = await this.conn.db
      .select()
      .from(user)
      .where(sql`LOWER(${user.username}) = LOWER(${input.username})`)
      .limit(1);

    const row = rows[0];

    // 2. 用户名不存在或密码错误 → 统一返回 CREDENTIALS_INVALID
    //    不泄露具体原因（防用户枚举攻击）
    if (row === undefined) {
      throw new BusinessError(ErrorCode.CREDENTIALS_INVALID, '用户名或密码错误', 401);
    }

    const passwordValid = await this.verifyPassword(row.passwordHash, input.password);
    if (!passwordValid) {
      throw new BusinessError(ErrorCode.CREDENTIALS_INVALID, '用户名或密码错误', 401);
    }

    // 3. 检查账号状态
    if (row.status !== 'active') {
      throw new BusinessError(ErrorCode.ACCOUNT_DISABLED, '账号已被禁用，请联系管理员', 403);
    }

    // 4. 更新 lastLoginAt
    await this.conn.db
      .update(user)
      .set({ lastLoginAt: new Date(), updatedAt: new Date() })
      .where(eq(user.id, row.id));

    // 5. 签发双 token
    return this.issueTokens(row as UserRow);
  }

  // ── 刷新 ─────────────────────────────────────────────────

  async refresh(refreshToken: string): Promise<AuthTokens> {
    // 1. 验证 refresh token
    let payload: JwtProfilePayload;
    try {
      payload = await this.jwtRefresh.verifyAsync(refreshToken, {
        issuer: this.env.JWT_ISSUER,
      }) as unknown as JwtProfilePayload;
    } catch {
      throw new BusinessError(ErrorCode.CREDENTIALS_INVALID, '登录凭证无效，请重新登录', 401);
    }

    // 2. 查库确认用户存在且未禁用
    const rows = await this.conn.db
      .select()
      .from(user)
      .where(eq(user.id, payload.sub))
      .limit(1);

    const row = rows[0];
    if (row === undefined) {
      throw new BusinessError(ErrorCode.CREDENTIALS_INVALID, '用户不存在', 401);
    }
    if (row.status !== 'active') {
      throw new BusinessError(ErrorCode.ACCOUNT_DISABLED, '账号已被禁用', 403);
    }

    // 3. 用库里最新的 role 签发新 token 对（角色可能被管理员修改）
    return this.issueTokens(row as UserRow);
  }

  // ── 内部方法 ─────────────────────────────────────────────

  /**
   * 签发 access + refresh 双 token。
   *
   * 🔴 选项名必须是 `jwtid` 而不是 `jti`：`jsonwebtoken` v9 的 `SignOptions`
   *    只认 `jwtid`（`options_to_payload` 映射表把 `jwtid` → payload 的 `jti` claim）。
   *    传 `jti` 会被 schema 校验直接抛 `"jti" is not allowed in "options"`，
   *    登录接口 500。写出的 claim 名仍是标准 `jti`（RFC 7519 §4.1.7），下游读法不变。
   *
   * 🔴 access / refresh 各给一个独立 jti：二者共享同一个 jti 会让未来的
   *    token 撤销表无法区分「撤销哪个」，一条access 被拉黑会连带 refresh 一起失效。
   */
  private async issueTokens(user: UserRow): Promise<AuthTokens> {
    const payload: JwtProfilePayload = {
      sub: user.id,
      profileId: user.id,
      role: user.role,
    };

    const [accessToken, refreshToken] = await Promise.all([
      this.jwtAccess.signAsync(payload, { jwtid: randomUUID() }),
      this.jwtRefresh.signAsync(payload, { jwtid: randomUUID() }),
    ]);

    return {
      accessToken,
      refreshToken,
      tokenType: 'Bearer',
      expiresIn: this.env.JWT_ACCESS_TTL_SEC,
    };
  }

  /** argon2id 哈希，参数从 env 读取 */
  private async hashPassword(plain: string): Promise<string> {
    const argon2 = (await import('argon2')).default;
    return argon2.hash(plain, {
      type: argon2.argon2id,
      memoryCost: this.env.ARGON2_MEMORY_KB,
      timeCost: this.env.ARGON2_TIME_COST,
      parallelism: this.env.ARGON2_PARALLELISM,
    });
  }

  /** 验证密码 */
  private async verifyPassword(hash: string, plain: string): Promise<boolean> {
    const argon2 = (await import('argon2')).default;
    try {
      return await argon2.verify(hash, plain);
    } catch {
      return false;
    }
  }
}
