import type { Server } from 'node:http';

import { type ApiResponse, ErrorCode } from '@eng-forge/contracts/api';
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

describe('Report Module - 鉴权检查（无 token → 401）', () => {
  it('GET /report/weekly 无 token → 401', async () => {
    const { status, body } = await get('/report/weekly?weekStart=2025-10-06');
    expect(status).toBe(401);
    expect(body.code).toBe(ErrorCode.UNAUTHENTICATED);
  });

  it('GET /report/monthly 无 token → 401', async () => {
    const { status, body } = await get('/report/monthly?year=2025&month=10');
    expect(status).toBe(401);
    expect(body.code).toBe(ErrorCode.UNAUTHENTICATED);
  });

  it('GET /report/export/csv 无 token → 401', async () => {
    const { status, body } = await get('/report/export/csv?type=learning_records');
    expect(status).toBe(401);
    expect(body.code).toBe(ErrorCode.UNAUTHENTICATED);
  });
});

// ═══════════════════════════════════════════════════════════
// Weekly Report
// ═══════════════════════════════════════════════════════════

describe('Report Module - 周报告', () => {
  let token: string;

  beforeAll(async () => {
    token = await registerAndGetToken('report_weekly_user', 'password123', 'Report Weekly User');
  });

  it('GET /report/weekly 新用户 → 200 全零数据', async () => {
    const { status, body } = await get('/report/weekly?weekStart=2025-10-06', token);
    expect(status).toBe(200);
    expect(body.code).toBe(ErrorCode.OK);
    const data = body.data as {
      weekStart: string;
      weekEnd: string;
      totalStudyMinutes: number;
      totalNewWords: number;
      totalReviews: number;
      totalErrors: number;
      avgDailyScore: number;
      correctRate: number;
      dailyBreakdown: unknown[];
      topMasteryWords: unknown[];
    };
    expect(data.weekStart).toBe('2025-10-06');
    expect(data.weekEnd).toBe('2025-10-12');
    expect(data.totalStudyMinutes).toBe(0);
    expect(data.totalNewWords).toBe(0);
    expect(data.totalReviews).toBe(0);
    expect(data.totalErrors).toBe(0);
    expect(data.avgDailyScore).toBe(0);
    expect(data.correctRate).toBe(0);
    expect(Array.isArray(data.dailyBreakdown)).toBe(true);
    expect(data.dailyBreakdown.length).toBe(7);
    expect(Array.isArray(data.topMasteryWords)).toBe(true);
  });

  it('GET /report/weekly 结构完整', async () => {
    const { body } = await get('/report/weekly?weekStart=2025-10-06', token);
    const data = body.data as Record<string, unknown>;
    expect(data).toHaveProperty('weekStart');
    expect(data).toHaveProperty('weekEnd');
    expect(data).toHaveProperty('totalStudyMinutes');
    expect(data).toHaveProperty('totalNewWords');
    expect(data).toHaveProperty('totalReviews');
    expect(data).toHaveProperty('totalErrors');
    expect(data).toHaveProperty('avgDailyScore');
    expect(data).toHaveProperty('correctRate');
    expect(data).toHaveProperty('dailyBreakdown');
    expect(data).toHaveProperty('topMasteryWords');
  });

  it('GET /report/weekly invalid weekStart format → 400', async () => {
    const { status, body } = await get('/report/weekly?weekStart=invalid', token);
    expect(status).toBe(400);
    expect(body.code).toBe(ErrorCode.VALIDATION_FAILED);
  });

  it('GET /report/weekly missing weekStart → 400', async () => {
    const { status, body } = await get('/report/weekly', token);
    expect(status).toBe(400);
    expect(body.code).toBe(ErrorCode.VALIDATION_FAILED);
  });
});

// ═══════════════════════════════════════════════════════════
// Monthly Report
// ═══════════════════════════════════════════════════════════

