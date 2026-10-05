/**
 * 骨架集成测试（Commit 1）：真实启动进程 + 真实 SQLite 库。
 *
 * 🔴 这份测试的断言重点是「响应形状」而不是「有响应」：
 *    统一 envelope（`{code,message,data}`）、错误码分段、traceId、
 *    全局守卫顺序 —— 这些都是靠形状断言才能发现的，
 *    「能连上端口」是假绿。
 *
 * 覆盖：
 *   1. `/healthz`  —— 永远 200，不查外部依赖
 *   2. `/readyz`   —— 真实 DB 往返探测
 *   3. `/system/info`
 *   4. 未认证      —— 缺 token → 401 + `UNAUTHENTICATED (1101)`
 *   5. token 过期  —— → 401 + `TOKEN_EXPIRED (1102)`（filter 里的 name 映射）
 *   6. token 无效  —— → 401 + `TOKEN_INVALID (1103)`
 *   7. 档案不存在  —— 合法签名但 `profileId` 无对应档案 → 403 + `PROFILE_FORBIDDEN (1107)`
 *   8. 未声明路由  —— → 404 + `RESOURCE_NOT_FOUND (1002)`
 */

import type { Server } from 'node:http';


import { type ApiResponse, ErrorCode } from '@eng-forge/contracts/api';
import { Role } from '@eng-forge/contracts/enums';
import { NestFactory, type NestApplication } from '@nestjs/core';
import { JwtService } from '@nestjs/jwt';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { AppModule } from '../src/app.module.js';
import { parseEnv } from '../src/infra/config/env.js';
import { buildJwtOptions } from '../src/infra/profile/jwt-tokens.js';

import { createTestDb, setupTestEnv, TEST_ACCESS_SECRET, TEST_ISSUER } from './helpers/test-env.js';

let app: NestApplication;
let baseUrl = '';
let cleanup: (() => void) | undefined;

beforeAll(async () => {
  const db = await createTestDb();
  cleanup = db.cleanup;

  Object.assign(process.env, setupTestEnv(db.path));

  app = await NestFactory.create(AppModule, { logger: false });
  const env = parseEnv(process.env);
  app.setGlobalPrefix(env.API_PREFIX);
  await app.listen(0);
  const address = (app.getHttpServer() as unknown as Server).address();
  if (address === null || typeof address === 'string') {
    throw new Error('测试服务未能绑定端口');
  }
  baseUrl = `http://127.0.0.1:${address.port}/api/v1`;
});

afterAll(async () => {
  await app?.close();
  cleanup?.();
});

const sign = (
  payload: Record<string, unknown>,
  options: { secret?: string; expiresIn?: number } = {},
): string => {
  const service = new JwtService(
    buildJwtOptions(options.secret ?? TEST_ACCESS_SECRET, TEST_ISSUER, 900),
  );
  return service.sign(payload, { expiresIn: options.expiresIn ?? 900 }) as string;
};

async function get(path: string, token?: string): Promise<{ status: number; body: ApiResponse<unknown> }> {
  const res = await fetch(`${baseUrl}${path}`, {
    headers: token === undefined ? {} : { authorization: `Bearer ${token}` },
  });
  return { status: res.status, body: (await res.json()) as ApiResponse<unknown> };
}

describe('GET /system/healthz（进程存活，不查外部依赖）', () => {
  it('返回 200 且包在统一 envelope 内', async () => {
    const { status, body } = await get('/system/healthz');
    expect(status).toBe(200);
    expect(body.code).toBe(ErrorCode.OK);
    expect(body.message).toBe('ok');

    const data = body.data as { status: string; app: string; version: string; uptimeSec: number; node: string };
    expect(data.status).toBe('ok');
    expect(data.app).toBe('english-forge-api');
    expect(data.uptimeSec).toBeGreaterThanOrEqual(0);
    expect(data.node).toMatch(/^v\d+\./);
  });

  it('匿名可访问（健康检查必须允许编排系统无凭证探测）', async () => {
    const { status } = await get('/system/healthz');
    expect(status).toBe(200);
  });
});

