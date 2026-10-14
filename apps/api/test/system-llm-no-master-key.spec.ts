/**
 * `APP_SECRET_MASTER_KEY` 未配置时的行为
 *
 * 这一档必须单独开一个 app 实例（自己的临时库 + 自己的 env）：主密钥是进程级 env，
 * 若在同一进程内临时删掉，会污染 `system-llm.spec.ts` 里所有依赖加密的用例。
 *
 * 要证明的不变量只有一个：**不返回裸 500**。
 * 服务照样能启动（否则管理员连不上后台去补配置），但保存 Key 会失败，
 * 而失败必须退化成一条「告诉管理员该怎么做」的业务错误，而不是 UNKNOWN_ERROR。
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
/** 备份原值，避免污染同进程内可能并行跑的其他 spec 文件 */
let previousMasterKey: string | undefined;

beforeAll(async () => {
  const db = await createTestDb();
  cleanup = db.cleanup;
  const env = setupTestEnv(db.path);
  previousMasterKey = process.env.APP_SECRET_MASTER_KEY;
  delete env.APP_SECRET_MASTER_KEY;
  Object.assign(process.env, env);
  delete process.env.APP_SECRET_MASTER_KEY;

  app = await NestFactory.create(AppModule, { logger: false });
  app.setGlobalPrefix(parseEnv(process.env).API_PREFIX);
  await app.listen(0);
  const address = (app.getHttpServer() as unknown as Server).address();
  if (address === null || typeof address === 'string') {
    throw new Error('测试服务未能绑定端口');
  }
  baseUrl = `http://127.0.0.1:${address.port}/api/v1`;
});

afterAll(async () => {
  await app?.close();
  if (previousMasterKey === undefined) {
    delete process.env.APP_SECRET_MASTER_KEY;
  } else {
    process.env.APP_SECRET_MASTER_KEY = previousMasterKey;
  }
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

describe('主密钥未配置', () => {
  it('服务照常启动，GET /system/llm 返回 hasMasterKey:false 并给出可操作提示', async () => {
    const { status, body } = await post('/auth/register', {
      username: 'llm_nomkey_admin',
      password: 'password123',
      displayName: 'NoMasterKey Admin',
      role: Role.ADMIN,
    });
    expect(status).toBe(201);
    const token = (body.data as { accessToken: string }).accessToken;

    const { status: readStatus, body: readBody } = await get('/system/llm', token);
    expect(readStatus).toBe(200);
    const view = readBody.data as { hasKey: boolean; hasMasterKey: boolean; masterKeyHint?: string };
    expect(view.hasMasterKey).toBe(false);
    expect(view.masterKeyHint).toContain('APP_SECRET_MASTER_KEY');
  });

  it('保存 Key → LLM_CONFIG_INVALID，且 message 指出该补什么（不是裸 500）', async () => {
    const { status: regStatus, body: regBody } = await post('/auth/register', {
      username: 'llm_nomkey_admin_2',
      password: 'password123',
      displayName: 'NoMasterKey Admin 2',
      role: Role.ADMIN,
    });
    expect(regStatus).toBe(201);
    const token = (regBody.data as { accessToken: string }).accessToken;

    const { status, body } = await post(
      '/system/llm',
      { provider: 'deepseek', model: 'deepseek-chat', baseUrl: 'https://api.deepseek.com/v1', apiKey: 'sk-secret-0001' },
      token,
    );

    expect(body.code).toBe(ErrorCode.LLM_CONFIG_INVALID);
    // 5xx 语义：这是服务端配置缺失，不是客户端参数错误
    expect(status).toBeGreaterThanOrEqual(500);
    // 错误信息必须可操作 —— 直接告诉管理员去补什么
    expect(body.message).toContain('APP_SECRET_MASTER_KEY');
    // 也不得回显用户刚提交的 Key
    expect(JSON.stringify(body)).not.toContain('sk-secret-0001');
  });
});
