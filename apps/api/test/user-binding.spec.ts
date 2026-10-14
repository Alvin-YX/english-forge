import type { Server } from 'node:http';

import { type ApiResponse, ErrorCode } from '@eng-forge/contracts/api';
import { Role } from '@eng-forge/contracts/enums';
import { NestFactory, type NestApplication } from '@nestjs/core';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { AppModule } from '../src/app.module.js';
import { parseEnv } from '../src/infra/config/env.js';

import { createTestDb, setupTestEnv } from './helpers/test-env.js';

/**
 * 家长绑定链路测试
 *
 * 覆盖：
 *   - GET /users/search  仅家长可用；按 username / displayName 模糊搜索；只出学生
 *   - POST /me/children/bind  支持传 username（家长不知道 childId）；拒绝绑定非学生
 *   - GET  /me/children        视图必须返回 username 与 childId
 *   - POST /me/children/unbind
 *
 * 🔴 每个断言都通过真实 HTTP 请求验证，不 mock 任何一层。
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

interface HttpResponse<T = unknown> {
  status: number;
  body: ApiResponse<T>;
}

async function get<T = unknown>(path: string, token?: string): Promise<HttpResponse<T>> {
  const res = await fetch(`${baseUrl}${path}`, {
    headers: token === undefined ? {} : { authorization: `Bearer ${token}` },
  });
  return { status: res.status, body: (await res.json()) as ApiResponse<T> };
}

async function post<T = unknown>(
  path: string,
  body: unknown,
  token?: string,
): Promise<HttpResponse<T>> {
  const headers: Record<string, string> = { 'content-type': 'application/json' };
  if (token !== undefined) headers.authorization = `Bearer ${token}`;
  const res = await fetch(`${baseUrl}${path}`, {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
  });
  return { status: res.status, body: (await res.json()) as ApiResponse<T> };
}

interface Registered {
  username: string;
  role: Role;
  token: string;
}

/** 注册一个账号并返回可用 token */
async function register(username: string, role: Role, displayName?: string): Promise<Registered> {
  const { status, body } = await post<{ accessToken: string }>('/auth/register', {
    username,
    password: 'password123',
    displayName: displayName ?? username,
    role,
  });
  expect(status, `注册 ${username} 应成功：${JSON.stringify(body)}`).toBe(201);
  return { username, role, token: body.data.accessToken };
}

async function listChildren(token: string) {
  return get<
    Array<{
      childId: number;
      username: string;
      displayName: string;
      stageCode?: string;
      createdAt: string;
    }>
  >('/me/children', token);
}

describe('GET /users/search —— 家长搜索可绑定的学生', () => {
  it('学生角色调用应被 RBAC 拒绝', async () => {
    const student = await register('search_student_a', Role.STUDENT);
    const { status, body } = await get('/users/search?q=x', student.token);
    expect(status).toBe(403);
    expect(body.code).toBe(ErrorCode.FORBIDDEN);
  });

  it('家长可按 username 模糊搜索，且只返回学生', async () => {
    await register('search_target_boy', Role.STUDENT);
    await register('search_target_girl', Role.STUDENT);
    await register('search_target_teacher', Role.TEACHER);
    const parent = await register('search_parent_a', Role.PARENT);

    const { status, body } = await get<{ list: Array<{ username: string }> }>(
      '/users/search?q=search_target',
      parent.token,
    );
    expect(status).toBe(200);
    expect(body.code).toBe(ErrorCode.OK);

    const usernames = body.data.list.map((u) => u.username);
    // 两个学生都在，教师账号必须被过滤掉
    expect(usernames).toContain('search_target_boy');
    expect(usernames).toContain('search_target_girl');
    expect(usernames).not.toContain('search_target_teacher');
  });

  it('可按 displayName 搜索命中', async () => {
    await register('search_by_display', Role.STUDENT, '独一小公主');
    const parent = await register('search_parent_b', Role.PARENT);

    const { status, body } = await get<{ list: Array<{ username: string }> }>(
      '/users/search?q=小公主',
      parent.token,
    );
    expect(status).toBe(200);
    expect(body.data.list.map((u) => u.username)).toContain('search_by_display');
  });

  it('q 为空返回空列表而非报错', async () => {
    const parent = await register('search_parent_c', Role.PARENT);
    const { status, body } = await get<{ list: unknown[]; total: number }>('/users/search', parent.token);
    expect(status).toBe(200);
    expect(body.data.list).toEqual([]);
    expect(body.data.total).toBe(0);
  });

  it('不泄露家长无权看的字段', async () => {
    const parent = await register('search_parent_d', Role.PARENT);
    const { body } = await get<{ list: Array<Record<string, unknown>> }>('/users/search?q=search_target', parent.token);
    for (const row of body.data.list) {
      expect(Object.keys(row).sort()).toEqual(['displayName', 'userId', 'username']);
    }
  });
});

