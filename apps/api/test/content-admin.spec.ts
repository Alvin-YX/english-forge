/**
 * `words-admin` 词库管理接口（批量导入 / 停用恢复 / 管理端列表）
 *
 * 这一组接口的红线有三条，全在这里断言：
 *   1. 写权限只有 admin：四条路由非 admin 一律 403
 *   2. 版权红线：CSV 导入必须有 `license`，不能省
 *   3. 停用不物理删除：停用的词从公开词库、详情里消失，但 admin 侧仍然可见并可恢复
 *
 * 公开词库 `GET /words` 是**只读、无写入接口**（见 `content.controller.ts` 头注释），
 * 词库的所有写路径都集中在本文件的 `words-admin`，所以这里也把两条路径的隔离断言写进来。
 *
 * 用例顺序是有意的：先跑纯权限与参数校验，再跑导入，最后跑停用 ——
 * 前面的用例不依赖后面写入的词库状态。
 */

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

/** multipart 上传：`FormData` 自带 boundary，测试里不需要手拼 */
async function upload(path: string, form: FormData, token?: string): Promise<{ status: number; body: ApiResponse<unknown> }> {
  const headers = new Headers();
  if (token !== undefined) headers.set('authorization', `Bearer ${token}`);
  const res = await fetch(`${baseUrl}${path}`, { method: 'POST', headers, body: form });
  return { status: res.status, body: (await res.json()) as ApiResponse<unknown> };
}

async function registerAndGetToken(username: string, password: string, displayName: string, role: Role) {
  const { status, body } = await post('/auth/register', { username, password, displayName, role });
  expect(status).toBe(201);
  return (body.data as { accessToken: string }).accessToken;
}

/** ECDICT 列序：word, phonetic, definition, translation, pos, collins, oxford, tag */
const HEADER = 'word,phonetic,definition,translation,pos,collins,oxford,tag';

/** 首次导入用的 CSV：含引号内逗号、文件内重复行、无效行 —— 三种跳过路径都要覆盖 */
const FIRST_CSV = [
  HEADER,
  'zapapple,"IPA /ˈæləpəl/ ; US /ˈæləpəl/","a round fruit with red or green skin","一种圆形水果，有红色或绿色的果皮","n.",3,"","cet4"',
  'zapcomma,"/ˈkʌmə/","the comma","逗号","n.",2,"","ky"',
  'zapdup,n.,first,一,v.,4,"","toefl"',
  'zapdup,n.,second,二,v.,4,"","toefl"',
  ',,,,"n.",0,"",""',
].join('\n');

/** 重复导入用的 CSV：与首次导入的三条有效词条完全重复 */
const REPEAT_CSV = [
  HEADER,
  'zapapple,,"a round fruit","一种圆形水果","n.",3,"","cet4"',
  'zapcomma,"/ˈkʌmə/","the comma","逗号","n.",2,"","ky"',
  'zapdup,n.,first,一,v.,4,"","toefl"',
].join('\n');

interface AdminWord {
  id: number;
  headword: string;
  lemma: string;
  pos?: string;
  translationZh: string;
  frequencyBand?: string;
  cefrLevel?: string;
  isVerb: boolean;
  examTags: string[];
  isActive: boolean;
}

