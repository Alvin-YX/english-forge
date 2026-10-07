import type { Server } from 'node:http';

import { type ApiResponse, ErrorCode } from '@eng-forge/contracts/api';
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

async function del(path: string, token?: string): Promise<{ status: number; body: ApiResponse<unknown> }> {
  const res = await fetch(`${baseUrl}${path}`, {
    method: 'DELETE',
    headers: token === undefined ? {} : { authorization: `Bearer ${token}` },
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

// ═══════════════════════════════════════════════════════════
// Auth checks
// ═══════════════════════════════════════════════════════════

describe('Conversation Module - 鉴权检查（无 token → 401）', () => {
  it('GET /conversations 无 token → 401', async () => {
    const { status, body } = await get('/conversations');
    expect(status).toBe(401);
    expect(body.code).toBe(ErrorCode.UNAUTHENTICATED);
  });

  it('POST /conversations 无 token → 401', async () => {
    const { status, body } = await post('/conversations', { mode: 'chat', level: 'A1' });
    expect(status).toBe(401);
    expect(body.code).toBe(ErrorCode.UNAUTHENTICATED);
  });

  it('GET /conversations/1 无 token → 401', async () => {
    const { status, body } = await get('/conversations/1');
    expect(status).toBe(401);
    expect(body.code).toBe(ErrorCode.UNAUTHENTICATED);
  });

  it('GET /conversations/1/messages 无 token → 401', async () => {
    const { status, body } = await get('/conversations/1/messages');
    expect(status).toBe(401);
    expect(body.code).toBe(ErrorCode.UNAUTHENTICATED);
  });
});

// ═══════════════════════════════════════════════════════════
// Conversation CRUD
// ═══════════════════════════════════════════════════════════

describe('Conversation Module - 对话 CRUD', () => {
  let token: string;
  let convId: number;

  beforeAll(async () => {
    token = await registerAndGetToken('conv_crud_user', 'password123', 'Conv CRUD User');
  });

  it('POST /conversations → 201 创建对话', async () => {
    const { status, body } = await post(
      '/conversations',
      { mode: 'chat', level: 'A1' },
      token,
    );
    expect(status).toBe(201);
    expect(body.code).toBe(ErrorCode.OK);
    const data = body.data as { id: number; mode: string; level: string; status: string; turnCount: number; startedAt: string };
    convId = data.id;
    expect(data.mode).toBe('chat');
    expect(data.level).toBe('A1');
    expect(data.status).toBe('active');
    expect(data.turnCount).toBe(0);
    expect(typeof data.startedAt).toBe('string');
  });

  it('POST /conversations 不同模式 → 201', async () => {
    const { status, body } = await post(
      '/conversations',
      { mode: 'interview', level: 'B1' },
      token,
    );
    expect(status).toBe(201);
    const data = body.data as { mode: string; status: string };
    expect(data.mode).toBe('interview');
    expect(data.status).toBe('active');
  });

  it('GET /conversations → 200 列表', async () => {
    const { status, body } = await get('/conversations', token);
    expect(status).toBe(200);
    const data = body.data as { items: unknown[]; total: number; page: number; pageSize: number };
    expect(data.total).toBeGreaterThanOrEqual(2);
    expect(data.page).toBe(1);
    expect(data.pageSize).toBe(20);
  });

  it('GET /conversations?mode=chat → 按模式过滤', async () => {
    const { status, body } = await get('/conversations?mode=chat', token);
    expect(status).toBe(200);
    const data = body.data as { items: { mode: string }[] };
    data.items.forEach((item) => expect(item.mode).toBe('chat'));
  });

  it('GET /conversations?status=active → 按状态过滤', async () => {
    const { status, body } = await get('/conversations?status=active', token);
    expect(status).toBe(200);
    const data = body.data as { items: { status: string }[] };
    data.items.forEach((item) => expect(item.status).toBe('active'));
  });

  it('GET /conversations/:id → 200 对话详情', async () => {
    const { status, body } = await get(`/conversations/${convId}`, token);
    expect(status).toBe(200);
    const data = body.data as { id: number; mode: string; status: string; startedAt: string };
    expect(data.id).toBe(convId);
    expect(data.mode).toBe('chat');
    expect(data.status).toBe('active');
    expect(typeof data.startedAt).toBe('string');
  });

  it('GET /conversations/99999 → 404', async () => {
    const { status, body } = await get('/conversations/99999', token);
    expect(status).toBe(404);
    expect(body.code).toBe(ErrorCode.CONVERSATION_NOT_FOUND);
  });

  it('GET /conversations/abc → 400', async () => {
    const { status, body } = await get('/conversations/abc', token);
    expect(status).toBe(400);
    expect(body.code).toBe(ErrorCode.VALIDATION_FAILED);
  });

  it('GET /conversations?sortBy=turnCount → 200', async () => {
    const { status } = await get('/conversations?sortBy=turnCount', token);
    expect(status).toBe(200);
  });

  it('GET /conversations?sortDir=asc → 200', async () => {
    const { status } = await get('/conversations?sortDir=asc', token);
    expect(status).toBe(200);
  });
});

// ═══════════════════════════════════════════════════════════
// Messages
// ═══════════════════════════════════════════════════════════

describe('Conversation Module - 消息', () => {
  let token: string;
  let convId: number;
  let messageId: number;

  beforeAll(async () => {
    token = await registerAndGetToken('conv_msg_user', 'password123', 'Conv Msg User');
    const { body } = await post('/conversations', { mode: 'chat', level: 'A2' }, token);
    convId = (body.data as { id: number }).id;
  });

  it('POST /conversations/:id/messages → 201 发送用户消息', async () => {
    const { status, body } = await post(
      `/conversations/${convId}/messages`,
      { role: 'user', content: 'Hello!' },
      token,
    );
    expect(status).toBe(201);
    const data = body.data as { id: number; seq: number; role: string; content: string };
    messageId = data.id;
    expect(data.seq).toBe(1);
    expect(data.role).toBe('user');
    expect(data.content).toBe('Hello!');
  });

  it('POST 第二条消息 → seq=2', async () => {
    const { status, body } = await post(
      `/conversations/${convId}/messages`,
      { role: 'user', content: 'How are you?' },
      token,
    );
    expect(status).toBe(201);
    const data = body.data as { seq: number; role: string };
    expect(data.seq).toBe(2);
    expect(data.role).toBe('user');
  });

  it('POST assistant 消息 → seq=3', async () => {
    const { status, body } = await post(
      `/conversations/${convId}/messages`,
      { role: 'assistant', content: 'I am fine, thank you!' },
      token,
    );
    expect(status).toBe(201);
    const data = body.data as { seq: number; role: string };
    expect(data.seq).toBe(3);
    expect(data.role).toBe('assistant');
  });

  it('GET /conversations/:id/messages → 200 消息列表按 seq 升序', async () => {
    const { status, body } = await get(`/conversations/${convId}/messages`, token);
    expect(status).toBe(200);
    const data = body.data as { items: { seq: number; role: string }[]; total: number };
    expect(data.total).toBe(3);
    expect(data.items.length).toBe(3);
    for (let i = 1; i < data.items.length; i++) {
      expect(data.items[i]!.seq).toBeGreaterThan(data.items[i - 1]!.seq);
    }
  });

  it('GET /conversations/:id/messages/:messageId → 200 单条消息', async () => {
    const { status, body } = await get(`/conversations/${convId}/messages/${messageId}`, token);
    expect(status).toBe(200);
    const data = body.data as { id: number; content: string; role: string };
    expect(data.id).toBe(messageId);
    expect(data.role).toBe('user');
  });

  it('GET /conversations/:id/messages/99999 → 404 消息不存在', async () => {
    const { status, body } = await get(`/conversations/${convId}/messages/99999`, token);
    expect(status).toBe(404);
    expect(body.code).toBe(ErrorCode.RESOURCE_NOT_FOUND);
  });

  it('GET /conversations/:id/messages?page=1&pageSize=2 → 分页', async () => {
    const { status, body } = await get(`/conversations/${convId}/messages?page=1&pageSize=2`, token);
    expect(status).toBe(200);
    const data = body.data as { items: unknown[]; total: number; pageSize: number; totalPages: number };
    expect(data.items.length).toBe(2);
    expect(data.total).toBe(3);
    expect(data.pageSize).toBe(2);
    expect(data.totalPages).toBe(2);
  });

  it('POST /conversations/:id/messages 超长内容 → 400', async () => {
    const longContent = 'x'.repeat(2001);
    const { status, body } = await post(
      `/conversations/${convId}/messages`,
      { role: 'user', content: longContent },
      token,
    );
    expect(status).toBe(400);
    expect(body.code).toBe(ErrorCode.VALIDATION_FAILED);
  });

  it('POST /conversations/99999/messages → 404 对话不存在', async () => {
    const { status, body } = await post(
      '/conversations/99999/messages',
      { role: 'user', content: 'test' },
      token,
    );
    expect(status).toBe(404);
    expect(body.code).toBe(ErrorCode.CONVERSATION_NOT_FOUND);
  });
});

// ═══════════════════════════════════════════════════════════
// Finish & Delete
// ═══════════════════════════════════════════════════════════

describe('Conversation Module - 结束与删除', () => {
  let token: string;
  let convId: number;

  beforeAll(async () => {
    token = await registerAndGetToken('conv_finish_user', 'password123', 'Conv Finish User');
    const { body } = await post('/conversations', { mode: 'qa', level: 'A1' }, token);
    convId = (body.data as { id: number }).id;
  });

  it('PATCH /conversations/:id/finish → 200 结束对话', async () => {
    const { status, body } = await patch(`/conversations/${convId}/finish`, {}, token);
    expect(status).toBe(200);
    const data = body.data as { status: string; endedAt: string };
    expect(data.status).toBe('finished');
    expect(typeof data.endedAt).toBe('string');
  });

  it('GET /conversations/:id → 200 已结束状态', async () => {
    const { body } = await get(`/conversations/${convId}`, token);
    const data = body.data as { status: string; endedAt: string };
    expect(data.status).toBe('finished');
    expect(typeof data.endedAt).toBe('string');
  });

  it('PATCH /conversations/99999/finish → 404', async () => {
    const { status, body } = await patch('/conversations/99999/finish', {}, token);
    expect(status).toBe(404);
    expect(body.code).toBe(ErrorCode.CONVERSATION_NOT_FOUND);
  });

  it('DELETE /conversations/:id → 200 删除', async () => {
    const { status, body } = await del(`/conversations/${convId}`, token);
    expect(status).toBe(200);
    expect(body.code).toBe(ErrorCode.OK);
  });

  it('GET /conversations/:id → 404 删除后不存在', async () => {
    const { status, body } = await get(`/conversations/${convId}`, token);
    expect(status).toBe(404);
    expect(body.code).toBe(ErrorCode.CONVERSATION_NOT_FOUND);
  });

  it('DELETE /conversations/99999 → 404', async () => {
    const { status, body } = await del('/conversations/99999', token);
    expect(status).toBe(404);
    expect(body.code).toBe(ErrorCode.CONVERSATION_NOT_FOUND);
  });
});

// ═══════════════════════════════════════════════════════════
// Cross-profile isolation
// ═══════════════════════════════════════════════════════════

describe('Conversation Module - 跨档案隔离', () => {
  let tokenA: string;
  let tokenB: string;
  let convIdA: number;

  beforeAll(async () => {
    tokenA = await registerAndGetToken('conv_iso_a', 'password123', 'Conv Iso A');
    tokenB = await registerAndGetToken('conv_iso_b', 'password123', 'Conv Iso B');
    const { body } = await post('/conversations', { mode: 'debate', level: 'B2' }, tokenA);
    convIdA = (body.data as { id: number }).id;
  });

  it('B 不能 GET A 的对话（404）', async () => {
    const { status, body } = await get(`/conversations/${convIdA}`, tokenB);
    expect(status).toBe(404);
    expect(body.code).toBe(ErrorCode.CONVERSATION_NOT_FOUND);
  });

  it('B 不能 PATCH A 的对话 finish（404）', async () => {
    const { status, body } = await patch(`/conversations/${convIdA}/finish`, {}, tokenB);
    expect(status).toBe(404);
    expect(body.code).toBe(ErrorCode.CONVERSATION_NOT_FOUND);
  });

  it('B 不能 DELETE A 的对话（404）', async () => {
    const { status, body } = await del(`/conversations/${convIdA}`, tokenB);
    expect(status).toBe(404);
    expect(body.code).toBe(ErrorCode.CONVERSATION_NOT_FOUND);
  });

  it('B 不能 GET A 的对话消息（404）', async () => {
    const { status, body } = await get(`/conversations/${convIdA}/messages`, tokenB);
    expect(status).toBe(404);
    expect(body.code).toBe(ErrorCode.CONVERSATION_NOT_FOUND);
  });

  it('B 不能 POST A 的对话消息（404）', async () => {
    const { status, body } = await post(
      `/conversations/${convIdA}/messages`,
      { role: 'user', content: 'hack' },
      tokenB,
    );
    expect(status).toBe(404);
    expect(body.code).toBe(ErrorCode.CONVERSATION_NOT_FOUND);
  });

  it('A 的数据对 A 可见（确认数据存在）', async () => {
    const { status, body } = await get(`/conversations/${convIdA}`, tokenA);
    expect(status).toBe(200);
    const data = body.data as { id: number; mode: string };
    expect(data.id).toBe(convIdA);
    expect(data.mode).toBe('debate');
  });

  it('A 不能看到 B 的对话列表', async () => {
    const { status, body } = await get('/conversations', tokenA);
    const data = body.data as { items: { id: number }[]; total: number };
    expect(data.total).toBe(1);
    data.items.forEach((item) => expect(item.id).toBe(convIdA));
  });
});

// ═══════════════════════════════════════════════════════════
// Validation
// ═══════════════════════════════════════════════════════════

describe('Conversation Module - 参数校验', () => {
  let token: string;

  beforeAll(async () => {
    token = await registerAndGetToken('conv_val_user', 'password123', 'Conv Val User');
  });

  it('POST /conversations invalid mode → 400', async () => {
    const { status, body } = await post(
      '/conversations',
      { mode: 'invalid_mode', level: 'A1' },
      token,
    );
    expect(status).toBe(400);
    expect(body.code).toBe(ErrorCode.VALIDATION_FAILED);
  });

  it('POST /conversations 缺少 level → 400', async () => {
    const { status, body } = await post(
      '/conversations',
      { mode: 'chat' },
      token,
    );
    expect(status).toBe(400);
    expect(body.code).toBe(ErrorCode.VALIDATION_FAILED);
  });

  it('GET /conversations?mode=invalid → 400', async () => {
    const { status, body } = await get('/conversations?mode=invalid', token);
    expect(status).toBe(400);
    expect(body.code).toBe(ErrorCode.VALIDATION_FAILED);
  });

  it('GET /conversations?status=invalid → 400', async () => {
    const { status, body } = await get('/conversations?status=invalid', token);
    expect(status).toBe(400);
    expect(body.code).toBe(ErrorCode.VALIDATION_FAILED);
  });

  it('GET /conversations?page=0 → 400', async () => {
    const { status, body } = await get('/conversations?page=0', token);
    expect(status).toBe(400);
    expect(body.code).toBe(ErrorCode.VALIDATION_FAILED);
  });

  it('GET /conversations?sortBy=invalid → 400', async () => {
    const { status, body } = await get('/conversations?sortBy=invalid', token);
    expect(status).toBe(400);
    expect(body.code).toBe(ErrorCode.VALIDATION_FAILED);
  });

  it('GET /conversations/0 → 400', async () => {
    const { status, body } = await get('/conversations/0', token);
    expect(status).toBe(400);
    expect(body.code).toBe(ErrorCode.VALIDATION_FAILED);
  });
});
