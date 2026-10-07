import type { Server } from 'node:http';

import { asc, eq } from 'drizzle-orm';
import { type ApiResponse, ErrorCode } from '@eng-forge/contracts/api';
import { Role } from '@eng-forge/contracts/enums';
import { errorBook, errorSample } from '@eng-forge/db/schema';
import { NestFactory, type NestApplication } from '@nestjs/core';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { AppModule } from '../src/app.module.js';
import { DbConnection } from '../src/infra/db/db.module.js';
import { parseEnv } from '../src/infra/config/env.js';

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

async function del(path: string, token?: string): Promise<{ status: number; body: ApiResponse<unknown> }> {
  const res = await fetch(`${baseUrl}${path}`, {
    method: 'DELETE',
    headers: token === undefined ? {} : { authorization: `Bearer ${token}` },
  });
  return { status: res.status, body: (await res.json()) as ApiResponse<unknown> };
}

async function registerAndGetToken(
  username: string,
  password: string,
  displayName: string,
  role: Role = Role.STUDENT,
): Promise<string> {
  const { status, body } = await post('/auth/register', { username, password, displayName, role });
  expect(status).toBe(201);
  const data = body.data as { accessToken: string; refreshToken: string };
  return data.accessToken;
}

async function getUserId(token: string): Promise<number> {
  const { body } = await get('/me', token);
  const data = body.data as { userId: number };
  return data.userId;
}

async function insertErrorBookData(userId: number): Promise<{ errorBookIds: number[]; errorSampleIds: number[] }> {
  const raw = (app.get(DbConnection).client as unknown as { raw: { exec: (sql: string) => unknown } }).raw;
  raw.exec(`
    INSERT INTO error_book (user_id, category, wrong_count) VALUES (${userId}, 'speak', 2);
    INSERT INTO error_book (user_id, category, wrong_count) VALUES (${userId}, 'spell', 1);
    INSERT INTO error_book (user_id, category, wrong_count, is_favorite) VALUES (${userId}, 'grammar', 3, 1);
    INSERT INTO error_sample (user_id, category, keep_until, priority) VALUES (${userId}, 'speak', '2026-12-31T00:00:00Z', 'normal');
    INSERT INTO error_sample (user_id, category, keep_until, priority) VALUES (${userId}, 'spell', '2026-12-31T00:00:00Z', 'high');
  `);
  // 🔴 必须回读真实自增 id，不能硬编码 [1,2,3]：
  //    同一份 SQLite 被本文件多个 describe 共用，id 会随前面用例插入的行漂移，
  //    硬编码会导致「详情/操作端点」全 404、「返回 3 条」少一条。
  const db = app.get(DbConnection).db;
  const errorBookIds = (
    await db
      .select({ id: errorBook.id })
      .from(errorBook)
      .where(eq(errorBook.userId, userId))
      .orderBy(asc(errorBook.id))
  ).map((r) => r.id);
  const errorSampleIds = (
    await db
      .select({ id: errorSample.id })
      .from(errorSample)
      .where(eq(errorSample.userId, userId))
      .orderBy(asc(errorSample.id))
  ).map((r) => r.id);

  return { errorBookIds, errorSampleIds };
}

describe('ErrorBook Module - 鉴权检查（无 token → 401）', () => {
  it('GET /errorbook 无 token → 401', async () => {
    const { status, body } = await get('/errorbook');
    expect(status).toBe(401);
    expect(body.code).toBe(ErrorCode.UNAUTHENTICATED);
  });

  it('GET /errorbook/:id 无 token → 401', async () => {
    const { status, body } = await get('/errorbook/1');
    expect(status).toBe(401);
    expect(body.code).toBe(ErrorCode.UNAUTHENTICATED);
  });

  it('POST /errorbook/:id/resolve 无 token → 401', async () => {
    const { status, body } = await post('/errorbook/1/resolve', {});
    expect(status).toBe(401);
    expect(body.code).toBe(ErrorCode.UNAUTHENTICATED);
  });

  it('POST /errorbook/:id/favorite 无 token → 401', async () => {
    const { status, body } = await post('/errorbook/1/favorite', {});
    expect(status).toBe(401);
    expect(body.code).toBe(ErrorCode.UNAUTHENTICATED);
  });

  it('DELETE /errorbook/:id 无 token → 401', async () => {
    const { status, body } = await del('/errorbook/1');
    expect(status).toBe(401);
    expect(body.code).toBe(ErrorCode.UNAUTHENTICATED);
  });

  it('GET /errorbook/samples 无 token → 401', async () => {
    const { status, body } = await get('/errorbook/samples');
    expect(status).toBe(401);
    expect(body.code).toBe(ErrorCode.UNAUTHENTICATED);
  });

  it('GET /errorbook/samples/:id 无 token → 401', async () => {
    const { status, body } = await get('/errorbook/samples/1');
    expect(status).toBe(401);
    expect(body.code).toBe(ErrorCode.UNAUTHENTICATED);
  });

  it('POST /errorbook/samples/:id/replay 无 token → 401', async () => {
    const { status, body } = await post('/errorbook/samples/1/replay', {});
    expect(status).toBe(401);
    expect(body.code).toBe(ErrorCode.UNAUTHENTICATED);
  });

  it('DELETE /errorbook/samples/:id 无 token → 401', async () => {
    const { status, body } = await del('/errorbook/samples/1');
    expect(status).toBe(401);
    expect(body.code).toBe(ErrorCode.UNAUTHENTICATED);
  });
});

