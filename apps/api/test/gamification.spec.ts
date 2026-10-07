import type { Server } from 'node:http';

import { type ApiResponse, ErrorCode } from '@eng-forge/contracts/api';
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
// Auth checks (no token → 401)
// ═══════════════════════════════════════════════════════════

describe('Gamification Module - 鉴权检查（无 token → 401）', () => {
  it('GET /gamification/badges 无 token → 401', async () => {
    const { status, body } = await get('/gamification/badges');
    expect(status).toBe(401);
    expect(body.code).toBe(ErrorCode.UNAUTHENTICATED);
  });

  it('POST /gamification/badges 无 token → 401', async () => {
    const { status, body } = await post('/gamification/badges', { code: 'streak_7' });
    expect(status).toBe(401);
    expect(body.code).toBe(ErrorCode.UNAUTHENTICATED);
  });

  it('GET /gamification/challenges/weekly 无 token → 401', async () => {
    const { status, body } = await get('/gamification/challenges/weekly');
    expect(status).toBe(401);
    expect(body.code).toBe(ErrorCode.UNAUTHENTICATED);
  });

  it('GET /gamification/challenges 无 token → 401', async () => {
    const { status, body } = await get('/gamification/challenges');
    expect(status).toBe(401);
    expect(body.code).toBe(ErrorCode.UNAUTHENTICATED);
  });

  it('GET /gamification/games 无 token → 401', async () => {
    const { status, body } = await get('/gamification/games');
    expect(status).toBe(401);
    expect(body.code).toBe(ErrorCode.UNAUTHENTICATED);
  });
});

// ═══════════════════════════════════════════════════════════
// Badges
// ═══════════════════════════════════════════════════════════

describe('Gamification Module - 徽章', () => {
  let token: string;

  beforeAll(async () => {
    token = await registerAndGetToken('gam_badges_user', 'password123', 'Gam Badges User');
  });

  it('GET /gamification/badges 新用户 → 200 空数组', async () => {
    const { status, body } = await get('/gamification/badges', token);
    expect(status).toBe(200);
    expect(body.code).toBe(ErrorCode.OK);
    expect(Array.isArray(body.data)).toBe(true);
    expect((body.data as unknown[]).length).toBe(0);
  });

  it('POST /gamification/badges → 201 授予徽章', async () => {
    const { status, body } = await post('/gamification/badges', { code: 'streak_7' }, token);
    expect(status).toBe(201);
    expect(body.code).toBe(ErrorCode.OK);
    const data = body.data as { code: string; earnedAt: string };
    expect(data.code).toBe('streak_7');
    expect(typeof data.earnedAt).toBe('string');
  });

  it('POST /gamification/badges 同一徽章 → 201 upsert 不重复', async () => {
    const { status, body } = await post('/gamification/badges', { code: 'streak_7' }, token);
    expect(status).toBe(201);
    expect(body.code).toBe(ErrorCode.OK);
    const data = body.data as { code: string };
    expect(data.code).toBe('streak_7');
  });

  it('GET /gamification/badges → 200 显示已授予徽章', async () => {
    const { status, body } = await get('/gamification/badges', token);
    expect(status).toBe(200);
    const data = body.data as { code: string }[];
    expect(data.length).toBe(1);
    expect(at(data, 0, 'gamification/badges').code).toBe('streak_7');
  });

  it('授予第二个不同徽章', async () => {
    const { status } = await post('/gamification/badges', { code: 'first_perfect' }, token);
    expect(status).toBe(201);

    const { status: s2, body: b2 } = await get('/gamification/badges', token);
    expect(s2).toBe(200);
    const data = b2.data as { code: string }[];
    expect(data.length).toBe(2);
  });
});

// ═══════════════════════════════════════════════════════════
// Weekly Challenge
// ═══════════════════════════════════════════════════════════