describe('Report Module - 月报告', () => {
  let token: string;

  beforeAll(async () => {
    token = await registerAndGetToken('report_monthly_user', 'password123', 'Report Monthly User');
  });

  it('GET /report/monthly 新用户 → 200 全零数据', async () => {
    const { status, body } = await get('/report/monthly?year=2025&month=10', token);
    expect(status).toBe(200);
    expect(body.code).toBe(ErrorCode.OK);
    const data = body.data as {
      year: number;
      month: number;
      totalStudyMinutes: number;
      totalNewWords: number;
      totalReviews: number;
      totalErrors: number;
      avgDailyScore: number;
      correctRate: number;
      studyDays: number;
      longestStreak: number;
      weeklyBreakdown: unknown[];
    };
    expect(data.year).toBe(2025);
    expect(data.month).toBe(10);
    expect(data.totalStudyMinutes).toBe(0);
    expect(data.totalNewWords).toBe(0);
    expect(data.totalReviews).toBe(0);
    expect(data.totalErrors).toBe(0);
    expect(data.avgDailyScore).toBe(0);
    expect(data.correctRate).toBe(0);
    expect(data.studyDays).toBe(0);
    expect(data.longestStreak).toBe(0);
    expect(Array.isArray(data.weeklyBreakdown)).toBe(true);
  });

  it('GET /report/monthly 结构完整', async () => {
    const { body } = await get('/report/monthly?year=2025&month=10', token);
    const data = body.data as Record<string, unknown>;
    expect(data).toHaveProperty('year');
    expect(data).toHaveProperty('month');
    expect(data).toHaveProperty('totalStudyMinutes');
    expect(data).toHaveProperty('totalNewWords');
    expect(data).toHaveProperty('totalReviews');
    expect(data).toHaveProperty('totalErrors');
    expect(data).toHaveProperty('avgDailyScore');
    expect(data).toHaveProperty('correctRate');
    expect(data).toHaveProperty('studyDays');
    expect(data).toHaveProperty('longestStreak');
    expect(data).toHaveProperty('weeklyBreakdown');
  });

  it('GET /report/monthly invalid year → 400', async () => {
    const { status, body } = await get('/report/monthly?year=1900&month=10', token);
    expect(status).toBe(400);
    expect(body.code).toBe(ErrorCode.VALIDATION_FAILED);
  });

  it('GET /report/monthly invalid month → 400', async () => {
    const { status, body } = await get('/report/monthly?year=2025&month=13', token);
    expect(status).toBe(400);
    expect(body.code).toBe(ErrorCode.VALIDATION_FAILED);
  });

  it('GET /report/monthly missing params → 400', async () => {
    const { status, body } = await get('/report/monthly', token);
    expect(status).toBe(400);
    expect(body.code).toBe(ErrorCode.VALIDATION_FAILED);
  });
});

// ═══════════════════════════════════════════════════════════
// CSV Export
// ═══════════════════════════════════════════════════════════

describe('Report Module - CSV 导出', () => {
  let token: string;
  let userId: number;

  beforeAll(async () => {
    token = await registerAndGetToken('report_csv_user', 'password123', 'Report CSV User');
    userId = await getUserId(token);
  });

  it('GET /report/export/csv?type=learning_records → 200 CSV 字符串', async () => {
    const { status, body } = await get('/report/export/csv?type=learning_records', token);
    expect(status).toBe(200);
    expect(body.code).toBe(ErrorCode.OK);
    const data = body.data as { filename: string; content: string; rowCount: number };
    expect(typeof data.filename).toBe('string');
    expect(data.filename).toContain('learning_records');
    expect(data.filename).toContain('.csv');
    expect(typeof data.content).toBe('string');
    expect(data.rowCount).toBe(0);
  });

  it('GET /report/export/csv?type=learning_records CSV 包含表头', async () => {
    const { body } = await get('/report/export/csv?type=learning_records', token);
    const data = body.data as { content: string };
    expect(data.content).toContain('id');
    expect(data.content).toContain('kind');
    expect(data.content).toContain('createdAt');
  });

  it('GET /report/export/csv?type=word_mastery → 200 CSV 字符串', async () => {
    const { status, body } = await get('/report/export/csv?type=word_mastery', token);
    expect(status).toBe(200);
    const data = body.data as { filename: string; content: string; rowCount: number };
    expect(data.filename).toContain('word_mastery');
    expect(data.filename).toContain('.csv');
    expect(typeof data.content).toBe('string');
    expect(data.rowCount).toBe(0);
  });

  it('GET /report/export/csv?type=word_mastery CSV 包含表头', async () => {
    const { body } = await get('/report/export/csv?type=word_mastery', token);
    const data = body.data as { content: string };
    expect(data.content).toContain('wordId');
    expect(data.content).toContain('overallScore');
    expect(data.content).toContain('totalAttempts');
  });

  it('GET /report/export/csv with date range → 200', async () => {
    const { status, body } = await get(
      '/report/export/csv?type=learning_records&startDate=2025-10-01&endDate=2025-10-31',
      token,
    );
    expect(status).toBe(200);
    const data = body.data as { filename: string; content: string; rowCount: number };
    expect(typeof data.filename).toBe('string');
    expect(typeof data.content).toBe('string');
  });

  it('GET /report/export/csv invalid type → 400', async () => {
    const { status, body } = await get('/report/export/csv?type=invalid', token);
    expect(status).toBe(400);
    expect(body.code).toBe(ErrorCode.VALIDATION_FAILED);
  });

  it('GET /report/export/csv missing type → 400', async () => {
    const { status, body } = await get('/report/export/csv', token);
    expect(status).toBe(400);
    expect(body.code).toBe(ErrorCode.VALIDATION_FAILED);
  });

  it('GET /report/export/csv invalid date format → 400', async () => {
    const { status, body } = await get('/report/export/csv?type=learning_records&startDate=invalid', token);
    expect(status).toBe(400);
    expect(body.code).toBe(ErrorCode.VALIDATION_FAILED);
  });
});

