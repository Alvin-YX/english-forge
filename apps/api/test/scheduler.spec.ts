import type { Server } from 'node:http';

import { type ApiResponse, ErrorCode } from '@eng-forge/contracts/api';
import { NestFactory, type NestApplication } from '@nestjs/core';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { AppModule } from '../src/app.module.js';
import { parseEnv } from '../src/infra/config/env.js';
import { DbConnection } from '../src/infra/db/db.module.js';

import { at } from './helpers/assert.js';
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

/**
 * 🔴 `body` 声明为可选：通知的「标记已读」类端点本就没有请求体，
 *    函数体内部也已按 `body === undefined` 分支处理（不发 content-type、不带 body）。
 *    之前写成必填参数，导致 `patch('/scheduler/notices/1/read')` 这类
 *    语义完全正确的调用编译不过（TS2554）。
 */
async function patch(
  path: string,
  body?: unknown,
  token?: string,
): Promise<{ status: number; body: ApiResponse<unknown> }> {
  const headers: Record<string, string> = {};
  if (body !== undefined) headers['content-type'] = 'application/json';
  if (token !== undefined) headers.authorization = `Bearer ${token}`;
  const res = await fetch(`${baseUrl}${path}`, {
    method: 'PATCH',
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { status: res.status, body: (await res.json()) as ApiResponse<unknown> };
}

async function registerAndGetToken(username: string, password: string, displayName: string): Promise<string> {
  const { status, body } = await post('/auth/register', {
    username,
    password,
    displayName,
    role: 'student',
  });
  expect(status).toBe(201);
  const data = body.data as { accessToken: string };
  return data.accessToken;
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

async function getUserId(token: string): Promise<number> {
  const { body } = await get('/me', token);
  const data = body.data as { userId: number };
  return data.userId;
}

// ═══════════════════════════════════════════════════════════
// Auth checks
// ═══════════════════════════════════════════════════════════

describe('Scheduler Module - 鉴权检查（无 token → 401）', () => {
  it('GET /scheduler/jobs 无 token → 401', async () => {
    const { status, body } = await get('/scheduler/jobs');
    expect(status).toBe(401);
    expect(body.code).toBe(ErrorCode.UNAUTHENTICATED);
  });

  it('GET /scheduler/notices 无 token → 401', async () => {
    const { status, body } = await get('/scheduler/notices');
    expect(status).toBe(401);
    expect(body.code).toBe(ErrorCode.UNAUTHENTICATED);
  });

  it('PATCH /scheduler/notices/1/read 无 token → 401', async () => {
    const { status, body } = await patch('/scheduler/notices/1/read');
    expect(status).toBe(401);
    expect(body.code).toBe(ErrorCode.UNAUTHENTICATED);
  });

  it('PATCH /scheduler/notices/read-all 无 token → 401', async () => {
    const { status, body } = await patch('/scheduler/notices/read-all');
    expect(status).toBe(401);
    expect(body.code).toBe(ErrorCode.UNAUTHENTICATED);
  });
});

// ═══════════════════════════════════════════════════════════
// Jobs (system-level, no profile filter)
// ═══════════════════════════════════════════════════════════

describe('Scheduler Module - 作业审计', () => {
  let token: string;

  beforeAll(async () => {
    token = await registerAndGetToken('sched_jobs_user', 'password123', 'Sched Jobs User');
  });

  it('GET /scheduler/jobs 新用户 → 200 空列表', async () => {
    const { status, body } = await get('/scheduler/jobs', token);
    expect(status).toBe(200);
    expect(body.code).toBe(ErrorCode.OK);
    const data = body.data as { items: unknown[]; total: number; page: number; pageSize: number; totalPages: number };
    expect(data.items.length).toBe(0);
    expect(data.total).toBe(0);
    expect(data.page).toBe(1);
    expect(data.pageSize).toBe(20);
    expect(data.totalPages).toBe(1);
  });

  it('GET /scheduler/jobs?page=1&pageSize=5 → 分页', async () => {
    const { status, body } = await get('/scheduler/jobs?page=1&pageSize=5', token);
    expect(status).toBe(200);
    const data = body.data as { items: unknown[]; pageSize: number };
    expect(data.items.length).toBe(0);
    expect(data.pageSize).toBe(5);
  });
});

// ═══════════════════════════════════════════════════════════
// Notices (profile-scoped)
// ═══════════════════════════════════════════════════════════

describe('Scheduler Module - 系统通知', () => {
  let token: string;

  beforeAll(async () => {
    token = await registerAndGetToken('sched_notices_user', 'password123', 'Sched Notices User');
  });

  it('GET /scheduler/notices 新用户 → 200 空列表', async () => {
    const { status, body } = await get('/scheduler/notices', token);
    expect(status).toBe(200);
    expect(body.code).toBe(ErrorCode.OK);
    const data = body.data as { items: unknown[]; total: number; page: number; pageSize: number };
    expect(data.items.length).toBe(0);
    expect(data.total).toBe(0);
    expect(data.page).toBe(1);
    expect(data.pageSize).toBe(20);
  });

  it('GET /scheduler/notices?page=1&pageSize=5 → 分页', async () => {
    const { status, body } = await get('/scheduler/notices?page=1&pageSize=5', token);
    expect(status).toBe(200);
    const data = body.data as { items: unknown[]; pageSize: number };
    expect(data.items.length).toBe(0);
    expect(data.pageSize).toBe(5);
  });
});

// ═══════════════════════════════════════════════════════════
// Notices with seeded data
// ═══════════════════════════════════════════════════════════

describe('Scheduler Module - 系统通知（含数据）', () => {
  let token: string;
  let userId: number;
  let noticeIds: number[] = [];

  beforeAll(async () => {
    token = await registerAndGetToken('sched_seeded_user', 'password123', 'Sched Seeded User');
    userId = await getUserId(token);
    const raw = (app.get(DbConnection).client as unknown as { raw: { exec: (sql: string) => unknown } }).raw;
    raw.exec(`
      INSERT INTO system_notice (user_id, category, level, title, body, created_at)
      VALUES (${userId}, 'report', 'info', '周报已生成', '本周报告已就绪', '2025-10-06T00:00:00Z');
      INSERT INTO system_notice (user_id, category, level, title, body, created_at)
      VALUES (${userId}, 'review', 'warning', '复习提醒', '今日有待复习内容', '2025-10-07T00:00:00Z');
      INSERT INTO system_notice (user_id, category, level, title, body, created_at)
      VALUES (${userId}, 'system', 'info', '系统公告', '系统将于今晚维护', '2025-10-08T00:00:00Z');
    `);
    const result = await get('/scheduler/notices', token);
    const data = result.body.data as { items: { id: number }[] };
    noticeIds = data.items.map((item) => item.id);
  });

  it('GET /scheduler/notices → 200 显示通知列表', async () => {
    const { status, body } = await get('/scheduler/notices', token);
    expect(status).toBe(200);
    const data = body.data as { items: { id: number; title: string; category: string; level: string }[]; total: number };
    expect(data.total).toBe(3);
    expect(data.items.length).toBe(3);
  });

  it('GET /scheduler/notices 通知结构完整', async () => {
    const { body } = await get('/scheduler/notices', token);
    const data = body.data as { items: Record<string, unknown>[] };
    const notice = data.items[0];
    expect(notice).toBeDefined();
    expect(notice).toHaveProperty('id');
    expect(notice).toHaveProperty('category');
    expect(notice).toHaveProperty('level');
    expect(notice).toHaveProperty('title');
    expect(notice).toHaveProperty('createdAt');
    expect(notice).toHaveProperty('readAt');
  });

  it('GET /scheduler/notices?category=report → 按分类过滤', async () => {
    const { status, body } = await get('/scheduler/notices?category=report', token);
    expect(status).toBe(200);
    const data = body.data as { items: { category: string }[]; total: number };
    expect(data.total).toBe(1);
    data.items.forEach((item) => expect(item.category).toBe('report'));
  });

  it('GET /scheduler/notices?level=warning → 按级别过滤', async () => {
    const { status, body } = await get('/scheduler/notices?level=warning', token);
    expect(status).toBe(200);
    const data = body.data as { items: { level: string }[]; total: number };
    expect(data.total).toBe(1);
    data.items.forEach((item) => expect(item.level).toBe('warning'));
  });

  it('GET /scheduler/notices?read=false → 过滤未读', async () => {
    const { status, body } = await get('/scheduler/notices?read=false', token);
    expect(status).toBe(200);
    const data = body.data as { items: { readAt: string | null }[]; total: number };
    data.items.forEach((item) => expect(item.readAt).toBeNull());
  });

  it('PATCH /scheduler/notices/:id/read → 200 标记已读', async () => {
    const noticeId = noticeIds[0];
    expect(noticeId).toBeDefined();
    const { status, body } = await patch(`/scheduler/notices/${noticeId}/read`, undefined, token);
    expect(status).toBe(200);
    expect(body.code).toBe(ErrorCode.OK);
  });

  it('GET /scheduler/notices?read=true → 过滤已读', async () => {
    const { status, body } = await get('/scheduler/notices?read=true', token);
    expect(status).toBe(200);
    const data = body.data as { items: { readAt: string | null }[]; total: number };
    expect(data.total).toBeGreaterThanOrEqual(1);
    data.items.forEach((item) => expect(item.readAt).not.toBeNull());
  });

  it('GET /scheduler/notices?page=1&pageSize=2 → 分页生效', async () => {
    const { status, body } = await get('/scheduler/notices?page=1&pageSize=2', token);
    expect(status).toBe(200);
    const data = body.data as { items: unknown[]; total: number; pageSize: number; totalPages: number };
    expect(data.items.length).toBe(2);
    expect(data.total).toBe(3);
    expect(data.pageSize).toBe(2);
    expect(data.totalPages).toBe(2);
  });

  it('PATCH /scheduler/notices/99999/read → 404 通知不存在', async () => {
    const { status, body } = await patch('/scheduler/notices/99999/read', undefined, token);
    expect(status).toBe(404);
    expect(body.code).toBe(ErrorCode.RESOURCE_NOT_FOUND);
  });

  it('PATCH /scheduler/notices/abc/read → 400 参数校验', async () => {
    const { status, body } = await patch('/scheduler/notices/abc/read', undefined, token);
    expect(status).toBe(400);
    expect(body.code).toBe(ErrorCode.VALIDATION_FAILED);
  });
});

// ═══════════════════════════════════════════════════════════
// Read All
// ═══════════════════════════════════════════════════════════

describe('Scheduler Module - 全部标记已读', () => {
  let token: string;
  let userId: number;

  beforeAll(async () => {
    token = await registerAndGetToken('sched_readall_user', 'password123', 'Sched ReadAll User');
    userId = await getUserId(token);
    const raw = (app.get(DbConnection).client as unknown as { raw: { exec: (sql: string) => unknown } }).raw;
    raw.exec(`
      INSERT INTO system_notice (user_id, category, level, title, created_at)
      VALUES (${userId}, 'system', 'info', '通知1', '2025-10-06T00:00:00Z');
      INSERT INTO system_notice (user_id, category, level, title, created_at)
      VALUES (${userId}, 'report', 'info', '通知2', '2025-10-07T00:00:00Z');
    `);
  });

  it('PATCH /scheduler/notices/read-all → 200 标记全部已读', async () => {
    const { status, body } = await patch('/scheduler/notices/read-all', undefined, token);
    expect(status).toBe(200);
    expect(body.code).toBe(ErrorCode.OK);
  });

  it('GET /scheduler/notices?read=true → 所有通知已读', async () => {
    const { status, body } = await get('/scheduler/notices?read=true', token);
    expect(status).toBe(200);
    const data = body.data as { items: unknown[]; total: number };
    expect(data.total).toBe(2);
    data.items.forEach((item) => {
      const notice = item as { readAt: string | null };
      expect(notice.readAt).not.toBeNull();
    });
  });

  it('GET /scheduler/notices?read=false → 无未读通知', async () => {
    const { status, body } = await get('/scheduler/notices?read=false', token);
    expect(status).toBe(200);
    const data = body.data as { items: unknown[]; total: number };
    expect(data.total).toBe(0);
  });
});

// ═══════════════════════════════════════════════════════════
// Cross-profile isolation
// ═══════════════════════════════════════════════════════════

describe('Scheduler Module - 跨档案隔离', () => {
  let tokenA: string;
  let tokenB: string;

  beforeAll(async () => {
    tokenA = await registerAndGetToken('sched_iso_a', 'password123', 'Sched Iso A');
    tokenB = await registerAndGetToken('sched_iso_b', 'password123', 'Sched Iso B');
    const userIdA = await getUserId(tokenA);
    const raw = (app.get(DbConnection).client as unknown as { raw: { exec: (sql: string) => unknown } }).raw;
    raw.exec(`
      INSERT INTO system_notice (user_id, category, level, title, created_at)
      VALUES (${userIdA}, 'system', 'info', 'A的通知', '2025-10-06T00:00:00Z');
    `);
  });

  it('B 不能看到 A 的通知', async () => {
    const { status, body } = await get('/scheduler/notices', tokenB);
    expect(status).toBe(200);
    const data = body.data as { items: unknown[]; total: number };
    expect(data.total).toBe(0);
  });

  it('A 的通知对 A 可见', async () => {
    const { status, body } = await get('/scheduler/notices', tokenA);
    expect(status).toBe(200);
    const data = body.data as { items: unknown[]; total: number };
    expect(data.total).toBe(1);
  });

  it('B 不能标记 A 的通知已读（404）', async () => {
    const { body: listBody } = await get('/scheduler/notices', tokenA);
    const data = listBody.data as { items: { id: number }[] };
    const noticeId = at(data.items, 0, 'scheduler/notices (tokenA)').id;
    const { status, body } = await patch(`/scheduler/notices/${noticeId}/read`, undefined, tokenB);
    expect(status).toBe(404);
    expect(body.code).toBe(ErrorCode.RESOURCE_NOT_FOUND);
  });
});