describe('Gamification Module - 每周挑战', () => {
  let token: string;
  let challengeId: number;

  beforeAll(async () => {
    token = await registerAndGetToken('gam_challenge_user', 'password123', 'Gam Challenge User');
  });

  it('GET /gamification/challenges/weekly 新用户 → 200 null', async () => {
    const { status, body } = await get('/gamification/challenges/weekly', token);
    expect(status).toBe(200);
    expect(body.code).toBe(ErrorCode.OK);
    expect(body.data).toBeNull();
  });

  it('POST /gamification/challenges → 201 创建挑战', async () => {
    const { status, body } = await post(
      '/gamification/challenges',
      { title: 'Weekly Challenge', metric: 'study_minutes', targetValue: 300 },
      token,
    );
    expect(status).toBe(201);
    expect(body.code).toBe(ErrorCode.OK);
    const data = body.data as { id: number; title: string; metric: string; targetValue: number; currentValue: number; status: string };
    challengeId = data.id;
    expect(data.title).toBe('Weekly Challenge');
    expect(data.metric).toBe('study_minutes');
    expect(data.targetValue).toBe(300);
    expect(data.status).toBe('ongoing');
    expect(data.currentValue).toBe(0);
  });

  it('GET /gamification/challenges/weekly → 200 返回本周挑战', async () => {
    const { status, body } = await get('/gamification/challenges/weekly', token);
    expect(status).toBe(200);
    const data = body.data as { id: number; title: string; status: string };
    expect(data.id).toBe(challengeId);
    expect(data.title).toBe('Weekly Challenge');
    expect(data.status).toBe('ongoing');
  });

  it('PATCH /gamification/challenges/:id/progress → 200 更新进度', async () => {
    const { status, body } = await patch(
      `/gamification/challenges/${challengeId}/progress`,
      { currentValue: 150 },
      token,
    );
    expect(status).toBe(200);
    const data = body.data as { currentValue: number; status: string };
    expect(data.currentValue).toBe(150);
    expect(data.status).toBe('ongoing');
  });

  it('PATCH 进度到目标值 → 200 自动标记 done', async () => {
    const { status, body } = await patch(
      `/gamification/challenges/${challengeId}/progress`,
      { currentValue: 300 },
      token,
    );
    expect(status).toBe(200);
    const data = body.data as { currentValue: number; status: string };
    expect(data.currentValue).toBe(300);
    expect(data.status).toBe('done');
  });

  it('GET /gamification/challenges → 200 列表', async () => {
    const { status, body } = await get('/gamification/challenges', token);
    expect(status).toBe(200);
    const data = body.data as { items: unknown[]; total: number; page: number; pageSize: number };
    expect(data.total).toBeGreaterThanOrEqual(1);
    expect(data.items.length).toBeGreaterThanOrEqual(1);
    expect(data.page).toBe(1);
    expect(data.pageSize).toBe(20);
  });

  it('GET /gamification/challenges?status=done → 按状态过滤', async () => {
    const { status, body } = await get('/gamification/challenges?status=done', token);
    expect(status).toBe(200);
    const data = body.data as { items: { status: string }[]; total: number };
    data.items.forEach((item) => expect(item.status).toBe('done'));
  });

  it('GET /gamification/challenges?status=ongoing → 按状态过滤', async () => {
    const { status, body } = await get('/gamification/challenges?status=ongoing', token);
    expect(status).toBe(200);
    const data = body.data as { items: { status: string }[]; total: number };
    data.items.forEach((item) => expect(item.status).toBe('ongoing'));
  });

  it('GET /gamification/challenges?page=1&pageSize=1 → 分页生效', async () => {
    const { status, body } = await get('/gamification/challenges?page=1&pageSize=1', token);
    expect(status).toBe(200);
    const data = body.data as { items: unknown[]; pageSize: number; totalPages: number };
    expect(data.items.length).toBe(1);
    expect(data.pageSize).toBe(1);
  });

  it('POST /gamification/challenges invalid metric → 400', async () => {
    const { status, body } = await post(
      '/gamification/challenges',
      { title: 'Bad', metric: 'invalid_metric', targetValue: 100 },
      token,
    );
    expect(status).toBe(400);
    expect(body.code).toBe(ErrorCode.VALIDATION_FAILED);
  });

  it('POST /gamification/challenges invalid targetValue → 400', async () => {
    const { status, body } = await post(
      '/gamification/challenges',
      { title: 'Bad', metric: 'study_minutes', targetValue: 0 },
      token,
    );
    expect(status).toBe(400);
    expect(body.code).toBe(ErrorCode.VALIDATION_FAILED);
  });

  it('PATCH /gamification/challenges/99999/progress → 404', async () => {
    const { status, body } = await patch(
      '/gamification/challenges/99999/progress',
      { currentValue: 50 },
      token,
    );
    expect(status).toBe(404);
    expect(body.code).toBe(ErrorCode.RESOURCE_NOT_FOUND);
  });
});