describe('GET /system/readyz（就绪检查，含真实 DB 往返）', () => {
  it('数据库可达时返回 200 与 ok=true', async () => {
    const { status, body } = await get('/system/readyz');
    expect(status).toBe(200);
    const data = body.data as {
      status: string;
      ok: boolean;
      dialect: string;
      checks: Array<{ name: string; ok: boolean; ms?: number }>;
    };
    expect(data.ok).toBe(true);
    expect(data.status).toBe('ok');
    expect(data.dialect).toBe('sqlite');
    expect(data.checks).toHaveLength(1);
    expect(data.checks[0]?.name).toBe('database');
    expect(data.checks[0]?.ok).toBe(true);
  });
});

describe('GET /system/info', () => {
  it('返回版本、方言与环境', async () => {
    const { status, body } = await get('/system/info');
    expect(status).toBe(200);
    const data = body.data as { app: string; version: string; env: string; dialect: string; mediaRoot: string };
    expect(data.env).toBe('test');
    expect(data.dialect).toBe('sqlite');
    expect(data.app).toBe('english-forge-api');
    expect(typeof data.version).toBe('string');
    expect(typeof data.mediaRoot).toBe('string');
  });
});

describe('认证链（全局守卫 + 异常过滤器）', () => {
  it('缺少 token → 401 + UNAUTHENTICATED(1101)，body 统一为 envelope', async () => {
    const { status, body } = await get('/system/tier');
    expect(status).toBe(401);
    expect(body.code).toBe(ErrorCode.UNAUTHENTICATED);
    expect(body.data).toBeNull();
    expect(typeof body.traceId).toBe('string');
    expect(body.traceId?.length).toBeGreaterThan(0);
  });

  it('token 过期 → 401 + TOKEN_EXPIRED(1102)（按 Error.name 映射，非 HttpException 路径）', async () => {
    const token = sign({ sub: 1, profileId: 1, role: Role.STUDENT }, { expiresIn: -10 });
    const { status, body } = await get('/system/tier', token);
    expect(status).toBe(401);
    expect(body.code).toBe(ErrorCode.TOKEN_EXPIRED);
    expect(body.data).toBeNull();
  });

  it('签名密钥错误 → 401 + TOKEN_INVALID(1103)', async () => {
    const token = sign(
      { sub: 1, profileId: 1, role: Role.STUDENT },
      { secret: 'wrong-secret-that-is-at-least-32-chars!!' },
    );
    const { status, body } = await get('/system/tier', token);
    expect(status).toBe(401);
    expect(body.code).toBe(ErrorCode.TOKEN_INVALID);
  });

  it('payload 缺少 profileId → 401（JWT 形状校验，防伪造 profileId 字段）', async () => {
    const token = sign({ sub: 1, role: Role.STUDENT });
    const { status, body } = await get('/system/tier', token);
    expect(status).toBe(401);
    expect(body.code).toBe(ErrorCode.UNAUTHENTICATED);
  });

  it('🔴 合法签名但 profileId 无对应档案 → 403 + PROFILE_FORBIDDEN(1107)', async () => {
    // 库里没有任何 user_profile 记录，profileId=99999 必然不存在。
    // 这是 REQ-011 的核心防线：即使 token 签名完全合法，
    // 档案必须能在库里找到且归属于该账号。
    const token = sign({ sub: 99999, profileId: 99999, role: Role.STUDENT });
    const { status, body } = await get('/system/tier', token);
    expect(status).toBe(403);
    expect(body.code).toBe(ErrorCode.PROFILE_FORBIDDEN);
    expect(body.data).toBeNull();
  });
});

describe('未知路由', () => {
  it('→ 404 + RESOURCE_NOT_FOUND(1002)，同样走 envelope', async () => {
    const { status, body } = await get('/definitely-not-a-route');
    expect(status).toBe(404);
    expect(body.code).toBe(ErrorCode.RESOURCE_NOT_FOUND);
    expect(body.data).toBeNull();
  });
});

describe('幂等拦截器不应影响未带 Idempotency-Key 的请求', () => {
  it('缺少 Idempotency-Key 头时请求正常穿过（幂等是可选能力，非强制）', async () => {
    // 403 由 ProfileGuard 产生 —— 能走到 ProfileGuard，
    // 说明请求已经穿过了幂等拦截器而没有被它拒绝
    const token = sign({ sub: 99999, profileId: 99999, role: Role.STUDENT });
    const { status } = await get('/system/tier', token);
    expect(status).toBe(403);
  });
});