describe('ErrorBook Module - 空列表', () => {
  it('GET /errorbook 新用户 → 200 空 items, total=0', async () => {
    const token = await registerAndGetToken('errorbook_empty_user', 'password123', 'ErrorBook Empty User');
    const { status, body } = await get('/errorbook', token);
    expect(status).toBe(200);
    expect(body.code).toBe(ErrorCode.OK);
    const data = body.data as { items: unknown[]; total: number; page: number; pageSize: number; totalPages: number };
    expect(data.items.length).toBe(0);
    expect(data.total).toBe(0);
    expect(data.page).toBe(1);
    expect(data.pageSize).toBe(20);
    expect(data.totalPages).toBe(1);
  });

  it('GET /errorbook/samples 新用户 → 200 空 items', async () => {
    const token = await registerAndGetToken('errorbook_samples_empty_user', 'password123', 'Samples Empty User');
    const { status, body } = await get('/errorbook/samples', token);
    expect(status).toBe(200);
    expect(body.code).toBe(ErrorCode.OK);
    const data = body.data as { items: unknown[]; total: number };
    expect(data.items.length).toBe(0);
    expect(data.total).toBe(0);
  });
});

describe('ErrorBook Module - 404 场景', () => {
  let token: string;

  beforeAll(async () => {
    token = await registerAndGetToken('errorbook_404_user', 'password123', 'ErrorBook 404 User');
  });

  it('GET /errorbook/99999 → 404 RESOURCE_NOT_FOUND', async () => {
    const { status, body } = await get('/errorbook/99999', token);
    expect(status).toBe(404);
    expect(body.code).toBe(ErrorCode.RESOURCE_NOT_FOUND);
    expect(body.data).toBeNull();
  });

  it('POST /errorbook/99999/resolve → 404 RESOURCE_NOT_FOUND', async () => {
    const { status, body } = await post('/errorbook/99999/resolve', {}, token);
    expect(status).toBe(404);
    expect(body.code).toBe(ErrorCode.RESOURCE_NOT_FOUND);
  });

  it('POST /errorbook/99999/favorite → 404 RESOURCE_NOT_FOUND', async () => {
    const { status, body } = await post('/errorbook/99999/favorite', {}, token);
    expect(status).toBe(404);
    expect(body.code).toBe(ErrorCode.RESOURCE_NOT_FOUND);
  });

  it('DELETE /errorbook/99999 → 404 RESOURCE_NOT_FOUND', async () => {
    const { status, body } = await del('/errorbook/99999', token);
    expect(status).toBe(404);
    expect(body.code).toBe(ErrorCode.RESOURCE_NOT_FOUND);
  });

  it('GET /errorbook/samples/99999 → 404 RESOURCE_NOT_FOUND', async () => {
    const { status, body } = await get('/errorbook/samples/99999', token);
    expect(status).toBe(404);
    expect(body.code).toBe(ErrorCode.RESOURCE_NOT_FOUND);
    expect(body.data).toBeNull();
  });

  it('POST /errorbook/samples/99999/replay → 404 RESOURCE_NOT_FOUND', async () => {
    const { status, body } = await post('/errorbook/samples/99999/replay', {}, token);
    expect(status).toBe(404);
    expect(body.code).toBe(ErrorCode.RESOURCE_NOT_FOUND);
  });

  it('DELETE /errorbook/samples/99999 → 404 RESOURCE_NOT_FOUND', async () => {
    const { status, body } = await del('/errorbook/samples/99999', token);
    expect(status).toBe(404);
    expect(body.code).toBe(ErrorCode.RESOURCE_NOT_FOUND);
  });
});