describe('POST /me/children/bind —— 支持按 username 绑定', () => {
  it('传 username 绑定成功，GET /me/children 返回 childId 与 username', async () => {
    await register('bind_target_a', Role.STUDENT);
    const parent = await register('bind_parent_a', Role.PARENT);

    const { status, body } = await post('/me/children/bind', {
      username: 'bind_target_a',
      agreed: true,
    }, parent.token);
    expect(status, JSON.stringify(body)).toBe(200);
    expect(body.code).toBe(ErrorCode.OK);

    const listed = await listChildren(parent.token);
    expect(listed.status).toBe(200);
    const row = listed.body.data.find((c) => c.username === 'bind_target_a');
    expect(row).toBeDefined();
    expect(row?.childId).toBeTypeOf('number');
    expect(row?.displayName).toBe('bind_target_a');
    expect(row?.createdAt).toBeTruthy();
  });

  it('绑定是幂等的，重复提交不报错也不产生重复行', async () => {
    await register('bind_target_b', Role.STUDENT);
    const parent = await register('bind_parent_b', Role.PARENT);

    for (let i = 0; i < 3; i++) {
      const { status, body } = await post('/me/children/bind', {
        username: 'bind_target_b',
        agreed: true,
      }, parent.token);
      expect(status, `第 ${i + 1} 次：${JSON.stringify(body)}`).toBe(200);
    }

    const listed = await listChildren(parent.token);
    expect(listed.body.data.filter((c) => c.username === 'bind_target_b')).toHaveLength(1);
  });

  it('username 与 childId 都缺失时应 400', async () => {
    const parent = await register('bind_parent_c', Role.PARENT);
    const { status, body } = await post('/me/children/bind', { agreed: true }, parent.token);
    expect(status).toBe(400);
    expect(body.code).toBe(ErrorCode.VALIDATION_FAILED);
  });

  it('username 与 childId 同时提供时应 400', async () => {
    const parent = await register('bind_parent_d', Role.PARENT);
    const { status } = await post('/me/children/bind', {
      childId: 1,
      username: 'bind_target_a',
    }, parent.token);
    expect(status).toBe(400);
  });

  it('不存在的 username 应 404', async () => {
    const parent = await register('bind_parent_e', Role.PARENT);
    const { status, body } = await post('/me/children/bind', {
      username: 'definitely_not_exist_xyz',
    }, parent.token);
    expect(status).toBe(404);
    expect(body.code).toBe(ErrorCode.RESOURCE_NOT_FOUND);
  });

  it('不能把家长账号绑成孩子', async () => {
    await register('bind_target_victim_parent', Role.PARENT);
    const parent = await register('bind_parent_f', Role.PARENT);

    const { status, body } = await post('/me/children/bind', {
      username: 'bind_target_victim_parent',
    }, parent.token);
    expect(status).toBe(400);
    expect(body.code).toBe(ErrorCode.OPERATION_NOT_ALLOWED);
  });

  it('不能把自己绑成孩子', async () => {
    const parent = await register('bind_parent_self', Role.PARENT);
    const { status } = await post('/me/children/bind', {
      username: 'bind_parent_self',
    }, parent.token);
    // 家长绑自己先被 role 校验拦下（只能绑学生）
    expect(status).toBe(400);
  });

  it('学生角色不能绑定（服务层双保险）', async () => {
    await register('bind_target_student_role', Role.STUDENT);
    const student = await register('bind_actor_student', Role.STUDENT);
    const { status, body } = await post('/me/children/bind', {
      username: 'bind_target_student_role',
    }, student.token);
    expect(status).toBe(403);
    expect(body.code).toBe(ErrorCode.FORBIDDEN);
  });

  it('传 childId 的老路径仍然可用', async () => {
    await register('bind_target_legacy', Role.STUDENT, 'Legacy');
    // register 不回 id，用 search 接口反查
    const parent = await register('bind_parent_legacy', Role.PARENT);
    const { body: listed } = await get<{ list: Array<{ userId: number }> }>(
      '/users/search?q=bind_target_legacy',
      parent.token,
    );
    const childId = listed.data.list[0]?.userId;
    expect(childId).toBeTypeOf('number');

    const { status, body } = await post('/me/children/bind', { childId }, parent.token);
    expect(status, JSON.stringify(body)).toBe(200);

    const after = await listChildren(parent.token);
    expect(after.body.data.find((c) => c.childId === childId)).toBeDefined();
  });
});

