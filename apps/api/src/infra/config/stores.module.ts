/**
 * 配置持久化 Store 模块 —— `@Global()`，全应用共享。
 *
 * 🔴 为什么把 AppConfigStore / AppSecretStore 从 ConfigModule 拆出来：
 *    这两个 store 需要注入 `DbConnection`（`DbModule` 提供），如果直接放进
 *    `ConfigModule`，则 `ConfigModule` 必须 `imports: [DbModule]`，形成
 *    `ConfigModule → DbModule → ConfigModule(ENV_CONFIG)` 的循环。
 *    拆成独立模块后：`StoresModule imports [ConfigModule, DbModule]`，
 *    `ConfigModule` 只负责 ENV_CONFIG 装配，`DbModule` 只负责连接，无环。
 *
 * 语义边界：
 *   - `ConfigModule`：只暴露 `ENV_CONFIG`（进程级 env 解析）
 *   - `StoresModule`：把 `app_config` / `app_secret` 两张表包成可读写的 store
 * 二者都是 `@Global()`，业务层按需注入即可。
 */

import { Global, Module } from '@nestjs/common';

import { DbModule } from '../db/db.module.js';

import { AppConfigStore } from './app-config.store.js';
import { AppSecretStore } from './app-secret.store.js';
import { ConfigModule } from './config.module.js';

@Global()
@Module({
  imports: [ConfigModule, DbModule],
  providers: [AppConfigStore, AppSecretStore],
  exports: [AppConfigStore, AppSecretStore],
})
export class StoresModule {}
