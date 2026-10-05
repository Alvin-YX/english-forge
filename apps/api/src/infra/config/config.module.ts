/**
 * 配置模块 —— `@Global()`，全应用共享。
 *
 * 三件东西：
 *   1. `ENV_CONFIG`：环境变量（进程级，只读，启动期 fail-fast 校验）
 *   2. `AppConfigStore`：`app_config` 表（非敏感配置，可被运维改库/后台改）
 *   3. `AppSecretStore`：`app_secret` 表（敏感配置，只存密文）
 *
 * 🔴 为什么 ENV_CONFIG 用 `useFactory` 而不是静态常量：
 *    模块装配阶段就调用 `parseEnv()`，因此**任何**服务注入它都会触发
 *    fail-fast 校验 —— 缺密钥不会跑到一半才炸。
 *
 * 🔴 为什么不用 `@nestjs/config`：03 文档 §8.5 要求「后端运行依赖 ≤ 12 个」，
 *    zod 手写解析 40 行即可省掉一个依赖。见 ADR-0004「依赖预算」章节。
 */

import { Global, Module } from '@nestjs/common';

import { AppConfigStore } from './app-config.store.js';
import { AppSecretStore } from './app-secret.store.js';
import { type Env, parseEnv } from './env.js';
import { ENV_CONFIG } from './tokens.js';

export { ENV_CONFIG };
export { AppConfigStore, AppSecretStore };

@Global()
@Module({
  providers: [
    { provide: ENV_CONFIG, useFactory: (): Env => parseEnv(process.env) },
  ],
  exports: [ENV_CONFIG],
})
export class ConfigModule {}
