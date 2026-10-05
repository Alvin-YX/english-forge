/**
 * `app_config` 表读写 —— 03 文档 §9.2/§9.3「可管理的**非敏感**配置」
 *
 * 🔴 与 `app_secret` 的分工是安全红线：
 *   - `app_config`：出网白名单、默认档位、功能开关 → **明文**，可被运维直接看到
 *   - `app_secret`：云 API Key → **只存密文**，本仓库不存在任何明文读取路径
 *   把 Key 写进本表会随备份/导出泄露密钥，故两表严格分离。
 *
 * 🔴 刻意**不加缓存**：单家庭部署（2-3 学生，单 NAS 实例）下每请求一次
 *    主键查询的开销可忽略；加缓存反而引入「改了表但读到旧值」的排查黑洞。
 *    若 M3 的评分热路径证明是瓶颈，再按 `updated_at` 做 TTL 缓存。
 *
 * 类型映射：列是 `TEXT`，按 `value_type` 编解码（4 种：string/number/boolean/json），
 * 避免 PG 的 `::json` 与 SQLite 的 TEXT 在类型上分叉。
 */

import { type ConfigValueType, appConfig } from '@eng-forge/db/schema';
import { Injectable, Inject } from '@nestjs/common';

import { DbConnection } from '../db/db.module.js';
import { eq } from '../db/query.js';

export interface AppConfigView {
  key: string;
  value: unknown;
  valueType: ConfigValueType;
  group: string;
  editable: boolean;
  updatedAt: Date;
}

export interface AppConfigUpsertOptions {
  valueType?: ConfigValueType;
  group?: string;
  description?: string;
  editable?: boolean;
}

function decode(raw: string | null, valueType: ConfigValueType): unknown {
  if (raw === null) return null;
  switch (valueType) {
    case 'number':
      return Number(raw);
    case 'boolean':
      return raw === 'true' || raw === '1';
    case 'json':
      try {
        return JSON.parse(raw);
      } catch {
        // 脏数据（手工改库）不应当炸掉整个 API，退化为 null
        return null;
      }
    default:
      return raw;
  }
}

function encode(value: unknown, valueType: ConfigValueType): string {
  switch (valueType) {
    case 'json':
      return JSON.stringify(value ?? null);
    case 'boolean':
      return value === true ? 'true' : 'false';
    default:
      return String(value ?? '');
  }
}

@Injectable()
export class AppConfigStore {
  constructor(@Inject(DbConnection) private readonly conn: DbConnection) {}

  async getRaw(key: string): Promise<AppConfigView | null> {
    const rows = await this.conn.db
      .select()
      .from(appConfig)
      .where(eq(appConfig.key, key))
      .limit(1);
    const row = rows[0];
    if (row === undefined) return null;
    return {
      key: row.key,
      value: decode(row.value, row.valueType),
      valueType: row.valueType,
      group: row.group,
      editable: row.editable,
      updatedAt: row.updatedAt,
    };
  }

  /** 按 `value_type` 解码后返回；不存在或值为空返回 `null` */
  async get<T = unknown>(key: string): Promise<T | null> {
    const row = await this.getRaw(key);
    if (row === null || row.value === null) return null;
    return row.value as T;
  }

  async upsert(key: string, value: unknown, options: AppConfigUpsertOptions = {}): Promise<void> {
    const valueType = options.valueType ?? inferValueType(value);
    const set: Record<string, unknown> = {
      value: encode(value, valueType),
      valueType,
      group: options.group ?? 'general',
      description: options.description ?? null,
      editable: options.editable ?? true,
      updatedAt: new Date(),
    };
    await this.conn.db
      .insert(appConfig)
      .values({ key, ...set })
      .onConflictDoUpdate({ target: appConfig.key, set });
  }

  async remove(key: string): Promise<void> {
    await this.conn.db.delete(appConfig).where(eq(appConfig.key, key));
  }
}

/** 未显式指定类型时按 JS 值推断（数组/对象 → json） */
function inferValueType(value: unknown): ConfigValueType {
  if (typeof value === 'boolean') return 'boolean';
  if (typeof value === 'number') return 'number';
  if (value !== null && typeof value === 'object') return 'json';
  return 'string';
}
