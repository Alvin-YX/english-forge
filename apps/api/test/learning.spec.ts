import type { Server } from 'node:http';

import { type ApiResponse, ErrorCode } from '@eng-forge/contracts/api';
import { Role } from '@eng-forge/contracts/enums';
import { NestFactory, type NestApplication } from '@nestjs/core';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { AppModule } from '../src/app.module.js';
import { DbConnection } from '../src/infra/db/db.module.js';
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
  await seedTestData();
});

afterAll(async () => {
  await app?.close();
  cleanup?.();
});

async function seedTestData(): Promise<void> {
  const raw = (app.get(DbConnection).client as unknown as { raw: { exec: (sql: string) => unknown } }).raw;
  raw.exec(`
    INSERT INTO word (headword, lemma, pos, translation_zh, license, source, is_active, is_verb, exam_tags)
      VALUES ('testword', 'testword', 'n', '测试词', 'CC-BY-4.0', 'builtin', 1, 0, '[]');
  `);
}

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

describe('Learning Module - 鉴权检查（无 token → 401）', () => {
  it('GET /learning/mastery 无 token → 401', async () => {
    const { status, body } = await get('/learning/mastery');
    expect(status).toBe(401);
    expect(body.code).toBe(ErrorCode.UNAUTHENTICATED);
  });

  it('GET /learning/mastery/:wordId 无 token → 401', async () => {
    const { status, body } = await get('/learning/mastery/1');
    expect(status).toBe(401);
    expect(body.code).toBe(ErrorCode.UNAUTHENTICATED);
  });

  it('PATCH /learning/mastery 无 token → 401', async () => {
    const { status, body } = await patch('/learning/mastery', { wordId: 1 });
    expect(status).toBe(401);
    expect(body.code).toBe(ErrorCode.UNAUTHENTICATED);
  });

  it('POST /learning/record 无 token → 401', async () => {
    const { status, body } = await post('/learning/record', { kind: 'word_card', refType: 'word' });
    expect(status).toBe(401);
    expect(body.code).toBe(ErrorCode.UNAUTHENTICATED);
  });

  it('GET /learning/records 无 token → 401', async () => {
    const { status, body } = await get('/learning/records');
    expect(status).toBe(401);
    expect(body.code).toBe(ErrorCode.UNAUTHENTICATED);
  });

  it('GET /learning/today 无 token → 401', async () => {
    const { status, body } = await get('/learning/today');
    expect(status).toBe(401);
    expect(body.code).toBe(ErrorCode.UNAUTHENTICATED);
  });

  it('GET /learning/streak 无 token → 401', async () => {
    const { status, body } = await get('/learning/streak');
    expect(status).toBe(401);
    expect(body.code).toBe(ErrorCode.UNAUTHENTICATED);
  });

  it('GET /learning/heatmap 无 token → 401', async () => {
    const { status, body } = await get('/learning/heatmap');
    expect(status).toBe(401);
    expect(body.code).toBe(ErrorCode.UNAUTHENTICATED);
  });

  it('GET /learning/lessons/:courseId/next-block 无 token → 401', async () => {
    const { status, body } = await get('/learning/lessons/1/next-block');
    expect(status).toBe(401);
    expect(body.code).toBe(ErrorCode.UNAUTHENTICATED);
  });

  it('POST /learning/lessons/:blockId/consume 无 token → 401', async () => {
    const { status, body } = await post('/learning/lessons/1/consume', {});
    expect(status).toBe(401);
    expect(body.code).toBe(ErrorCode.UNAUTHENTICATED);
  });
});

