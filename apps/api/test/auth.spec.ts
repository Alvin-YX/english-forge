import type { Server } from 'node:http';

import { type ApiResponse, ErrorCode } from '@eng-forge/contracts/api';
import { Role } from '@eng-forge/contracts/enums';
import { NestFactory, type NestApplication } from '@nestjs/core';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { AppModule } from '../src/app.module.js';
import { parseEnv } from '../src/infra/config/env.js';

import { createTestDb, setupTestEnv } from './helpers/test-env.js';

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

describe('POST /auth/register', () => {
  it('注册成功返回双 token', async () => {
    const { status, body } = await post('/auth/register', {
      username: 'student_test',
      password: 'password123',
      displayName: 'Student Test',
      role: Role.STUDENT,
    });
    expect(status).toBe(201);
    expect(body.code).toBe(ErrorCode.OK);
    const data = body.data as { accessToken: string; refreshToken: string; tokenType: string; expiresIn: number };
    expect(data.accessToken).toBeTruthy();
    expect(data.refreshToken).toBeTruthy();
    expect(data.tokenType).toBe('Bearer');
    expect(data.expiresIn).toBeGreaterThan(0);
  });

  it('用户名重复 → 409 USERNAME_TAKEN', async () => {
    await post('/auth/register', {
      username: 'dup_test',
      password: 'password123',
      displayName: 'Dup User',
    });
    const { status, body } = await post('/auth/register', {
      username: 'dup_test',
      password: 'password123',
      displayName: 'Dup User 2',
    });
    expect(status).toBe(409);
    expect(body.code).toBe(ErrorCode.USERNAME_TAKEN);
  });
});

describe('POST /auth/login', () => {
  it('登录成功返回 token', async () => {
    await post('/auth/register', {
      username: 'login_test',
      password: 'password123',
      displayName: 'Login User',
    });
    const { status, body } = await post('/auth/login', {
      username: 'login_test',
      password: 'password123',
    });
    expect(status).toBe(200);
    expect(body.code).toBe(ErrorCode.OK);
  });

  it('密码错误 → 401 CREDENTIALS_INVALID', async () => {
    await post('/auth/register', {
      username: 'wrongpw_test',
      password: 'correctpassword',
      displayName: 'Wrong Pw',
    });
    const { status, body } = await post('/auth/login', {
      username: 'wrongpw_test',
      password: 'wrongpassword',
    });
    expect(status).toBe(401);
    expect(body.code).toBe(ErrorCode.CREDENTIALS_INVALID);
  });

  it('用户不存在 → 401 CREDENTIALS_INVALID（不泄露信息）', async () => {
    const { status, body } = await post('/auth/login', {
      username: 'nonexistent_user_xyz',
      password: 'anypassword',
    });
    expect(status).toBe(401);
    expect(body.code).toBe(ErrorCode.CREDENTIALS_INVALID);
  });
});
