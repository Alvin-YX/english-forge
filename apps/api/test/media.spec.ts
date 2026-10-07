import type { Server } from 'node:http';

import { NestFactory, type NestApplication } from '@nestjs/core';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { AppModule } from '../src/app.module.js';
import { parseEnv } from '../src/infra/config/env.js';
import { MediaService } from '../src/modules/media/media.service.js';

import { createTestDb, setupTestEnv } from './helpers/test-env.js';

let app: NestApplication;
let cleanup: (() => void) | undefined;
let mediaService: MediaService;

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
  mediaService = app.get(MediaService);
});

afterAll(async () => {
  await app?.close();
  cleanup?.();
});

describe('MediaService.resolveMediaPath', () => {
  it('路径穿越 → 抛出 BusinessError(6002)', () => {
    expect(() => mediaService.resolveMediaPath('../../etc/passwd')).toThrow();
  });

  it('空路径 → 抛出 BusinessError(6002)', () => {
    expect(() => mediaService.resolveMediaPath('')).toThrow();
  });

  it('null byte 注入 → 抛出 BusinessError(6002)', () => {
    expect(() => mediaService.resolveMediaPath('recordings\0/1/file.wav')).toThrow();
  });

  it('正常路径 → 返回绝对路径', () => {
    const result = mediaService.resolveMediaPath('recordings/1/123.wav');
    expect(typeof result).toBe('string');
    expect(result).toContain('recordings');
  });
});

describe('MediaService.buildRecordingPath', () => {
  it('构造录音路径', () => {
    const result = mediaService.buildRecordingPath(1, 1234567890);
    expect(result).toBe('recordings/1/1234567890.wav');
  });
});

describe('MediaService.ttsCachePath', () => {
  it('构造 TTS 缓存路径（含 sha256 hash）', () => {
    const result = mediaService.ttsCachePath('voice-a', 'hello world');
    expect(result).toContain('tts-cache/voice-a/');
    expect(result).toContain('.mp3');
    expect(result.split('/').length).toBe(3);
  });
});
