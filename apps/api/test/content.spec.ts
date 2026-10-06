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
  await seedTestData();
});

afterAll(async () => {
  await app?.close();
  cleanup?.();
});

async function seedTestData(): Promise<void> {
  const raw = (app.get(DbConnection).client as unknown as { raw: { exec: (sql: string) => unknown } }).raw;
  raw.exec(`
    INSERT INTO stage (code, name_zh, name_en, sort_order) VALUES ('primary', '小学', 'Primary', 1);
    INSERT INTO textbook (stage_id, code, name_zh) VALUES (1, 'pep', '人教版');
    INSERT INTO volume (textbook_id, code, name_zh, sort_order) VALUES (1, 'v1', '第一册', 1);
    INSERT INTO unit (volume_id, code, name_zh, sort_order) VALUES (1, 'u1', 'Unit 1', 1);
    INSERT INTO word (headword, lemma, pos, translation_zh, license, source, is_active, is_verb, exam_tags, cefr_level, frequency_band, frequency_rank)
      VALUES ('apple', 'apple', 'n', '苹果', 'CC-BY-4.0', 'builtin', 1, 0, '[]', 'A1', '超高', 10);
    INSERT INTO word (headword, lemma, pos, translation_zh, license, source, is_active, is_verb, exam_tags, cefr_level, frequency_band, frequency_rank)
      VALUES ('banana', 'banana', 'n', '香蕉', 'CC-BY-4.0', 'builtin', 1, 0, '[]', 'A2', '高', 50);
    INSERT INTO word (headword, lemma, pos, translation_zh, license, source, is_active, is_verb, exam_tags, cefr_level, frequency_band, frequency_rank)
      VALUES ('run', 'run', 'v', '跑', 'CC-BY-4.0', 'builtin', 1, 1, '[]', 'A1', '超高', 5);
    INSERT INTO word (headword, lemma, pos, translation_zh, license, source, is_active, is_verb, exam_tags, cefr_level, frequency_band, frequency_rank)
      VALUES ('happy', 'happy', 'adj', '快乐的', 'CC-BY-4.0', 'builtin', 1, 0, '[]', 'A2', '高', 100);
    INSERT INTO word (headword, lemma, pos, translation_zh, license, source, is_active, is_verb, exam_tags, cefr_level, frequency_band, frequency_rank)
      VALUES ('the', 'the', 'art', '这/那', 'CC-BY-4.0', 'builtin', 1, 0, '[]', 'A1', '超高', 1);
    INSERT INTO word_unit (unit_id, word_id, sort_order, is_required) VALUES (1, 1, 1, 1);
    INSERT INTO word_unit (unit_id, word_id, sort_order, is_required) VALUES (1, 2, 2, 1);
    INSERT INTO word_unit (unit_id, word_id, sort_order, is_required) VALUES (1, 3, 3, 0);
    INSERT INTO sentence (text, translation_zh, license, source_kind, word_count, char_count, difficulty)
      VALUES ('I like apples.', '我喜欢苹果。', 'CC-BY-4.0', 'course', 3, 12, 0.50);
  `);
}

async function get(path: string, token?: string): Promise<{ status: number; body: ApiResponse<unknown> }> {
  const res = await fetch(`${baseUrl}${path}`, {
    headers: token ? { authorization: `Bearer ${token}` } : {},
  });
  return { status: res.status, body: (await res.json()) as ApiResponse<unknown> };
}

