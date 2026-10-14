/**
 * 测试夹具：本地起一个 OpenAI 兼容的假 LLM 端点。
 *
 * 为什么需要真的 HTTP 对端（而不是 mock `fetch`）：`infra/ai/ai-client.ts` 的成功路径
 * 覆盖了三段 mock 测不到的真实逻辑 —— `AbortSignal.timeout()` 的中断行为、
 * 响应体 `choices[0].message.content` 的形状校验、`usage` 的 token 计数与回退相加。
 * 用一个进程内的 `node:http` 服务就能覆盖，不引入任何依赖（ADR-0004 依赖预算 ≤12）。
 *
 * 这个对端不做任何鉴权校验，只回一个固定报文 —— 测试关心的是「客户端是否按
 * OpenAI 协议正确组包、能否把 200 响应解析成可用的回复」。
 */

import type { Server } from 'node:http';
import { createServer } from 'node:http';

export interface FakeLlmRequestBody {
  model?: string;
  messages?: Array<{ role: string; content: string }>;
  stream?: boolean;
  max_tokens?: number;
  temperature?: number;
}

export interface FakeLlmServer {
  /** 可直接作为 `baseUrl` 传给 `/system/llm` 的地址（已带 `/v1` 后缀） */
  url: string;
  /** 累计收到的请求次数 */
  hits: () => number;
  /** 最后一次收到的请求体（解析失败时为 null） */
  lastBody: () => FakeLlmRequestBody | null;
  close: () => Promise<void>;
}

export interface FakeLlmServerOptions {
  /** >0 时响应前先等待该毫秒数 —— 用于触发客户端超时 */
  stallMs?: number;
}

/** 借 `listen(0)` 让操作系统分配一个空闲端口，避免硬编码端口撞车 */
async function takeFreePort(): Promise<number> {
  const server = await new Promise<Server>((resolve) => {
    const s = createServer();
    s.listen(0, '127.0.0.1', () => resolve(s));
  });
  const address = server.address();
  await new Promise<void>((resolve) => server.close(() => resolve()));
  if (address === null || typeof address === 'string') {
    throw new Error('未能分配测试端口');
  }
  return address.port;
}

export async function startFakeLlmServer(options: FakeLlmServerOptions = {}): Promise<FakeLlmServer> {
  const port = await takeFreePort();
  const stallMs = Math.max(0, Math.round(options.stallMs ?? 0));

  let requestCount = 0;
  let lastBody: FakeLlmRequestBody | null = null;

  const server = createServer((req, res) => {
    requestCount += 1;

    const chunks: Uint8Array[] = [];
    req.on('data', (chunk) => chunks.push(Buffer.from(chunk)));
    req.on('end', () => {
      try {
        lastBody = JSON.parse(Buffer.concat(chunks).toString('utf8')) as FakeLlmRequestBody;
      } catch {
        lastBody = null;
      }

      const respond = (): void => {
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(
          JSON.stringify({
            id: 'chatcmpl-test',
            model: 'test-model',
            choices: [{ message: { role: 'assistant', content: 'Nice work. Try again tomorrow.' }, finish_reason: 'stop' }],
            usage: { prompt_tokens: 3, completion_tokens: 4, total_tokens: 7 },
          }),
        );
      };

      if (stallMs > 0) {
        const timer = setTimeout(() => {
          respond();
        }, stallMs);
        timer.unref();
      } else {
        respond();
      }
    });
  });

  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, '127.0.0.1', () => resolve());
  });

  return {
    url: `http://127.0.0.1:${port}/v1`,
    hits: () => requestCount,
    lastBody: () => lastBody,
    close: async () => {
      // 先掐断挂起的连接，否则 `server.close()` 会等到它们全部结束
      server.closeAllConnections();
      await new Promise<void>((resolve) => {
        const bail = setTimeout(() => resolve(), 500);
        bail.unref();
        server.close(() => resolve());
      });
    },
  };
}
