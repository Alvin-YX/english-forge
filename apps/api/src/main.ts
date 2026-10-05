/**
 * API 进程入口。
 *
 * 启动顺序（**不可调换**）：
 *   1. `parseEnv()`        —— fail-fast 校验环境变量，缺密钥立即退出
 *   2. `NestFactory.create()` —— 触发模块装配（ConfigModule 的 useFactory 再校验一次）
 *   3. 全局中间件          —— helmet / CORS / body 上限
 *   4. 路由前缀 + OpenAPI   —— `/api/v1` 与 `/docs`
 *   5. `listen()`
 *
 * 🔴 为什么先 `parseEnv()` 再建应用：
 *    让配置错误在最外层暴露成清晰的中文报错，而不是变成某个 provider 构造时
 *    的 DI 异常（那种报错信息极难定位到底是哪个字段缺了）。
 */

import 'reflect-metadata';

import { Logger } from '@nestjs/common';
import { type NestApplication, NestFactory } from '@nestjs/core';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import helmet from 'helmet';

import { AppModule } from './app.module.js';
import { type Env, parseEnv } from './infra/config/env.js';
import { APP_NAME, APP_VERSION } from './infra/version.js';

export async function bootstrap(): Promise<void> {
  const env = parseEnv(process.env);

  const app = await NestFactory.create<NestApplication>(AppModule, {
    logger: env.NODE_ENV === 'production' ? ['error', 'warn'] : ['error', 'warn', 'log'],
  });

  app.use(helmet(cspOptions()));
  app.enableCors(corsOptions(env));

  // 🔴 body 上限必须显式设：express 默认 100kb，录音上传（§5.3）会被直接 413
  app.useBodyParser('json', { limit: env.BODY_LIMIT });

  app.setGlobalPrefix(env.API_PREFIX);
  setupSwagger(app);

  await app.listen(env.PORT, '0.0.0.0');
  Logger.log(
    `[${APP_NAME}] v${APP_VERSION} 已启动  http://0.0.0.0:${env.PORT}/${env.API_PREFIX}  docs=/docs`,
  );
}

/**
 * CSP 指令。
 *
 * 🔴 显式放宽 `script-src`：`/docs`（Swagger UI）使用内联脚本，
 *    helmet 默认的 `script-src 'self'` 会把文档页渲染成空白。
 *    代价：一旦 SPA 也由本进程同域托管，必须按 nonce/hash 重做这套指令，
 *    而不是继续往里加白名单。
 */
function cspOptions() {
  return {
    contentSecurityPolicy: {
      directives: {
        'script-src': ["'self'", "'unsafe-inline'"],
        'style-src': ["'self'", "'unsafe-inline'"],
        'img-src': ["'self'", 'data:'],
        'connect-src': ["'self'", 'ws:', 'wss:'],
      },
    },
  };
}

function corsOptions(env: Env) {
  const methods = ['GET', 'POST', 'PATCH', 'PUT', 'DELETE', 'OPTIONS'];
  const raw = env.CORS_ORIGINS.trim();
  if (raw === '*') {
    // 🔴 `origin: '*'` 与 `credentials: true` 组合会被浏览器直接拒绝，
    //    这里显式不开 credentials，避免配错后静默失效
    return { origin: '*', methods };
  }
  return {
    origin: raw
      .split(',')
      .map((s) => s.trim())
      .filter((s) => s !== ''),
    credentials: true,
    methods,
  };
}

function setupSwagger(app: NestApplication): void {
  const document = SwaggerModule.createDocument(
    app,
    new DocumentBuilder()
      .setTitle(`${APP_NAME} OpenAPI`)
      .setDescription('EnglishForge 主 API（03 文档 §5 契约）')
      .setVersion(APP_VERSION)
      .addBearerAuth({ type: 'http', scheme: 'bearer', bearerFormat: 'JWT' }, 'jwt')
      .build(),
  );

  SwaggerModule.setup('docs', app, document, {
    swaggerOptions: { persistAuthorization: true },
  });
}

void bootstrap().catch((err: unknown) => {
  console.error('[api] 启动失败：', err instanceof Error ? err.stack : err);
  process.exit(1);
});