describe('ErrorBook Module - 参数校验', () => {
  let token: string;

  beforeAll(async () => {
    token = await registerAndGetToken('errorbook_validation_user', 'password123', 'ErrorBook Validation User');
  });

  it('GET /errorbook/abc → 400 VALIDATION_FAILED', async () => {
    const { status, body } = await get('/errorbook/abc', token);
    expect(status).toBe(400);
    expect(body.code).toBe(ErrorCode.VALIDATION_FAILED);
  });

  it('GET /errorbook/0 → 400 VALIDATION_FAILED', async () => {
    const { status, body } = await get('/errorbook/0', token);
    expect(status).toBe(400);
    expect(body.code).toBe(ErrorCode.VALIDATION_FAILED);
  });

  it('GET /errorbook/-1 → 400 VALIDATION_FAILED', async () => {
    const { status, body } = await get('/errorbook/-1', token);
    expect(status).toBe(400);
    expect(body.code).toBe(ErrorCode.VALIDATION_FAILED);
  });

  it('GET /errorbook/samples/abc → 400 VALIDATION_FAILED', async () => {
    const { status, body } = await get('/errorbook/samples/abc', token);
    expect(status).toBe(400);
    expect(body.code).toBe(ErrorCode.VALIDATION_FAILED);
  });

  it('GET /errorbook?page=0 → 400 VALIDATION_FAILED', async () => {
    const { status, body } = await get('/errorbook?page=0', token);
    expect(status).toBe(400);
    expect(body.code).toBe(ErrorCode.VALIDATION_FAILED);
  });

  it('GET /errorbook?category=invalid → 400 VALIDATION_FAILED', async () => {
    const { status, body } = await get('/errorbook?category=invalid', token);
    expect(status).toBe(400);
    expect(body.code).toBe(ErrorCode.VALIDATION_FAILED);
  });

  it('GET /errorbook?sortBy=invalid → 400 VALIDATION_FAILED', async () => {
    const { status, body } = await get('/errorbook?sortBy=invalid', token);
    expect(status).toBe(400);
    expect(body.code).toBe(ErrorCode.VALIDATION_FAILED);
  });
});

describe('ErrorBook Module - 分页与过滤', () => {
  let token: string;

  beforeAll(async () => {
    token = await registerAndGetToken('errorbook_page_user', 'password123', 'ErrorBook Page User');
    const userId = await getUserId(token);
    await insertErrorBookData(userId);
  });

  it('GET /errorbook 返回 3 条记录', async () => {
    const { status, body } = await get('/errorbook', token);
    expect(status).toBe(200);
    expect(body.code).toBe(ErrorCode.OK);
    const data = body.data as { items: unknown[]; total: number };
    expect(data.total).toBe(3);
    expect(data.items.length).toBe(3);
  });

  it('GET /errorbook?page=1&pageSize=2 → 分页生效', async () => {
    const { status, body } = await get('/errorbook?page=1&pageSize=2', token);
    expect(status).toBe(200);
    const data = body.data as { items: unknown[]; total: number; pageSize: number; totalPages: number };
    expect(data.items.length).toBe(2);
    expect(data.total).toBe(3);
    expect(data.pageSize).toBe(2);
    expect(data.totalPages).toBe(2);
  });

  it('GET /errorbook?category=speak → 按分类过滤', async () => {
    const { status, body } = await get('/errorbook?category=speak', token);
    expect(status).toBe(200);
    const data = body.data as { items: { category: string }[]; total: number };
    expect(data.total).toBe(1);
    expect(at(data.items, 0, 'errorbook?category=speak').category).toBe('speak');
  });

  it('GET /errorbook?category=spell → 按分类过滤', async () => {
    const { status, body } = await get('/errorbook?category=spell', token);
    expect(status).toBe(200);
    const data = body.data as { items: { category: string }[]; total: number };
    expect(data.total).toBe(1);
    expect(at(data.items, 0, 'errorbook?category=spell').category).toBe('spell');
  });

  it('GET /errorbook?resolved=false → 按解决状态过滤', async () => {
    const { status, body } = await get('/errorbook?resolved=false', token);
    expect(status).toBe(200);
    const data = body.data as { items: { isResolved: boolean }[]; total: number };
    expect(data.total).toBe(3);
    data.items.forEach((item) => expect(item.isResolved).toBe(false));
  });

  it('GET /errorbook?favorite=true → 按收藏过滤', async () => {
    const { status, body } = await get('/errorbook?favorite=true', token);
    expect(status).toBe(200);
    const data = body.data as { items: { isFavorite: boolean }[]; total: number };
    expect(data.total).toBe(1);
    expect(at(data.items, 0, 'errorbook?favorite=true').isFavorite).toBe(true);
  });

  it('GET /errorbook?sortBy=wrongCount → 按错误次数排序', async () => {
    const { status, body } = await get('/errorbook?sortBy=wrongCount', token);
    expect(status).toBe(200);
    const data = body.data as { items: { wrongCount: number }[] };
    const first = at(data.items, 0, 'errorbook?sortBy=wrongCount');
    const last = at(data.items, data.items.length - 1, 'errorbook?sortBy=wrongCount');
    expect(first.wrongCount).toBeGreaterThanOrEqual(last.wrongCount);
  });

  it('GET /errorbook/samples?page=1&pageSize=1 → 样本分页', async () => {
    const { status, body } = await get('/errorbook/samples?page=1&pageSize=1', token);
    expect(status).toBe(200);
    const data = body.data as { items: unknown[]; total: number; pageSize: number };
    expect(data.items.length).toBe(1);
    expect(data.total).toBe(2);
    expect(data.pageSize).toBe(1);
  });

  it('GET /errorbook/samples?category=speak → 样本按分类过滤', async () => {
    const { status, body } = await get('/errorbook/samples?category=speak', token);
    expect(status).toBe(200);
    const data = body.data as { items: { category: string }[]; total: number };
    expect(data.total).toBe(1);
    expect(at(data.items, 0, 'errorbook?category=speak').category).toBe('speak');
  });

  it('GET /errorbook/samples?category=spell → 样本按分类过滤', async () => {
    const { status, body } = await get('/errorbook/samples?category=spell', token);
    expect(status).toBe(200);
    const data = body.data as { items: { category: string }[]; total: number };
    expect(data.total).toBe(1);
    expect(at(data.items, 0, 'errorbook?category=spell').category).toBe('spell');
  });
});