// ═══════════════════════════════════════════════════════════
// Game Records
// ═══════════════════════════════════════════════════════════

describe('Gamification Module - 游戏记录', () => {
  let token: string;

  beforeAll(async () => {
    token = await registerAndGetToken('gam_games_user', 'password123', 'Gam Games User');
  });

  it('POST /gamification/games → 201 提交游戏成绩', async () => {
    const { status, body } = await post(
      '/gamification/games',
      { gameCode: 'word_shooter', score: 100, comboMax: 5 },
      token,
    );
    expect(status).toBe(201);
    const data = body.data as { id: number; gameCode: string; score: number; comboMax: number };
    expect(data.gameCode).toBe('word_shooter');
    expect(data.score).toBe(100);
    expect(data.comboMax).toBe(5);
  });

  it('POST /gamification/games 第二次 → 201 创建第二条记录', async () => {
    const { status } = await post(
      '/gamification/games',
      { gameCode: 'word_shooter', score: 200, comboMax: 10 },
      token,
    );
    expect(status).toBe(201);
  });

  it('POST /gamification/games spell_truck → 201', async () => {
    const { status } = await post(
      '/gamification/games',
      { gameCode: 'spell_truck', score: 150, comboMax: 3 },
      token,
    );
    expect(status).toBe(201);
  });

  it('GET /gamification/games → 200 列表', async () => {
    const { status, body } = await get('/gamification/games', token);
    expect(status).toBe(200);
    const data = body.data as { items: unknown[]; total: number; page: number; pageSize: number };
    expect(data.total).toBe(3);
    expect(data.items.length).toBe(3);
    expect(data.page).toBe(1);
    expect(data.pageSize).toBe(20);
  });

  it('GET /gamification/games?gameCode=word_shooter → 按游戏类型过滤', async () => {
    const { status, body } = await get('/gamification/games?gameCode=word_shooter', token);
    expect(status).toBe(200);
    const data = body.data as { items: { gameCode: string }[]; total: number };
    expect(data.total).toBe(2);
    data.items.forEach((item) => expect(item.gameCode).toBe('word_shooter'));
  });

  it('GET /gamification/games?sortBy=score → 按分数排序', async () => {
    const { status, body } = await get('/gamification/games?sortBy=score', token);
    expect(status).toBe(200);
    const data = body.data as { items: { score: number }[] };
    const first = at(data.items, 0, 'games?sortBy=score');
    const last = at(data.items, data.items.length - 1, 'games?sortBy=score');
    expect(first.score).toBeGreaterThanOrEqual(last.score);
  });

  it('GET /gamification/games?page=1&pageSize=2 → 分页', async () => {
    const { status, body } = await get('/gamification/games?page=1&pageSize=2', token);
    expect(status).toBe(200);
    const data = body.data as { items: unknown[]; total: number; pageSize: number; totalPages: number };
    expect(data.items.length).toBe(2);
    expect(data.total).toBe(3);
    expect(data.pageSize).toBe(2);
    expect(data.totalPages).toBe(2);
  });

  it('POST /gamification/games invalid gameCode → 400', async () => {
    const { status, body } = await post(
      '/gamification/games',
      { gameCode: 'invalid_game', score: 100 },
      token,
    );
    expect(status).toBe(400);
    expect(body.code).toBe(ErrorCode.VALIDATION_FAILED);
  });

  it('POST /gamification/games negative score → 400', async () => {
    const { status, body } = await post(
      '/gamification/games',
      { gameCode: 'word_shooter', score: -10 },
      token,
    );
    expect(status).toBe(400);
    expect(body.code).toBe(ErrorCode.VALIDATION_FAILED);
  });
});

// ═══════════════════════════════════════════════════════════
// Leaderboard (cross-user)
// ═══════════════════════════════════════════════════════════

