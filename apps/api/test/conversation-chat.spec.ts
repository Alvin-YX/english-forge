/**
 * `POST /conversations/:id/chat` —— 真实的 AI 往返
 *
 * 核心不变量：**这条路由在任何 AI 故障下都不能 500，用户消息也不能丢。**
 * 未配置、端点不可达、超时都归一成「用户消息已落库 + assistantMessage:null + degraded:true」，
 * 前端据此显示降级提示而不是让用户以为消息发丢了。
 *
 * 用例顺序是有意的（LLM 配置是全局状态，不是按用户隔离的）：
 *   1~4 依赖「尚未配置 LLM」
 *   5   配置一个可用的假端点
 *   6~7 把它改成一个不可达的端点
 * 不要调整顺序，否则前面的断言前提就不成立了。
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

/** 指向一个没有进程监听的端口，用于覆盖「连接被拒绝 → LLM_UNAVAILABLE」分支 */
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

async function registerAndGetToken(username: string, password: string, displayName: string, role: Role = Role.STUDENT) {
  const { status, body } = await post('/auth/register', { username, password, displayName, role });
  expect(status).toBe(201);
  return (body.data as { accessToken: string }).accessToken;
}

async function newConversation(token: string): Promise<number> {
  const { status, body } = await post('/conversations', { mode: 'chat', level: 'A2' }, token);
  expect(status, `创建对话失败：${JSON.stringify(body)}`).toBe(201);
  return (body.data as { id: number }).id;
}

interface ChatMessage {
  id: number;
  conversationId: number;
  seq: number;
  role: 'user' | 'assistant' | 'system';
  content: string;
  provider?: string;
  tokens?: number;
  latencyMs?: number;
  filtered: boolean;
  createdAt: string;
}

interface ChatReply {
  userMessage: ChatMessage;
  assistantMessage: ChatMessage | null;
  degraded: boolean;
  reason?: string;
  code?: number;
}

describe('未配置大模型（降级路径）', () => {
  it('返回 200 + degraded:true + LLM_NOT_CONFIGURED，assistantMessage 为 null', async () => {
    const token = await registerAndGetToken('chat_student_a', 'password123', 'Chat Student A');
    const id = await newConversation(token);

    const { status, body } = await post(`/conversations/${id}/chat`, { content: 'Hello, teacher.' }, token);
    expect(status).toBe(200);
    expect(body.code).toBe(ErrorCode.OK);
    const reply = body.data as ChatReply;
    expect(reply.degraded).toBe(true);
    expect(reply.code).toBe(ErrorCode.LLM_NOT_CONFIGURED);
    expect(reply.reason).toBeTruthy();
    expect(reply.assistantMessage).toBeNull();
    expect(reply.userMessage.content).toBe('Hello, teacher.');
    expect(reply.userMessage.role).toBe('user');
  });

  it('用户消息已落库：AI 失败也不丢输入', async () => {
    const token = await registerAndGetToken('chat_student_b', 'password123', 'Chat Student B');
    const id = await newConversation(token);
    await post(`/conversations/${id}/chat`, { content: 'What is a noun?' }, token);

    const { status, body } = await get(`/conversations/${id}/messages`, token);
    expect(status).toBe(200);
    const messages = (body.data as { items: ChatMessage[]; total: number }).items;
    expect(messages.length).toBe(1);
    expect(messages[0]?.role).toBe('user');
    expect(messages[0]?.content).toBe('What is a noun?');
  });

  it('降级会标记对话的 provider/fallback 状态位', async () => {
    const token = await registerAndGetToken('chat_student_c', 'password123', 'Chat Student C');
    const id = await newConversation(token);
    await post(`/conversations/${id}/chat`, { content: 'Say hi.' }, token);

    const { body } = await get(`/conversations/${id}`, token);
    const conv = body.data as { providerUsed?: string; fallbackUsed: boolean; turnCount: number };
    expect(conv.providerUsed).toBe('rule');
    expect(conv.fallbackUsed).toBe(true);
    expect(conv.turnCount).toBe(1);
  });
});

