/**
 * `GET/POST /system/llm`、`/system/llm/presets`、`/system/llm/test`
 *
 * 这一组接口承担 03 文档 §9.3「敏感配置管理」，所以重点断言的是**不变量**而不是字段值：
 *   - 只写不读：返回体里绝不能出现 Key 原文，也没有任何叫 key/secret 的明文字段
 *   - `apiKey` 可省略 = 沿用已保存的 Key（改模型不必重填密钥）
 *   - 连通性测试**永不 500**：无论端点不可达、不响应还是配置不全，都回 200 + `ok:false`
 *   - 全部路由 admin 专属，非 admin 一律 403
 *
 * 「主密钥缺失」的情形放在 `system-llm-no-master-key.spec.ts` 单独开一个 app 实例测 ——
 * `APP_SECRET_MASTER_KEY` 是进程级 env，同进程内第二个实例会污染本文件的其他用例。
 */

import type { Server } from 'node:http';

import { type ApiResponse, ErrorCode } from '@eng-forge/contracts/api';
import { Role } from '@eng-forge/contracts/enums';
import { NestFactory, type NestApplication } from '@nestjs/core';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { AppModule } from '../src/app.module.js';
import { parseEnv } from '../src/infra/config/env.js';

import { startFakeLlmServer, type FakeLlmServer } from './helpers/llm-fake.js';
import { createTestDb, setupTestEnv } from './helpers/test-env.js';

/** 故意指向一个没有进程监听的端口，用于覆盖「连接被拒绝」分支 */
const UNREACHABLE_BASE_URL = 'http://127.0.0.1:1/v1';

let app: NestApplication;
let baseUrl = '';
let cleanup: (() => void) | undefined;
let llm: FakeLlmServer | undefined;