// ═══════════════════════════════════════════════════════════
// CSV Export with seeded data
// ═══════════════════════════════════════════════════════════

describe('Report Module - CSV 导出（含数据）', () => {
  let token: string;

  beforeAll(async () => {
    token = await registerAndGetToken('report_csv_seeded', 'password123', 'Report CSV Seeded');
    const userId = await getUserId(token);
    const raw = (app.get(DbConnection).client as unknown as { raw: { exec: (sql: string) => unknown } }).raw;
    raw.exec(`
      INSERT INTO daily_stat (user_id, stat_date, study_minutes, new_words, reviews, avg_score, correct_rate, error_count)
      VALUES (${userId}, '2025-10-06', 30, 5, 10, '75.5', '0.85', 2);
      INSERT INTO daily_stat (user_id, stat_date, study_minutes, new_words, reviews, avg_score, correct_rate, error_count)
      VALUES (${userId}, '2025-10-07', 45, 3, 8, '82.0', '0.90', 1);
    `);
  });

  it('GET /report/weekly 有数据时返回汇总', async () => {
    const { status, body } = await get('/report/weekly?weekStart=2025-10-06', token);
    expect(status).toBe(200);
    const data = body.data as {
      totalStudyMinutes: number;
      totalNewWords: number;
      totalReviews: number;
      totalErrors: number;
    };
    expect(data.totalStudyMinutes).toBe(75);
    expect(data.totalNewWords).toBe(8);
    expect(data.totalReviews).toBe(18);
    expect(data.totalErrors).toBe(3);
  });

  it('GET /report/monthly 有数据时返回汇总', async () => {
    const { status, body } = await get('/report/monthly?year=2025&month=10', token);
    expect(status).toBe(200);
    const data = body.data as {
      totalStudyMinutes: number;
      studyDays: number;
    };
    expect(data.totalStudyMinutes).toBe(75);
    expect(data.studyDays).toBe(2);
  });

  it('GET /report/export/csv?type=learning_records 有数据时包含数据行', async () => {
    const userId = await getUserId(token);
    const raw = (app.get(DbConnection).client as unknown as { raw: { exec: (sql: string) => unknown } }).raw;
    raw.exec(`
      INSERT INTO learning_record (user_id, kind, ref_type, is_correct, score, duration_ms, created_at)
      VALUES (${userId}, 'reading', 'word', 1, '90.0', 5000, '2025-10-06T10:00:00Z');
    `);
    const { status, body } = await get('/report/export/csv?type=learning_records', token);
    expect(status).toBe(200);
    const data = body.data as { content: string; rowCount: number };
    expect(data.rowCount).toBe(1);
    const lines = data.content.split('\n');
    expect(lines.length).toBeGreaterThanOrEqual(2);
  });
});