describe('Content Module - 词条列表 GET /words', () => {
  it('默认分页返回所有活跃词条', async () => {
    const { status, body } = await get('/words');
    expect(status).toBe(200);
    expect(body.code).toBe(ErrorCode.OK);
    const data = body.data as { items: unknown[]; total: number; page: number; pageSize: number; totalPages: number };
    expect(data.total).toBe(5);
    expect(data.items.length).toBe(5);
    expect(data.page).toBe(1);
    expect(data.pageSize).toBe(20);
    expect(data.totalPages).toBe(1);
  });

  it('分页参数 page/pageSize 生效', async () => {
    const { status, body } = await get('/words?page=1&pageSize=3');
    expect(status).toBe(200);
    expect(body.code).toBe(ErrorCode.OK);
    const data = body.data as { items: unknown[]; total: number; page: number; pageSize: number; totalPages: number };
    expect(data.items.length).toBe(3);
    expect(data.total).toBe(5);
    expect(data.page).toBe(1);
    expect(data.pageSize).toBe(3);
    expect(data.totalPages).toBe(2);
  });

  it('search 按 headword/lemma 搜索', async () => {
    const { status, body } = await get('/words?search=apple');
    expect(status).toBe(200);
    expect(body.code).toBe(ErrorCode.OK);
    const data = body.data as { items: { headword: string }[]; total: number };
    expect(data.total).toBe(1);
    expect(data.items[0].headword).toBe('apple');
  });

  it('search 按 translationZh 中文搜索', async () => {
    const { status, body } = await get('/words?search=' + encodeURIComponent('苹果'));
    expect(status).toBe(200);
    expect(body.code).toBe(ErrorCode.OK);
    const data = body.data as { items: { headword: string }[]; total: number };
    expect(data.total).toBe(1);
    expect(data.items[0].headword).toBe('apple');
  });

  it('search 无匹配 → 空结果', async () => {
    const { status, body } = await get('/words?search=nonexistent_xyz');
    expect(status).toBe(200);
    expect(body.code).toBe(ErrorCode.OK);
    const data = body.data as { items: unknown[]; total: number };
    expect(data.total).toBe(0);
    expect(data.items.length).toBe(0);
  });

  it('pos 过滤词性', async () => {
    const { status, body } = await get('/words?pos=v');
    expect(status).toBe(200);
    expect(body.code).toBe(ErrorCode.OK);
    const data = body.data as { items: { pos: string }[]; total: number };
    expect(data.total).toBe(1);
    expect(data.items[0].pos).toBe('v');
  });

  it('cefrLevel 过滤 CEFR 等级', async () => {
    const { status, body } = await get('/words?cefrLevel=A1');
    expect(status).toBe(200);
    expect(body.code).toBe(ErrorCode.OK);
    const data = body.data as { items: { cefrLevel: string }[]; total: number };
    expect(data.total).toBe(3);
    data.items.forEach((item) => expect(item.cefrLevel).toBe('A1'));
  });

  it('frequencyBand 过滤词频分级', async () => {
    const { status, body } = await get('/words?frequencyBand=' + encodeURIComponent('超高'));
    expect(status).toBe(200);
    expect(body.code).toBe(ErrorCode.OK);
    const data = body.data as { items: { frequencyBand: string }[]; total: number };
    expect(data.total).toBe(3);
    data.items.forEach((item) => expect(item.frequencyBand).toBe('超高'));
  });

  it('unitId 过滤单元内词条', async () => {
    const { status, body } = await get('/words?unitId=1');
    expect(status).toBe(200);
    expect(body.code).toBe(ErrorCode.OK);
    const data = body.data as { items: unknown[]; total: number };
    expect(data.total).toBe(3);
    expect(data.items.length).toBe(3);
  });

  it('sortBy=alphabetical 按字母排序', async () => {
    const { status, body } = await get('/words?sortBy=alphabetical');
    expect(status).toBe(200);
    expect(body.code).toBe(ErrorCode.OK);
    const data = body.data as { items: { headword: string }[] };
    expect(data.items[0].headword).toBe('apple');
    expect(data.items[4].headword).toBe('the');
  });

  it('sortBy=frequency 按词频排序', async () => {
    const { status, body } = await get('/words?sortBy=frequency');
    expect(status).toBe(200);
    expect(body.code).toBe(ErrorCode.OK);
    const data = body.data as { items: { headword: string }[] };
    expect(data.items[0].headword).toBe('the');
    expect(data.items[4].headword).toBe('happy');
  });

  it('sortBy=updatedAt 返回 200', async () => {
    const { status, body } = await get('/words?sortBy=updatedAt');
    expect(status).toBe(200);
    expect(body.code).toBe(ErrorCode.OK);
  });
});

describe('Content Module - 词条详情 GET /words/:id', () => {
  it('有效 id → 200 + 词条详情', async () => {
    const { status, body } = await get('/words/1');
    expect(status).toBe(200);
    expect(body.code).toBe(ErrorCode.OK);
    const data = body.data as { id: number; headword: string; lemma: string; source: string };
    expect(data.id).toBe(1);
    expect(data.headword).toBe('apple');
    expect(data.lemma).toBe('apple');
    expect(data.source).toBe('builtin');
  });

  it('无效 id → 404 WORD_NOT_FOUND', async () => {
    const { status, body } = await get('/words/99999');
    expect(status).toBe(404);
    expect(body.code).toBe(ErrorCode.WORD_NOT_FOUND);
    expect(body.data).toBeNull();
  });

  it('非数字 id → 400 VALIDATION_FAILED', async () => {
    const { status, body } = await get('/words/abc');
    expect(status).toBe(400);
    expect(body.code).toBe(ErrorCode.VALIDATION_FAILED);
  });
});