beforeAll(async () => {
  llm = await startFakeLlmServer();
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
  await llm?.close();
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

async function registerAndGetToken(username: string, password: string, displayName: string, role: Role) {
  const { status, body } = await post('/auth/register', { username, password, displayName, role });
  expect(status).toBe(201);
  const data = body.data as { accessToken: string };
  return data.accessToken;
}

/** 保存配置的返回体：只含掩码，不含明文 */
interface LlmView {
  provider: string;
  model: string;
  baseUrl: string;
  timeoutMs: number;
  hasKey: boolean;
  keyHint: string | null;
  updatedAt: string | null;
  hasMasterKey: boolean;
  masterKeyHint?: string;
}

/** 断言返回体不含任何明文字段 —— §9.3 的只写不读红线 */
function expectNoPlaintext(view: object, plain: string): void {
  expect(JSON.stringify(view)).not.toContain(plain);
  for (const banned of ['apiKey', 'api_key', 'key', 'secret', 'plaintext']) {
    expect(Object.keys(view)).not.toContain(banned);
  }
}

describe('GET /system/llm', () => {
  it('非管理员 → 403 RBAC_DENIED', async () => {
    const token = await registerAndGetToken('llm_student_a', 'password123', 'Student A', Role.STUDENT);
    const { status, body } = await get('/system/llm', token);
    expect(status).toBe(403);
    expect(body.code).toBe(ErrorCode.RBAC_DENIED);
  });

  it('管理员可读；返回体只有掩码，绝无明文', async () => {
    const token = await registerAndGetToken('llm_admin_a', 'password123', 'Admin A', Role.ADMIN);
    const saved = (await post('/system/llm', {
      provider: 'deepseek',
      model: 'deepseek-chat',
      baseUrl: `${llm?.url}`,
      apiKey: 'sk-key-last-abcd',
    }, token)).body.data as LlmView;
    expect(saved.hasKey).toBe(true);
    expect(saved.keyHint).toBe('****abcd');

    const { status, body } = await get('/system/llm', token);
    expect(status).toBe(200);
    const view = body.data as LlmView;
    expect(view.provider).toBe('deepseek');
    expect(view.model).toBe('deepseek-chat');
    expect(view.hasKey).toBe(true);
    expect(view.keyHint).toBe('****abcd');
    expect(view.hasMasterKey).toBe(true);
    expect(view.masterKeyHint).toBeUndefined();
    expect(view.updatedAt).not.toBeNull();
    expectNoPlaintext(view, 'sk-key-last-abcd');
  });

  it('从未保存过 → hasKey:false、keyHint:null', async () => {
    const token = await registerAndGetToken('llm_admin_b', 'password123', 'Admin B', Role.ADMIN);
    const { status, body } = await get('/system/llm', token);
    expect(status).toBe(200);
    const view = body.data as LlmView;
    expect(view.hasKey).toBe(false);
    expect(view.keyHint).toBeNull();
    expect(view.updatedAt).toBeNull();
    expectNoPlaintext(view, 'apiKey');
  });
});

describe('GET /system/llm/presets', () => {
  it('返回全部预设与超时边界', async () => {
    const token = await registerAndGetToken('llm_admin_c', 'password123', 'Admin C', Role.ADMIN);
    const { status, body } = await get('/system/llm/presets', token);
    expect(status).toBe(200);
    const data = body.data as {
      presets: Record<string, { baseUrl: string; model: string; label: string }>;
      timeoutDefaultMs: number;
      timeoutMinMs: number;
      timeoutMaxMs: number;
    };

    expect(Object.keys(data.presets).sort()).toEqual(['custom', 'deepseek', 'openai', 'qwen']);
    // 除 custom（用户自填）外，每个预设必须自带可直接使用的 baseUrl 与 model
    for (const [name, preset] of Object.entries(data.presets)) {
      expect(preset.label, `${name} label`).not.toHaveLength(0);
      if (name === 'custom') continue;
      expect(preset.baseUrl.length, `${name} baseUrl`).toBeGreaterThan(0);
      expect(preset.model.length, `${name} model`).toBeGreaterThan(0);
    }
    expect(data.timeoutMinMs).toBeLessThanOrEqual(data.timeoutDefaultMs);
    expect(data.timeoutDefaultMs).toBeLessThanOrEqual(data.timeoutMaxMs);
  });
});

describe('POST /system/llm', () => {
  it('不填 apiKey → 沿用已保存的 Key（改模型不必重填密钥）', async () => {
    const token = await registerAndGetToken('llm_admin_d', 'password123', 'Admin D', Role.ADMIN);

    const first = (await post('/system/llm', {
      provider: 'deepseek',
      model: 'deepseek-chat',
      baseUrl: `${llm?.url}`,
      apiKey: 'sk-reuse-key-1234',
    }, token)).body.data as LlmView;
    expect(first.hasKey).toBe(true);
    expect(first.keyHint).toBe('****1234');

    const second = (await post('/system/llm', {
      provider: 'deepseek',
      model: 'deepseek-v5',
      baseUrl: `${llm?.url}`,
    }, token)).body.data as LlmView;
    expect(second.model).toBe('deepseek-v5');
    expect(second.hasKey).toBe(true);
    expect(second.keyHint).toBe('****1234');
    expectNoPlaintext(second, 'sk-reuse-key-1234');
  });

  it('timeoutMs 越界 → 400 VALIDATION_FAILED', async () => {
    const token = await registerAndGetToken('llm_admin_e', 'password123', 'Admin E', Role.ADMIN);
    const { status, body } = await post(
      '/system/llm',
      { provider: 'openai', model: 'gpt-4o-mini', baseUrl: 'https://api.openai.com/v1', timeoutMs: 999_999 },
      token,
    );
    expect(status).toBe(400);
    expect(body.code).toBe(ErrorCode.VALIDATION_FAILED);
  });

  it('baseUrl 不是合法 URL → 400 VALIDATION_FAILED', async () => {
    const token = await registerAndGetToken('llm_admin_f', 'password123', 'Admin F', Role.ADMIN);
    const { status, body } = await post(
      '/system/llm',
      { provider: 'custom', model: 'some-model', baseUrl: 'not-a-url' },
      token,
    );
    expect(status).toBe(400);
    expect(body.code).toBe(ErrorCode.VALIDATION_FAILED);
  });

  it('provider 非法枚举 → 400 VALIDATION_FAILED', async () => {
    const token = await registerAndGetToken('llm_admin_g', 'password123', 'Admin G', Role.ADMIN);
    const { status, body } = await post(
      '/system/llm',
      { provider: 'gemini', model: 'g', baseUrl: 'https://example.com/v1' },
      token,
    );
    expect(status).toBe(400);
    expect(body.code).toBe(ErrorCode.VALIDATION_FAILED);
  });
});

describe('POST /system/llm/test', () => {
  it('端点可达 → ok:true，带回 latencyMs / model / totalTokens', async () => {
    const token = await registerAndGetToken('llm_admin_h', 'password123', 'Admin H', Role.ADMIN);
    const { status, body } = await post(
      '/system/llm/test',
      { provider: 'deepseek', model: 'deepseek-chat', baseUrl: `${llm?.url}`, apiKey: 'sk-test-key-0001' },
      token,
    );
    expect(status).toBe(200);
    const result = body.data as { ok: boolean; latencyMs?: number; model?: string; totalTokens?: number; error?: string };
    expect(result.ok).toBe(true);
    expect(result.latencyMs).toBeGreaterThanOrEqual(0);
    expect(result.model).toBe('test-model');
    expect(result.totalTokens).toBe(7);
    expect(result.error).toBeUndefined();
    expect(llm?.hits()).toBeGreaterThanOrEqual(1);
    // 客户端确实按 OpenAI 协议组包（非流式）
    const sent = llm?.lastBody();
    expect(sent?.stream).toBe(false);
    expect(sent?.model).toBe('deepseek-chat');
  });

  it('端点不可达 → 200 + ok:false + reason:unreachable（永不 500）', async () => {
    const token = await registerAndGetToken('llm_admin_i', 'password123', 'Admin I', Role.ADMIN);
    const { status, body } = await post(
      '/system/llm/test',
      { provider: 'custom', model: 'm', baseUrl: UNREACHABLE_BASE_URL, apiKey: 'sk-x', timeoutMs: 1000 },
      token,
    );
    expect(status).toBe(200);
    const result = body.data as { ok: boolean; reason?: string; error?: string };
    expect(result.ok).toBe(false);
    expect(result.reason).toBe('unreachable');
    expect(result.error).toBeTruthy();
  });

  it('端点挂起不响应 → 200 + reason:timeout', async () => {
    const token = await registerAndGetToken('llm_admin_j', 'password123', 'Admin J', Role.ADMIN);
    const stall = await startFakeLlmServer({ stallMs: 4000 });
    try {
      const { status, body } = await post(
        '/system/llm/test',
        { provider: 'custom', model: 'm', baseUrl: `${stall.url}`, apiKey: 'sk-x', timeoutMs: 1000 },
        token,
      );
      expect(status).toBe(200);
      const result = body.data as { ok: boolean; reason?: string };
      expect(result.ok).toBe(false);
      expect(result.reason).toBe('timeout');
    } finally {
      await stall.close();
    }
  });

  it('未保存过 Key 且请求体也没带 → ok:false，提示先填 Key', async () => {
    const token = await registerAndGetToken('llm_admin_k', 'password123', 'Admin K', Role.ADMIN);
    const { status, body } = await post(
      '/system/llm/test',
      { provider: 'deepseek', model: 'deepseek-chat', baseUrl: `${llm?.url}` },
      token,
    );
    expect(status).toBe(200);
    const result = body.data as { ok: boolean; error?: string; reason?: string };
    expect(result.ok).toBe(false);
    expect(result.reason).toBe('unreachable');
    expect(result.error).toContain('API Key');
  });

  it('base_url 与模型名都缺失 → ok:false（提示先填写，不抛错）', async () => {
    const token = await registerAndGetToken('llm_admin_l', 'password123', 'Admin L', Role.ADMIN);
    const { status, body } = await post('/system/llm/test', {}, token);
    expect(status).toBe(200);
    const result = body.data as { ok: boolean; error?: string; reason?: string };
    expect(result.ok).toBe(false);
    expect(result.reason).toBe('unreachable');
    expect(result.error).toContain('base_url');
  });
});