describe('ErrorBook Module - 操作端点', () => {
  let token: string;
  let errorBookId: number;
  let sampleId: number;

  beforeAll(async () => {
    token = await registerAndGetToken('errorbook_ops_user', 'password123', 'ErrorBook Ops User');
    const userId = await getUserId(token);
    // 🔴 用回读的真实 id，别硬编码 1 —— 本文件多个 describe 共用一份 SQLite，
    //    自增 id 会随前面用例漂移，硬编码会让详情/操作端点全部 404。
    const { errorBookIds, errorSampleIds } = await insertErrorBookData(userId);
    errorBookId = errorBookIds[0] ?? 0;
    sampleId = errorSampleIds[0] ?? 0;
  });

  it('GET /errorbook/:id → 200 详情', async () => {
    const { status, body } = await get(`/errorbook/${errorBookId}`, token);
    expect(status).toBe(200);
    expect(body.code).toBe(ErrorCode.OK);
    const data = body.data as { id: number; category: string; wrongCount: number };
    expect(data.id).toBe(errorBookId);
    expect(data.category).toBe('speak');
    expect(data.wrongCount).toBe(2);
  });

  it('POST /errorbook/:id/resolve → 200 标记已解决', async () => {
    const { status, body } = await post(`/errorbook/${errorBookId}/resolve`, {}, token);
    expect(status).toBe(200);
    expect(body.code).toBe(ErrorCode.OK);
    const data = body.data as { rightStreak: number; isResolved: boolean };
    expect(data.rightStreak).toBe(1);
    expect(data.isResolved).toBe(false);
  });

  it('POST /errorbook/:id/favorite → 200 切换收藏', async () => {
    const { status, body } = await post(`/errorbook/${errorBookId}/favorite`, {}, token);
    expect(status).toBe(200);
    expect(body.code).toBe(ErrorCode.OK);
    const data = body.data as { isFavorite: boolean };
    expect(data.isFavorite).toBe(true);
  });

  it('POST /errorbook/:id/favorite → 200 再次切换取消收藏', async () => {
    const { status, body } = await post(`/errorbook/${errorBookId}/favorite`, {}, token);
    expect(status).toBe(200);
    const data = body.data as { isFavorite: boolean };
    expect(data.isFavorite).toBe(false);
  });

  it('DELETE /errorbook/:id → 200 删除', async () => {
    const { status, body } = await del(`/errorbook/${errorBookId}`, token);
    expect(status).toBe(200);
    expect(body.code).toBe(ErrorCode.OK);
  });

  it('GET /errorbook/:id → 404 删除后不存在', async () => {
    const { status, body } = await get(`/errorbook/${errorBookId}`, token);
    expect(status).toBe(404);
    expect(body.code).toBe(ErrorCode.RESOURCE_NOT_FOUND);
  });

  it('GET /errorbook/samples/:id → 200 样本详情', async () => {
    const { status, body } = await get(`/errorbook/samples/${sampleId}`, token);
    expect(status).toBe(200);
    expect(body.code).toBe(ErrorCode.OK);
    const data = body.data as { id: number; category: string; replayCount: number };
    expect(data.id).toBe(sampleId);
    expect(data.category).toBe('speak');
    expect(data.replayCount).toBe(0);
  });

  it('POST /errorbook/samples/:id/replay → 200 回放样本', async () => {
    const { status, body } = await post(`/errorbook/samples/${sampleId}/replay`, {}, token);
    expect(status).toBe(200);
    expect(body.code).toBe(ErrorCode.OK);
    const data = body.data as { replayCount: number };
    expect(data.replayCount).toBe(1);
  });

  it('DELETE /errorbook/samples/:id → 200 删除样本', async () => {
    const { status, body } = await del(`/errorbook/samples/${sampleId}`, token);
    expect(status).toBe(200);
    expect(body.code).toBe(ErrorCode.OK);
  });

  it('GET /errorbook/samples/:id → 404 删除后不存在', async () => {
    const { status, body } = await get(`/errorbook/samples/${sampleId}`, token);
    expect(status).toBe(404);
    expect(body.code).toBe(ErrorCode.RESOURCE_NOT_FOUND);
  });
});