describe('Content Module - 词条例句 GET /words/:id/examples', () => {
  it('有效 id → 200 + 例句数组（含匹配）', async () => {
    const { status, body } = await get('/words/1/examples');
    expect(status).toBe(200);
    expect(body.code).toBe(ErrorCode.OK);
    expect(Array.isArray(body.data)).toBe(true);
    const data = body.data as { id: number; text: string }[];
    expect(data.length).toBe(1);
    expect(data[0].text).toBe('I like apples.');
  });

  it('有效 id 但无匹配例句 → 200 + 空数组', async () => {
    const { status, body } = await get('/words/2/examples');
    expect(status).toBe(200);
    expect(body.code).toBe(ErrorCode.OK);
    expect(Array.isArray(body.data)).toBe(true);
    expect((body.data as unknown[]).length).toBe(0);
  });

  it('无效 id → 404 WORD_NOT_FOUND', async () => {
    const { status, body } = await get('/words/99999/examples');
    expect(status).toBe(404);
    expect(body.code).toBe(ErrorCode.WORD_NOT_FOUND);
    expect(body.data).toBeNull();
  });
});

describe('Content Module - 例句列表 GET /words/sentences', () => {
  it('默认分页返回例句', async () => {
    const { status, body } = await get('/words/sentences');
    expect(status).toBe(200);
    expect(body.code).toBe(ErrorCode.OK);
    const data = body.data as { items: { text: string; sourceKind: string }[]; total: number };
    expect(data.total).toBe(1);
    expect(data.items.length).toBe(1);
    expect(data.items[0].text).toBe('I like apples.');
    expect(data.items[0].sourceKind).toBe('course');
  });

  it('分页参数生效', async () => {
    const { status, body } = await get('/words/sentences?page=1&pageSize=1');
    expect(status).toBe(200);
    expect(body.code).toBe(ErrorCode.OK);
    const data = body.data as { items: unknown[]; total: number; page: number; pageSize: number };
    expect(data.items.length).toBe(1);
    expect(data.total).toBe(1);
    expect(data.page).toBe(1);
    expect(data.pageSize).toBe(1);
  });
});

describe('Content Module - 单元词条 GET /words/units/:unitId', () => {
  it('有效 unitId → 200 + 词条数组', async () => {
    const { status, body } = await get('/words/units/1');
    expect(status).toBe(200);
    expect(body.code).toBe(ErrorCode.OK);
    expect(Array.isArray(body.data)).toBe(true);
    const data = body.data as { headword: string; sortOrder: number; isRequired: boolean }[];
    expect(data.length).toBe(3);
    expect(data[0].headword).toBe('apple');
    expect(data[0].sortOrder).toBe(1);
    expect(data[0].isRequired).toBe(true);
  });

  it('不存在的 unitId → 200 + 空数组', async () => {
    const { status, body } = await get('/words/units/99999');
    expect(status).toBe(200);
    expect(body.code).toBe(ErrorCode.OK);
    expect(Array.isArray(body.data)).toBe(true);
    expect((body.data as unknown[]).length).toBe(0);
  });
});

describe('Content Module - @Public 无需鉴权', () => {
  it('无 token 访问 /words → 200', async () => {
    const { status } = await get('/words');
    expect(status).toBe(200);
  });

  it('无 token 访问 /words/:id → 200', async () => {
    const { status } = await get('/words/1');
    expect(status).toBe(200);
  });

  it('无 token 访问 /words/sentences → 200', async () => {
    const { status } = await get('/words/sentences');
    expect(status).toBe(200);
  });

  it('有 token 访问 → 200（不影响）', async () => {
    const res = await fetch(`${baseUrl}/auth/register`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        username: 'content_public_user',
        password: 'password123',
        displayName: 'Content User',
        role: 'student',
      }),
    });
    const data = await res.json();
    const token = data.data.accessToken;
    const { status } = await get('/words', token);
    expect(status).toBe(200);
  });
});

describe('Content Module - 参数校验', () => {
  it('page=0 → 400 VALIDATION_FAILED', async () => {
    const { status, body } = await get('/words?page=0');
    expect(status).toBe(400);
    expect(body.code).toBe(ErrorCode.VALIDATION_FAILED);
  });

  it('pageSize=0 → 400 VALIDATION_FAILED', async () => {
    const { status, body } = await get('/words?pageSize=0');
    expect(status).toBe(400);
    expect(body.code).toBe(ErrorCode.VALIDATION_FAILED);
  });

  it('sortBy=invalid → 400 VALIDATION_FAILED', async () => {
    const { status, body } = await get('/words?sortBy=invalid');
    expect(status).toBe(400);
    expect(body.code).toBe(ErrorCode.VALIDATION_FAILED);
  });

  it('sortDir=invalid → 400 VALIDATION_FAILED', async () => {
    const { status, body } = await get('/words?sortDir=invalid');
    expect(status).toBe(400);
    expect(body.code).toBe(ErrorCode.VALIDATION_FAILED);
  });
});
