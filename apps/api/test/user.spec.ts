import type { Server } from 'node:http';

import { type ApiResponse, ErrorCode } from '@eng-forge/contracts/api';
import { Role } from '@eng-forge/contracts/enums';
import { NestFactory, type NestApplication } from '@nestjs/core';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { AppModule } from '../src/app.module.js';
import { parseEnv } from '../src/infra/config/env.js';

import { sign } from './helpers/jwt.js';
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

async function get(path: string, token?: string): Promise<{ status: number; body: ApiResponse<unknown> }> {
  const res = await fetch(`${baseUrl}${path}`, {
    headers: token === undefined ? {} : { authorization: `Bearer ${token}` },
  });
  return { status: res.status, body: (await res.json()) as ApiResponse<unknown> };
}

async function patch(
  path: string,
  body: unknown,
  token?: string,
): Promise<{ status: number; body: ApiResponse<unknown> }> {
  const headers: Record<string, string> = { 'content-type': 'application/json' };
  if (token !== undefined) headers.authorization = `Bearer ${token}`;
  const res = await fetch(`${baseUrl}${path}`, {
    method: 'PATCH',
    headers,
    body: JSON.stringify(body),
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

async function registerAndGetToken(username: string, password: string, displayName: string, role?: Role) {
  const { status, body } = await post('/auth/register', { username, password, displayName, role });
  expect(status).toBe(201);
  const data = body.data as { accessToken: string; refreshToken: string };
  return data.accessToken;
}

describe('GET /me', () => {
  it('有效 token → 200 + 用户档案', async () => {
    const token = await registerAndGetToken('me_test', 'password123', 'Me User', Role.STUDENT);
    const { status, body } = await get('/me', token);
    expect(status).toBe(200);
    expect(body.code).toBe(ErrorCode.OK);
    const data = body.data as { userId: number; username: string; displayName: string; role: string };
    expect(data.username).toBe('me_test');
    expect(data.displayName).toBe('Me User');
    expect(data.role).toBe(Role.STUDENT);
  });
});

describe('PATCH /me/profile', () => {
  it('更新档案 → 200', async () => {
    const token = await registerAndGetToken('profile_test', 'password123', 'Profile User', Role.STUDENT);
    const { status, body } = await patch('/me/profile', { displayName: 'Updated Name', speechRate: '1.25' }, token);
    expect(status).toBe(200);
    expect(body.code).toBe(ErrorCode.OK);
  });
});

describe('GET /me/children', () => {
  it('非家长角色 → 403', async () => {
    const token = await registerAndGetToken('student_no_children', 'password123', 'Student', Role.STUDENT);
    const { status, body } = await get('/me/children', token);
    expect(status).toBe(403);
    expect(body.code).toBe(ErrorCode.RBAC_DENIED);
  });
});

describe('POST /me/children/bind', () => {
  it('家长绑定孩子 → 200', async () => {
    const childToken = await registerAndGetToken('child_to_bind', 'password123', 'Child', Role.STUDENT);
    const { body: childBody } = await get('/me', childToken);
    const childData = childBody.data as { userId: number };
    const childId = childData.userId;

    const parentToken = await registerAndGetToken('parent_binder', 'password123', 'Parent', Role.PARENT);
    const { status, body } = await post(
      '/me/children/bind',
      { childId, relation: 'father' },
      parentToken,
    );
    expect(status).toBe(200);
    expect(body.code).toBe(ErrorCode.OK);
  });
});