describe('REQ-011 跨档案隔离（ErrorBook）', () => {
  let tokenA: string;
  let tokenB: string;
  let userIdA: number;

  beforeAll(async () => {
    tokenA = await registerAndGetToken('isolation_errorbook_a', 'password123', 'ErrorBook A');
    tokenB = await registerAndGetToken('isolation_errorbook_b', 'password123', 'ErrorBook B');
    userIdA = await getUserId(tokenA);
    await insertErrorBookData(userIdA);
  });

  it('A 的 error_book 数据对 B 不可见（列表为空）', async () => {
    const { status, body } = await get('/errorbook', tokenB);
    expect(status).toBe(200);
    const data = body.data as { items: unknown[]; total: number };
    expect(data.total).toBe(0);
    expect(data.items.length).toBe(0);
  });

  it('A 的 error_book 数据对 B 不可见（按 id 查询返回 404）', async () => {
    const { status, body } = await get('/errorbook/1', tokenB);
    expect(status).toBe(404);
    expect(body.code).toBe(ErrorCode.RESOURCE_NOT_FOUND);
  });

  it('A 的 error_sample 数据对 B 不可见（列表为空）', async () => {
    const { status, body } = await get('/errorbook/samples', tokenB);
    expect(status).toBe(200);
    const data = body.data as { items: unknown[]; total: number };
    expect(data.total).toBe(0);
    expect(data.items.length).toBe(0);
  });

  it('A 的 error_sample 数据对 B 不可见（按 id 查询返回 404）', async () => {
    const { status, body } = await get('/errorbook/samples/1', tokenB);
    expect(status).toBe(404);
    expect(body.code).toBe(ErrorCode.RESOURCE_NOT_FOUND);
  });

  it('B 不能 resolve A 的 error_book（404）', async () => {
    const { status, body } = await post('/errorbook/1/resolve', {}, tokenB);
    expect(status).toBe(404);
    expect(body.code).toBe(ErrorCode.RESOURCE_NOT_FOUND);
  });

  it('B 不能 toggle favorite A 的 error_book（404）', async () => {
    const { status, body } = await post('/errorbook/1/favorite', {}, tokenB);
    expect(status).toBe(404);
    expect(body.code).toBe(ErrorCode.RESOURCE_NOT_FOUND);
  });

  it('B 不能 delete A 的 error_book（404）', async () => {
    const { status, body } = await del('/errorbook/1', tokenB);
    expect(status).toBe(404);
    expect(body.code).toBe(ErrorCode.RESOURCE_NOT_FOUND);
  });

  it('B 不能 replay A 的 error_sample（404）', async () => {
    const { status, body } = await post('/errorbook/samples/1/replay', {}, tokenB);
    expect(status).toBe(404);
    expect(body.code).toBe(ErrorCode.RESOURCE_NOT_FOUND);
  });

  it('A 的数据对 A 可见（确认数据存在）', async () => {
    const { status, body } = await get('/errorbook', tokenA);
    expect(status).toBe(200);
    const data = body.data as { items: unknown[]; total: number };
    expect(data.total).toBe(3);
    expect(data.items.length).toBe(3);
  });
});