describe('POST /me/children/unbind —— 解绑', () => {
  it('解绑后不再出现在列表中，且他人档案不受影响', async () => {
    await register('unbind_target_a', Role.STUDENT);
    await register('unbind_target_b', Role.STUDENT);
    const parent = await register('unbind_parent_a', Role.PARENT);

    for (const name of ['unbind_target_a', 'unbind_target_b']) {
      await post('/me/children/bind', { username: name }, parent.token);
    }
    const before = await listChildren(parent.token);
    expect(before.body.data).toHaveLength(2);

    const target = before.body.data.find((c) => c.username === 'unbind_target_a');
    expect(target).toBeDefined();

    const { status } = await post('/me/children/unbind', { childId: target?.childId }, parent.token);
    expect(status).toBe(200);

    const after = await listChildren(parent.token);
    expect(after.body.data).toHaveLength(1);
    expect(after.body.data[0]?.username).toBe('unbind_target_b');
  });

  it('解绑不存在的 childId 应 404', async () => {
    const parent = await register('unbind_parent_b', Role.PARENT);
    const { status, body } = await post('/me/children/unbind', { childId: 999999 }, parent.token);
    expect(status).toBe(404);
    expect(body.code).toBe(ErrorCode.RESOURCE_NOT_FOUND);
  });

  it('解绑后重新绑定应成功（回归：同意记录撞唯一约束导致 500）', async () => {
    await register('rebind_target', Role.STUDENT);
    const parent = await register('rebind_parent', Role.PARENT);

    const first = await post('/me/children/bind', { username: 'rebind_target', agreed: true }, parent.token);
    expect(first.status).toBe(200);

    const listed = await listChildren(parent.token);
    const childId = listed.body.data[0]?.childId;
    expect(childId).toBeDefined();

    const unbound = await post('/me/children/unbind', { childId }, parent.token);
    expect(unbound.status).toBe(200);

    // consent_log 有 UNIQUE(child_id, agreement_version)：解绑不会删除同意记录，
    // 重新绑定时重复 insert 曾撞唯一约束抛 500，且当时 parent_children 已提交、
    // 用户看到报错但实际已绑定。现在两次写入都幂等，必须稳定 200。
    const rebound = await post('/me/children/bind', { username: 'rebind_target', agreed: true }, parent.token);
    expect(rebound.status).toBe(200);
    expect(rebound.body.code).toBe(ErrorCode.OK);

    const after = await listChildren(parent.token);
    expect(after.body.data).toHaveLength(1);
    expect(after.body.data[0]?.username).toBe('rebind_target');
  });
});

describe('GET /me/children —— 角色与隔离', () => {
  it('学生角色调用应被 RBAC 拒绝', async () => {
    const student = await register('children_student_actor', Role.STUDENT);
    const { status, body } = await get('/me/children', student.token);
    expect(status).toBe(403);
    expect(body.code).toBe(ErrorCode.FORBIDDEN);
  });

  it('未认证访问应 401', async () => {
    const { status } = await get('/me/children');
    expect(status).toBe(401);
  });

  it('两位家长互不可见对方的绑定', async () => {
    await register('iso_target_shared', Role.STUDENT);
    const parentA = await register('iso_parent_a', Role.PARENT);
    const parentB = await register('iso_parent_b', Role.PARENT);

    const bind = await post('/me/children/bind', { username: 'iso_target_shared' }, parentA.token);
    expect(bind.status).toBe(200);

    const a = await listChildren(parentA.token);
    const b = await listChildren(parentB.token);
    expect(a.body.data).toHaveLength(1);
    expect(b.body.data).toHaveLength(0);
  });
});