describe('Learning Module - word_mastery CRUD', () => {
  it('PATCH /learning/mastery → 200 创建掌握度', async () => {
    const token = await registerAndGetToken('mastery_create_user', 'password123', 'Mastery User');
    const { status, body } = await patch(
      '/learning/mastery',
      { wordId: 1, recognizeScore: 80, listenScore: 70, spellScore: 60, speakScore: 50 },
      token,
    );
    expect(status).toBe(200);
    expect(body.code).toBe(ErrorCode.OK);
    const data = body.data as { wordId: number; recognizeScore: number; overallScore: number };
    expect(data.wordId).toBe(1);
    expect(data.recognizeScore).toBe(80);
    expect(data.overallScore).toBe(66.5);
  });

  it('PATCH /learning/mastery → 200 更新已有掌握度', async () => {
    const token = await registerAndGetToken('mastery_update_user', 'password123', 'Mastery Update User');
    await patch('/learning/mastery', { wordId: 1, recognizeScore: 50 }, token);
    const { status, body } = await patch(
      '/learning/mastery',
      { wordId: 1, recognizeScore: 90, listenScore: 80 },
      token,
    );
    expect(status).toBe(200);
    expect(body.code).toBe(ErrorCode.OK);
    const data = body.data as { recognizeScore: number; listenScore: number; totalAttempts: number };
    expect(data.recognizeScore).toBe(90);
    expect(data.listenScore).toBe(80);
    expect(data.totalAttempts).toBe(2);
  });

  it('GET /learning/mastery → 200 列表', async () => {
    const token = await registerAndGetToken('mastery_list_user', 'password123', 'Mastery List User');
    await patch('/learning/mastery', { wordId: 1, recognizeScore: 75 }, token);
    const { status, body } = await get('/learning/mastery', token);
    expect(status).toBe(200);
    expect(body.code).toBe(ErrorCode.OK);
    const data = body.data as { items: unknown[]; total: number };
    expect(data.total).toBe(1);
    expect(data.items.length).toBe(1);
  });

  it('GET /learning/mastery/:wordId → 200 存在时返回详情', async () => {
    const token = await registerAndGetToken('mastery_get_user', 'password123', 'Mastery Get User');
    await patch('/learning/mastery', { wordId: 1, recognizeScore: 85 }, token);
    const { status, body } = await get('/learning/mastery/1', token);
    expect(status).toBe(200);
    expect(body.code).toBe(ErrorCode.OK);
    const data = body.data as { wordId: number; recognizeScore: number };
    expect(data.wordId).toBe(1);
    expect(data.recognizeScore).toBe(85);
  });

  it('GET /learning/mastery/:wordId → 200 不存在时返回 null', async () => {
    const token = await registerAndGetToken('mastery_none_user', 'password123', 'Mastery None User');
    const { status, body } = await get('/learning/mastery/99999', token);
    expect(status).toBe(200);
    expect(body.code).toBe(ErrorCode.OK);
    expect(body.data).toBeNull();
  });

  it('PATCH /learning/mastery → 400 缺少 wordId', async () => {
    const token = await registerAndGetToken('mastery_invalid_user', 'password123', 'Mastery Invalid User');
    const { status, body } = await patch('/learning/mastery', { recognizeScore: 80 }, token);
    expect(status).toBe(400);
    expect(body.code).toBe(ErrorCode.VALIDATION_FAILED);
  });
});