interface WordList {
  items: AdminWord[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
}

/** 从管理端列表里按 headword 找出词条（不存在则失败并指明） */
function findWord(list: AdminWord[], headword: string): AdminWord {
  const found = list.find((w) => w.headword === headword);
  expect(found, `管理端列表里找不到 headword=${headword}`).toBeDefined();
  return found as AdminWord;
}

describe('RBAC：words-admin 四条写/读路由全部 admin 专属', () => {
  it('非管理员一律 403 RBAC_DENIED', async () => {
    const token = await registerAndGetToken('words_student_a', 'password123', 'Student A', Role.STUDENT);

    for (const path of ['/words-admin', '/words-admin/1/active', '/words-admin/batch-active', '/words-admin/import']) {
      let result: { status: number; body: ApiResponse<unknown> };
      if (path.endsWith('/active')) {
        result = await patch(path, { isActive: false }, token);
      } else if (path.endsWith('/import')) {
        result = await upload(path, new FormData(), token);
      } else {
        result = await post(path, { ids: [1], isActive: false }, token);
      }
      expect(result.status, path).toBe(403);
      expect(result.body.code, path).toBe(ErrorCode.RBAC_DENIED);
    }
  });

  it('老师角色同样 403（RolesGuard 无通配符旁路）', async () => {
    const token = await registerAndGetToken('words_teacher_a', 'password123', 'Teacher A', Role.TEACHER);
    const { status, body } = await get('/words-admin', token);
    expect(status).toBe(403);
    expect(body.code).toBe(ErrorCode.RBAC_DENIED);
  });
});

describe('GET /words-admin', () => {
  it('管理员可读，返回标准分页结构', async () => {
    const token = await registerAndGetToken('words_admin_a', 'password123', 'Admin A', Role.ADMIN);
    const { status, body } = await get('/words-admin?pageSize=5&sortBy=frequency', token);
    expect(status).toBe(200);
    const list = body.data as WordList;
    expect(list.total).toBeGreaterThanOrEqual(0);
    expect(list.page).toBe(1);
    expect(list.pageSize).toBe(5);
    expect(Array.isArray(list.items)).toBe(true);
    expect(list.totalPages).toBeGreaterThanOrEqual(1);
  });

  it('includeInactive=false 不会被 z.coerce 误判成 true（过滤方向不能反过来）', async () => {
    const token = await registerAndGetToken('words_admin_b', 'password123', 'Admin B', Role.ADMIN);
    const form = new FormData();
    form.append('file', new Blob([`${HEADER}\nzaphidden,"/ˈhɪdən/","to hide","隐藏","v.",4,"","cet4"`], { type: 'text/csv' }), 'a.csv');
    form.append('license', 'ecdict-1.0');
    form.append('importAsInactive', 'true');
    const { status, body } = await upload('/words-admin/import', form, token);
    expect(status).toBe(200);
    expect((body.data as { inserted: number }).inserted).toBe(1);

    // 显式 false：仍然只能看到活跃词条
    const { body: offBody } = await get('/words-admin?search=zaphidden&includeInactive=false', token);
    const offItems = (offBody.data as WordList).items;
    expect(offItems.some((w) => w.headword === 'zaphidden')).toBe(false);

    // 显式 true：能看到停用的词条，且 isActive=false
    const { body: onBody } = await get('/words-admin?search=zaphidden&includeInactive=true', token);
    const onItems = (onBody.data as WordList).items;
    expect(findWord(onItems, 'zaphidden').isActive).toBe(false);
  });

  it('非法的 frequencyBand 查询值 → 400 VALIDATION_FAILED', async () => {
    const token = await registerAndGetToken('words_admin_c', 'password123', 'Admin C', Role.ADMIN);
    const { status, body } = await get('/words-admin?frequencyBand=not-a-band', token);
    expect(status).toBe(400);
    expect(body.code).toBe(ErrorCode.VALIDATION_FAILED);
  });
});

describe('POST /words-admin/import', () => {
  it('缺 license → 400（版权红线：没有许可标识的内容不允许入库）', async () => {
    const token = await registerAndGetToken('words_admin_d', 'password123', 'Admin D', Role.ADMIN);
    const form = new FormData();
    form.append('file', new Blob([`${HEADER}\nzapnolic,"/ˈnɒlɪk/","no licence","无许可","n.",3,"","cet4"`], { type: 'text/csv' }), 'a.csv');
    const { status, body } = await upload('/words-admin/import', form, token);
    expect(status).toBe(400);
    expect(body.code).toBe(ErrorCode.VALIDATION_FAILED);
  });

  it('没传文件 → 400（而不是 500）', async () => {
    const token = await registerAndGetToken('words_admin_e', 'password123', 'Admin E', Role.ADMIN);
    const form = new FormData();
    form.append('license', 'ecdict-1.0');
    const { status, body } = await upload('/words-admin/import', form, token);
    expect(status).toBe(400);
    expect(body.code).toBe(ErrorCode.VALIDATION_FAILED);
  });

  it('空 CSV → 400', async () => {
    const token = await registerAndGetToken('words_admin_f', 'password123', 'Admin F', Role.ADMIN);
    const form = new FormData();
    form.append('file', new Blob([HEADER], { type: 'text/csv' }), 'empty.csv');
    form.append('license', 'ecdict-1.0');
    const { status, body } = await upload('/words-admin/import', form, token);
    expect(status).toBe(400);
    expect(body.code).toBe(ErrorCode.VALIDATION_FAILED);
  });

  it('正常导入：计数正确，且正确解析引号内逗号与 ECDICT 的 collins/tag 映射', async () => {
    const token = await registerAndGetToken('words_admin_g', 'password123', 'Admin G', Role.ADMIN);
    const form = new FormData();
    form.append('file', new Blob([FIRST_CSV], { type: 'text/csv' }), 'first.csv');
    form.append('license', 'ecdict-1.0');
    form.append('sourceUrl', 'https://example.org/ecdict');

    const { status, body } = await upload('/words-admin/import', form, token);
    expect(status).toBe(200);
    const result = body.data as {
      inserted: number;
      conflicts: number;
      duplicates: number;
      invalid: number;
      totalRows: number;
      license: string;
      source: string;
    };
    // 5 行数据：3 条有效入库、1 条文件内重复、1 条无效（空词）
    expect(result.totalRows).toBe(5);
    expect(result.inserted).toBe(3);
    expect(result.duplicates).toBe(1);
    expect(result.invalid).toBe(1);
    expect(result.conflicts).toBe(0);
    expect(result.license).toBe('ecdict-1.0');
    expect(result.source).toBe('import');

    const { body: listBody } = await get('/words-admin?search=zap&pageSize=100', token);
    const items = (listBody.data as WordList).items;

    // 引号内的英文逗号没有把行切开：中文释义保持完整
    const apple = findWord(items, 'zapapple');
    expect(apple.translationZh).toBe('一种圆形水果，有红色或绿色的果皮');
    // collins 3 → 词频「中」+ CEFR B1
    expect(apple.frequencyBand).toBe('中');
    expect(apple.cefrLevel).toBe('B1');
    // 标签落库为合法枚举值
    expect(apple.examTags).toContain('cet4');
    expect(apple.isActive).toBe(true);
    // 词性 v. → isVerb；n. → 非动词
    expect(findWord(items, 'zapdup').isVerb).toBe(true);
    expect(findWord(items, 'zapcomma').isVerb).toBe(false);
  });

  it('重复导入同一批词条 → inserted 0，全部计入 conflicts（幂等）', async () => {
    const token = await registerAndGetToken('words_admin_h', 'password123', 'Admin H', Role.ADMIN);
    const form = new FormData();
    form.append('file', new Blob([REPEAT_CSV], { type: 'text/csv' }), 'repeat.csv');
    form.append('license', 'ecdict-1.0');
    const { status, body } = await upload('/words-admin/import', form, token);
    expect(status).toBe(200);
    const result = body.data as { inserted: number; conflicts: number; duplicates: number; invalid: number; totalRows: number };
    expect(result.totalRows).toBe(3);
    expect(result.inserted).toBe(0);
    expect(result.conflicts).toBe(3);
    expect(result.duplicates).toBe(0);
    expect(result.invalid).toBe(0);
  });
});

describe('停用 / 恢复：停用不物理删除', () => {
  /** 找 `zapcomma` 的 id（该词在前面的导入用例中已入库） */
  async function wordIdOf(token: string, headword: string): Promise<number> {
    const { body } = await get('/words-admin?search=zap&pageSize=100', token);
    return findWord((body.data as WordList).items, headword).id;
  }

  it('停用后：公开词库与详情都查不到，但 admin 侧仍然可见', async () => {
    const admin = await registerAndGetToken('words_admin_i', 'password123', 'Admin I', Role.ADMIN);
    const student = await registerAndGetToken('words_student_b', 'password123', 'Student B', Role.STUDENT);
    const id = await wordIdOf(admin, 'zapcomma');

    const { status, body } = await patch(`/words-admin/${id}/active`, { isActive: false }, admin);
    expect(status).toBe(200);
    const result = body.data as { requested: number; updated: number; isActive: boolean };
    expect(result.requested).toBe(1);
    expect(result.updated).toBe(1);
    expect(result.isActive).toBe(false);

    // 公开详情 → 404（停用的词对学生而言等于不存在）
    const { status: detailStatus, body: detailBody } = await get(`/words/${id}`, student);
    expect(detailStatus).toBe(404);
    expect(detailBody.code).toBe(ErrorCode.WORD_NOT_FOUND);

    // 公开列表 → 搜不到
    const { body: pubBody } = await get('/words?search=zapcomma', student);
    const pubItems = (pubBody.data as WordList).items;
    expect(pubItems.some((w) => w.headword === 'zapcomma')).toBe(false);

    // 管理端默认（不带 includeInactive）也看不到
    const { body: defaultBody } = await get('/words-admin?search=zapcomma', admin);
    expect((defaultBody.data as WordList).items.some((w) => w.headword === 'zapcomma')).toBe(false);

    // 管理端带 includeInactive=true 能看到，且 isActive=false
    const { body: allBody } = await get('/words-admin?search=zapcomma&includeInactive=true', admin);
    const found = findWord((allBody.data as WordList).items, 'zapcomma');
    expect(found.id).toBe(id);
    expect(found.isActive).toBe(false);
  });

  it('重复停用同一批 → updated 0（幂等，不报错）', async () => {
    const admin = await registerAndGetToken('words_admin_j', 'password123', 'Admin J', Role.ADMIN);
    const id = await wordIdOf(admin, 'zapcomma');
    const { status, body } = await patch(`/words-admin/${id}/active`, { isActive: false }, admin);
    expect(status).toBe(200);
    const result = body.data as { updated: number };
    expect(result.updated).toBe(0);
  });

  it('恢复后：公开词库重新可见', async () => {
    const admin = await registerAndGetToken('words_admin_k', 'password123', 'Admin K', Role.ADMIN);
    const student = await registerAndGetToken('words_student_c', 'password123', 'Student C', Role.STUDENT);
    const id = await wordIdOf(admin, 'zapcomma');

    const { status, body } = await patch(`/words-admin/${id}/active`, { isActive: true }, admin);
    expect(status).toBe(200);
    expect((body.data as { updated: number }).updated).toBe(1);

    const { status: detailStatus } = await get(`/words/${id}`, student);
    expect(detailStatus).toBe(200);
  });

  it('POST /batch-active：批量停用与恢复，requested/updated 计数正确', async () => {
    const admin = await registerAndGetToken('words_admin_l', 'password123', 'Admin L', Role.ADMIN);
    const { body } = await get('/words-admin?search=zap&pageSize=100', admin);
    const ids = (body.data as WordList).items.map((w) => w.id);
    expect(ids.length).toBeGreaterThanOrEqual(2);

    const down = (await post('/words-admin/batch-active', { ids, isActive: false }, admin)).body.data as {
      requested: number;
      updated: number;
      isActive: boolean;
    };
    expect(down.requested).toBe(ids.length);
    expect(down.updated).toBe(ids.length);
    expect(down.isActive).toBe(false);

    // 重复批量停用 → 全部已停用，updated 0
    const again = (await post('/words-admin/batch-active', { ids, isActive: false }, admin)).body.data as { updated: number };
    expect(again.updated).toBe(0);

    // 批量恢复
    const up = (await post('/words-admin/batch-active', { ids, isActive: true }, admin)).body.data as { updated: number };
    expect(up.updated).toBe(ids.length);
  });

  it('POST /batch-active：ids 为空数组 → 400', async () => {
    const admin = await registerAndGetToken('words_admin_m', 'password123', 'Admin M', Role.ADMIN);
    const { status, body } = await post('/words-admin/batch-active', { ids: [], isActive: false }, admin);
    expect(status).toBe(400);
    expect(body.code).toBe(ErrorCode.VALIDATION_FAILED);
  });

  it('PATCH /active：body 缺 isActive → 400', async () => {
    const admin = await registerAndGetToken('words_admin_n', 'password123', 'Admin N', Role.ADMIN);
    const { status, body } = await patch('/words-admin/1/active', {}, admin);
    expect(status).toBe(400);
    expect(body.code).toBe(ErrorCode.VALIDATION_FAILED);
  });
});