describe('参数校验与权限', () => {
  it('空 content → 400 VALIDATION_FAILED', async () => {
    const token = await registerAndGetToken('chat_student_d', 'password123', 'Chat Student D');
    const id = await newConversation(token);
    const { status, body } = await post(`/conversations/${id}/chat`, { content: '   ' }, token);
    expect(status).toBe(400);
    expect(body.code).toBe(ErrorCode.VALIDATION_FAILED);
  });

  it('content 超长 → 400', async () => {
    const token = await registerAndGetToken('chat_student_e', 'password123', 'Chat Student E');
    const id = await newConversation(token);
    const { status, body } = await post(`/conversations/${id}/chat`, { content: 'x'.repeat(2001) }, token);
    expect(status).toBe(400);
    expect(body.code).toBe(ErrorCode.VALIDATION_FAILED);
  });

  it('别人的对话 → 404（跨档案访问不可见，而不是泄露「存在但不归你」）', async () => {
    const owner = await registerAndGetToken('chat_owner_a', 'password123', 'Owner A');
    const outsider = await registerAndGetToken('chat_outsider_a', 'password123', 'Outsider A');
    const id = await newConversation(owner);

    const { status, body } = await post(`/conversations/${id}/chat`, { content: 'sneaky' }, outsider);
    expect(status).toBe(404);
    expect(body.code).toBe(ErrorCode.CONVERSATION_NOT_FOUND);
  });

  it('不存在的对话 id → 404', async () => {
    const token = await registerAndGetToken('chat_student_f', 'password123', 'Chat Student F');
    const { status, body } = await post('/conversations/999999/chat', { content: 'hi' }, token);
    expect(status).toBe(404);
    expect(body.code).toBe(ErrorCode.CONVERSATION_NOT_FOUND);
  });

  it('未登录 → 401', async () => {
    const { status, body } = await post('/conversations/1/chat', { content: 'hi' });
    expect(status).toBe(401);
    expect(body.code).toBe(ErrorCode.UNAUTHENTICATED);
  });
});

describe('配置了可用的大模型', () => {
  it('配置生效 → degraded:false，assistantMessage 带 provider/tokens/latencyMs', async () => {
    const admin = await registerAndGetToken('chat_admin_a', 'password123', 'Chat Admin A', Role.ADMIN);
    const { status } = await post(
      '/system/llm',
      { provider: 'custom', model: 'test-model', baseUrl: `${llm?.url}`, apiKey: 'sk-chat-test-0001' },
      admin,
    );
    expect(status).toBe(200);

    const token = await registerAndGetToken('chat_student_g', 'password123', 'Chat Student G');
    const id = await newConversation(token);

    const { status: chatStatus, body: chatBody } = await post(
      `/conversations/${id}/chat`,
      { content: 'How do you say 谢谢 in English?' },
      token,
    );
    expect(chatStatus).toBe(200);
    const reply = chatBody.data as ChatReply;
    expect(reply.degraded).toBe(false);
    expect(reply.reason).toBeUndefined();
    expect(reply.code).toBeUndefined();
    expect(reply.userMessage.role).toBe('user');
    expect(reply.assistantMessage).not.toBeNull();
    const ai = reply.assistantMessage as ChatMessage;
    expect(ai.role).toBe('assistant');
    expect(ai.content).toBe('Nice work. Try again tomorrow.');
    expect(ai.provider).toBe('cloud');
    expect(ai.tokens).toBe(7);
    expect(ai.latencyMs).toBeGreaterThanOrEqual(0);
    expect(llm?.hits()).toBeGreaterThanOrEqual(1);
    // 客户端不能伪造 AI 回复：messages 里两条都是服务端写进去的
    expect(reply.userMessage.id).not.toBe(ai.id);
  });

  it('成功回复后：对话标记为 cloud 且 fallbackUsed=false', async () => {
    const token = await registerAndGetToken('chat_student_h', 'password123', 'Chat Student H');
    const id = await newConversation(token);
    await post(`/conversations/${id}/chat`, { content: 'Good morning.' }, token);

    const { body } = await get(`/conversations/${id}`, token);
    const conv = body.data as { providerUsed?: string; fallbackUsed: boolean; totalTokens: number };
    expect(conv.providerUsed).toBe('cloud');
    expect(conv.fallbackUsed).toBe(false);
    expect(conv.totalTokens).toBeGreaterThan(0);
  });
});

describe('大模型不可达（降级路径）', () => {
  it('配置成不可达端点 → 200 + degraded:true + LLM_UNAVAILABLE，用户消息仍落库', async () => {
    const admin = await registerAndGetToken('chat_admin_b', 'password123', 'Chat Admin B', Role.ADMIN);
    const { status } = await post(
      '/system/llm',
      { provider: 'custom', model: 'test-model', baseUrl: UNREACHABLE_BASE_URL, apiKey: 'sk-broken-0001', timeoutMs: 1000 },
      admin,
    );
    expect(status).toBe(200);

    const token = await registerAndGetToken('chat_student_i', 'password123', 'Chat Student I');
    const id = await newConversation(token);

    const { status: chatStatus, body: chatBody } = await post(
      `/conversations/${id}/chat`,
      { content: 'Tell me a joke.' },
      token,
    );
    // 🔴 关键断言：AI 挂了也不许 500，用户消息不许丢
    expect(chatStatus).toBe(200);
    const reply = chatBody.data as ChatReply;
    expect(reply.degraded).toBe(true);
    expect(reply.code).toBe(ErrorCode.LLM_UNAVAILABLE);
    expect(reply.assistantMessage).toBeNull();
    expect(reply.userMessage.content).toBe('Tell me a joke.');

    const { body: msgs } = await get(`/conversations/${id}/messages`, token);
    const items = (msgs.data as { items: ChatMessage[] }).items;
    expect(items.length).toBe(1);
    expect(items[0]?.role).toBe('user');
  });
});