describe('Learning Module - learning_record', () => {
  it('POST /learning/record → 201 创建记录', async () => {
    const token = await registerAndGetToken('record_create_user', 'password123', 'Record Create User');
    const { status, body } = await post(
      '/learning/record',
      { kind: 'word_card', refType: 'word', refId: 1, isCorrect: true, score: 85, confidenceLevel: 'high' },
      token,
    );
    expect(status).toBe(201);
    expect(body.code).toBe(ErrorCode.OK);
    const data = body.data as { id: number; kind: string; refType: string; isCorrect: boolean; score: number };
    expect(typeof data.id).toBe('number');
    expect(data.kind).toBe('word_card');
    expect(data.refType).toBe('word');
    expect(data.isCorrect).toBe(true);
    expect(data.score).toBe(85);
  });

  it('GET /learning/records → 200 列表', async () => {
    const token = await registerAndGetToken('record_list_user', 'password123', 'Record List User');
    await post('/learning/record', { kind: 'word_card', refType: 'word', refId: 1 }, token);
    const { status, body } = await get('/learning/records', token);
    expect(status).toBe(200);
    expect(body.code).toBe(ErrorCode.OK);
    const data = body.data as { items: unknown[]; total: number };
    expect(data.total).toBe(1);
    expect(data.items.length).toBe(1);
  });

  it('GET /learning/records?kind=spell → 过滤按类型', async () => {
    const token = await registerAndGetToken('record_filter_user', 'password123', 'Record Filter User');
    await post('/learning/record', { kind: 'word_card', refType: 'word' }, token);
    await post('/learning/record', { kind: 'spell', refType: 'word', refId: 1 }, token);
    await post('/learning/record', { kind: 'dictation', refType: 'sentence' }, token);
    const { status, body } = await get('/learning/records?kind=spell', token);
    expect(status).toBe(200);
    expect(body.code).toBe(ErrorCode.OK);
    const data = body.data as { items: { kind: string }[]; total: number };
    expect(data.total).toBe(1);
    expect(data.items[0].kind).toBe('spell');
  });

  it('GET /learning/records 分页生效', async () => {
    const token = await registerAndGetToken('record_page_user', 'password123', 'Record Page User');
    for (let i = 0; i < 5; i++) {
      await post('/learning/record', { kind: 'word_card', refType: 'word', refId: 1 }, token);
    }
    const { status, body } = await get('/learning/records?page=1&pageSize=2', token);
    expect(status).toBe(200);
    expect(body.code).toBe(ErrorCode.OK);
    const data = body.data as { items: unknown[]; total: number; pageSize: number; totalPages: number };
    expect(data.items.length).toBe(2);
    expect(data.total).toBe(5);
    expect(data.pageSize).toBe(2);
    expect(data.totalPages).toBe(3);
  });

  it('POST /learning/record → 400 缺少 kind', async () => {
    const token = await registerAndGetToken('record_invalid_user', 'password123', 'Record Invalid User');
    const { status, body } = await post('/learning/record', { refType: 'word' }, token);
    expect(status).toBe(400);
    expect(body.code).toBe(ErrorCode.VALIDATION_FAILED);
  });

  it('POST /learning/record → 400 kind 值不合法', async () => {
    const token = await registerAndGetToken('record_bad_kind_user', 'password123', 'Record Bad Kind User');
    const { status, body } = await post('/learning/record', { kind: 'invalid', refType: 'word' }, token);
    expect(status).toBe(400);
    expect(body.code).toBe(ErrorCode.VALIDATION_FAILED);
  });
});

describe('Learning Module - today/streak/heatmap', () => {
  it('GET /learning/today → 200 新用户全部为零', async () => {
    const token = await registerAndGetToken('today_user', 'password123', 'Today User');
    const { status, body } = await get('/learning/today', token);
    expect(status).toBe(200);
    expect(body.code).toBe(ErrorCode.OK);
    const data = body.data as {
      studyMinutes: number;
      newWords: number;
      reviews: number;
      avgScore: number;
      correctRate: number;
      errorCount: number;
      goalMet: boolean;
      dueReviewCount: number;
    };
    expect(data.studyMinutes).toBe(0);
    expect(data.newWords).toBe(0);
    expect(data.reviews).toBe(0);
    expect(data.avgScore).toBe(0);
    expect(data.correctRate).toBe(0);
    expect(data.errorCount).toBe(0);
    expect(data.goalMet).toBe(false);
    expect(data.dueReviewCount).toBe(0);
  });

  it('GET /learning/streak → 200 新用户全部为零', async () => {
    const token = await registerAndGetToken('streak_user', 'password123', 'Streak User');
    const { status, body } = await get('/learning/streak', token);
    expect(status).toBe(200);
    expect(body.code).toBe(ErrorCode.OK);
    const data = body.data as { currentDays: number; longestDays: number; freezeUsed: number };
    expect(data.currentDays).toBe(0);
    expect(data.longestDays).toBe(0);
    expect(data.freezeUsed).toBe(0);
  });

  it('GET /learning/heatmap → 200 返回数组', async () => {
    const token = await registerAndGetToken('heatmap_user', 'password123', 'Heatmap User');
    const { status, body } = await get('/learning/heatmap', token);
    expect(status).toBe(200);
    expect(body.code).toBe(ErrorCode.OK);
    expect(Array.isArray(body.data)).toBe(true);
    const data = body.data as { date: string; level: number; minutes: number; count: number }[];
    expect(data.length).toBeGreaterThan(0);
    expect(data[0].level).toBe(0);
    expect(data[0].minutes).toBe(0);
    expect(data[0].count).toBe(0);
  });

  it('GET /learning/heatmap?weeks=4 → 自定义周数', async () => {
    const token = await registerAndGetToken('heatmap_weeks_user', 'password123', 'Heatmap Weeks User');
    const { status, body } = await get('/learning/heatmap?weeks=4', token);
    expect(status).toBe(200);
    expect(body.code).toBe(ErrorCode.OK);
    const data = body.data as { date: string }[];
    expect(data.length).toBe(28);
  });
});

