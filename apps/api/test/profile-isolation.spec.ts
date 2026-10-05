import type { Server } from 'node:http';

import { type ApiResponse, ErrorCode } from '@eng-forge/contracts/api';
import { Role } from '@eng-forge/contracts/enums';
import { NestFactory, type NestApplication } from '@nestjs/core';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { AppModule } from '../src/app.module.js';
import { parseEnv } from '../src/infra/config/env.js';

import { sign } from './helpers/jwt.js';
import { createTestDb, setupTestEnv } from './helpers/test-env.js';

/**
 * 🔴 REQ-011 跨档案隔离核心测试
 *
 * 本测试文件的每一个断言都必须通过**真实 HTTP 请求**验证。
 * 仅断言 `expect(A.profileId).not.toBe(B.profileId)` 而不发请求 = 假绿。
 *
 * 攻击模型：攻击者持有合法签名的 JWT，但篡改 profileId 字段指向他人的档案。
 * ProfileGuard 必须验证 `user_profile.user_id === jwt.sub`，否则数据越权。
 */

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

async function get(path: string, token?: string): Promise<{ status: number; body: ApiResponse<unknown> }> {
  const res = await fetch(`${baseUrl}${path}`, {
    headers: token === undefined ? {} : { authorization: `Bearer ${token}` },
  });
  return { status: res.status, body: (await res.json()) as ApiResponse<unknown> };
}

async function post(
  path: string,
  body: unknown,
  token?: string,
): Promise<{ status: number; body: ApiResponse<unknown> }> {
  const headers: Record<string, string> = { 'content-type': 'application/json' };
  if (token !== undefined) headers.authorization = `Bearer ${token}`;
  const res = await fetch(`${baseUrl}${path}`, {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
  });
  return { status: res.status, body: (await res.json()) as ApiResponse<unknown> };
}

describe('REQ-011 跨档案隔离（核心安全测试）', () => {
  let userAId: number;
  let userAProfileId: number;
  let userBId: number;
  let userBProfileId: number;
  let adminId: number;
  let adminProfileId: number;
  let validAToken: string;

  beforeAll(async () => {
    // Register User A (student)
    const resA = await post('/auth/register', {
      username: 'isolation_user_a',
      password: 'password123',
      displayName: 'User A',
      role: Role.STUDENT,
    });
    const bodyA = resA.body as { data: { accessToken: string; refreshToken: string } };
    validAToken = bodyA.data.accessToken;

    // Get User A's profile info
    const meA = await get('/me', validAToken);
    const dataA = meA.body.data as { userId: number };
    userAId = dataA.userId;
    userAProfileId = dataA.userId;

    // Register User B (student)
    const resB = await post('/auth/register', {
      username: 'isolation_user_b',
      password: 'password123',
      displayName: 'User B',
      role: Role.STUDENT,
    });
    const bodyB = resB.body as { data: { accessToken: string; refreshToken: string } };
    const validBToken = bodyB.data.accessToken;
    const meB = await get('/me', validBToken);
    const dataB = meB.body.data as { userId: number };
    userBId = dataB.userId;
    userBProfileId = dataB.userId;

    // Register Admin
    const resAdmin = await post('/auth/register', {
      username: 'isolation_admin',
      password: 'password123',
      displayName: 'Admin',
      role: Role.ADMIN,
    });
    const bodyAdmin = resAdmin.body as { data: { accessToken: string; refreshToken: string } };
    const validAdminToken = bodyAdmin.data.accessToken;
    const meAdmin = await get('/me', validAdminToken);
    const dataAdmin = meAdmin.body.data as { userId: number };
    adminId = dataAdmin.userId;
    adminProfileId = dataAdmin.userId;

    // Verify profiles are distinct
    expect(userAProfileId).not.toBe(userBProfileId);
  });

  it('#1: 有效 token → GET /me → 200', async () => {
    const { status, body } = await get('/me', validAToken);
    expect(status).toBe(200);
    expect(body.code).toBe(ErrorCode.OK);
  });

  it('#2 (CORE): A 的 token 携带 B 的 profileId → GET /me → 403 PROFILE_FORBIDDEN', async () => {
    // 🔴 这是整个测试文件最核心的断言
    // 攻击者持有合法签名的 JWT，但把 profileId 改成别人的
    const forgedToken = sign({
      sub: userAId,        // 自己的账号 id
      profileId: userBProfileId,  // 别人的档案 id ← 篡改
      role: Role.STUDENT,
    });

    const { status, body } = await get('/me', forgedToken);

    // 🔴 必须返回 403 + PROFILE_FORBIDDEN
    expect(status).toBe(403);
    expect(body.code).toBe(ErrorCode.PROFILE_FORBIDDEN);
    expect(body.data).toBeNull();
  });

  it('#3: A 的 token 携带不存在的 profileId → 403 PROFILE_FORBIDDEN', async () => {
    const forgedToken = sign({
      sub: userAId,
      profileId: 99999,  // 不存在的档案
      role: Role.STUDENT,
    });

    const { status, body } = await get('/me', forgedToken);
    expect(status).toBe(403);
    expect(body.code).toBe(ErrorCode.PROFILE_FORBIDDEN);
  });

  it('#4: Admin token 携带他人 profileId → 403（RBAC 不覆盖档案隔离）', async () => {
    // 🔴 Admin 角色也不能越权访问他人的档案数据
    const resAdmin = await post('/auth/register', {
      username: 'isolation_admin2',
      password: 'password123',
      displayName: 'Admin 2',
      role: Role.ADMIN,
    });
    const bodyAdmin = resAdmin.body as { data: { accessToken: string } };
    const adminToken = bodyAdmin.data.accessToken;

    // Forge admin token with user B's profileId
    const forgedAdminToken = sign({
      sub: adminId,
      profileId: userBProfileId,  // B 的档案
      role: Role.ADMIN,
    });

    const { status, body } = await get('/me', forgedAdminToken);
    expect(status).toBe(403);
    expect(body.code).toBe(ErrorCode.PROFILE_FORBIDDEN);
  });

  it('#5: @Public() 路由 → 200 无需 token', async () => {
    const { status, body } = await get('/system/healthz');
    expect(status).toBe(200);
    expect(body.code).toBe(ErrorCode.OK);
  });
});