describe('Gamification Module - 排行榜（跨用户）', () => {
  let tokenA: string;
  let tokenB: string;

  beforeAll(async () => {
    tokenA = await registerAndGetToken('gam_leader_a', 'password123', 'Leader A');
    tokenB = await registerAndGetToken('gam_leader_b', 'password123', 'Leader B');
    await post('/gamification/games', { gameCode: 'word_shooter', score: 100, comboMax: 3 }, tokenA);
    await post('/gamification/games', { gameCode: 'word_shooter', score: 250, comboMax: 8 }, tokenA);
    await post('/gamification/games', { gameCode: 'word_shooter', score: 180, comboMax: 5 }, tokenB);
  });

  it('GET /gamification/games/word_shooter/leaderboard → 200 排行榜', async () => {
    const { status, body } = await get('/gamification/games/word_shooter/leaderboard', tokenA);
    expect(status).toBe(200);
    const data = body.data as { rank: number; score: number; comboMax: number }[];
    expect(data.length).toBeGreaterThanOrEqual(3);
    expect(at(data, 0, 'games leaderboard').rank).toBe(1);
    expect(at(data, 0, 'games leaderboard').score).toBeGreaterThanOrEqual(at(data, 1, 'games leaderboard').score);
  });

  it('GET /gamification/games/word_shooter/leaderboard 按分数降序', async () => {
    const { body } = await get('/gamification/games/word_shooter/leaderboard', tokenA);
    const data = body.data as { score: number }[];
    for (let i = 1; i < data.length; i++) {
      expect(data[i - 1]!.score).toBeGreaterThanOrEqual(data[i]!.score);
    }
  });

  it('GET /gamification/games/spell_truck/leaderboard → 200 空排行榜', async () => {
    const { status, body } = await get('/gamification/games/spell_truck/leaderboard', tokenA);
    expect(status).toBe(200);
    expect(Array.isArray(body.data)).toBe(true);
    expect((body.data as unknown[]).length).toBe(0);
  });

  it('GET /gamification/games/invalid/leaderboard → 400', async () => {
    const { status, body } = await get('/gamification/games/invalid/leaderboard', tokenA);
    expect(status).toBe(400);
    expect(body.code).toBe(ErrorCode.VALIDATION_FAILED);
  });

  it('GET /gamification/games/word_shooter/leaderboard 无 token → 401', async () => {
    const { status, body } = await get('/gamification/games/word_shooter/leaderboard');
    expect(status).toBe(401);
    expect(body.code).toBe(ErrorCode.UNAUTHENTICATED);
  });
});

// ═══════════════════════════════════════════════════════════
// Cross-profile isolation
// ═══════════════════════════════════════════════════════════

describe('Gamification Module - 跨档案隔离', () => {
  let tokenA: string;
  let tokenB: string;

  beforeAll(async () => {
    tokenA = await registerAndGetToken('gam_iso_a', 'password123', 'Iso A');
    tokenB = await registerAndGetToken('gam_iso_b', 'password123', 'Iso B');
    await post('/gamification/badges', { code: 'iso_badge_a' }, tokenA);
    await post('/gamification/games', { gameCode: 'miner', score: 500, comboMax: 15 }, tokenA);
  });

  it('A 的徽章对 B 不可见', async () => {
    const { body } = await get('/gamification/badges', tokenB);
    const data = body.data as { code: string }[];
    expect(data.length).toBe(0);
  });

  it('A 的游戏记录对 B 不可见', async () => {
    const { body } = await get('/gamification/games', tokenB);
    const data = body.data as { items: unknown[]; total: number };
    expect(data.total).toBe(0);
  });

  it('A 的挑战对 B 不可见', async () => {
    const { body } = await get('/gamification/challenges', tokenB);
    const data = body.data as { items: unknown[]; total: number };
    expect(data.total).toBe(0);
  });

  it('排行榜是跨用户的（B 可以看到 A 的记录）', async () => {
    const { body } = await get('/gamification/games/miner/leaderboard', tokenB);
    const data = body.data as { score: number }[];
    expect(data.length).toBeGreaterThanOrEqual(1);
  });
});