describe('Learning Module - lesson_block', () => {
  it('GET /learning/lessons/:courseId/next-block → 200 无块时返回 null', async () => {
    const token = await registerAndGetToken('block_user', 'password123', 'Block User');
    const { status, body } = await get('/learning/lessons/1/next-block', token);
    expect(status).toBe(200);
    expect(body.code).toBe(ErrorCode.OK);
    expect(body.data).toBeNull();
  });

  it('POST /learning/lessons/:blockId/consume → 404 不存在的块', async () => {
    const token = await registerAndGetToken('block_consume_user', 'password123', 'Block Consume User');
    const { status, body } = await post('/learning/lessons/99999/consume', {}, token);
    expect(status).toBe(404);
    expect(body.code).toBe(ErrorCode.RESOURCE_NOT_FOUND);
  });
});

describe('REQ-011 跨档案隔离（Learning）', () => {
  let tokenA: string;
  let tokenB: string;

  beforeAll(async () => {
    tokenA = await registerAndGetToken('isolation_learning_a', 'password123', 'Isolation A');
    tokenB = await registerAndGetToken('isolation_learning_b', 'password123', 'Isolation B');
  });

  it('A 创建 mastery → B 查询返回 null（不可见）', async () => {
    await patch('/learning/mastery', { wordId: 1, recognizeScore: 95 }, tokenA);
    const { status, body } = await get('/learning/mastery/1', tokenB);
    expect(status).toBe(200);
    expect(body.code).toBe(ErrorCode.OK);
    expect(body.data).toBeNull();
  });

  it('A 创建 mastery → B 的 mastery 列表为空', async () => {
    const { status, body } = await get('/learning/mastery', tokenB);
    expect(status).toBe(200);
    const data = body.data as { total: number; items: unknown[] };
    expect(data.total).toBe(0);
    expect(data.items.length).toBe(0);
  });

  it('A 创建 learning record → B 的 records 列表为空', async () => {
    await post('/learning/record', { kind: 'word_card', refType: 'word', refId: 1, score: 90 }, tokenA);
    const { status, body } = await get('/learning/records', tokenB);
    expect(status).toBe(200);
    const data = body.data as { total: number; items: unknown[] };
    expect(data.total).toBe(0);
    expect(data.items.length).toBe(0);
  });

  it('A 的数据不影响 B 的 today 概览（全零）', async () => {
    const { status, body } = await get('/learning/today', tokenB);
    expect(status).toBe(200);
    const data = body.data as { studyMinutes: number; newWords: number; reviews: number };
    expect(data.studyMinutes).toBe(0);
    expect(data.newWords).toBe(0);
    expect(data.reviews).toBe(0);
  });

  it('A 的数据不影响 B 的 streak（全零）', async () => {
    const { status, body } = await get('/learning/streak', tokenB);
    expect(status).toBe(200);
    const data = body.data as { currentDays: number; longestDays: number };
    expect(data.currentDays).toBe(0);
    expect(data.longestDays).toBe(0);
  });

  it('A 的数据不影响 B 的 heatmap（全零）', async () => {
    const { status, body } = await get('/learning/heatmap', tokenB);
    expect(status).toBe(200);
    const data = body.data as { level: number; minutes: number; count: number }[];
    data.forEach((entry) => {
      expect(entry.level).toBe(0);
      expect(entry.minutes).toBe(0);
      expect(entry.count).toBe(0);
    });
  });
});
