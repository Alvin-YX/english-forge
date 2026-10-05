/**
 * 幂等键存储 —— 03 文档 §5「所有写操作接受 `Idempotency-Key` 头，服务端按 key 去重 24h」。
 *
 * 表：`idempotency_key`（`packages/db/src/schema/system.ts`，复合主键 `(key, user_id, route)`）。
 *
 * 四态语义（`in_progress` + `request_hash` + `response_json` 三列共同表达）：
 *
 * | 情形                                | 返回       | 说明                    |
 * |-------------------------------------|------------|-------------------------|
 * | 无此 key                            | `first`    | 首次执行                |
 * | 有 key，`in_progress=true`          | `in-flight`| 并发重复（409）         |
 * | 有 key 已完成，`request_hash` 相同  | `replay`   | 原样回首次响应          |
 * | 有 key 已完成，`request_hash` 不同  | `conflict` | 同 key 换 body（409）  |
 *
 * 🔴 路由纳入主键：`POST /me/children/bind` 与 `POST /auth/refresh`
 *    即使 key 相同也不算重复 —— 同 key 可安全复用到不同接口。
 *
 * 🔴 body 哈希口径：JSON 请求体做 `jsonStringify` 后 SHA-256。
 *    multipart（M3 的 `POST /recordings` 录音上传）**必须**改为对文件字节哈希；
 *    当前按 url + content-length 兜底，这是**已知缺口**（见交付报告）。
 */

import { createHash } from 'node:crypto';

import { IDEMPOTENCY_TTL_MS, jsonStringify } from '@eng-forge/db';
import { idempotencyExpireAt, idempotencyKey } from '@eng-forge/db/schema';
import { Injectable, Inject } from '@nestjs/common';

import { DbConnection } from '../db/db.module.js';
import { and, eq, lt } from '../db/query.js';

export type IdempotencyClaim =
  | { kind: 'first' }
  | { kind: 'in-flight' }
  | { kind: 'replay'; responseJson: unknown }
  | { kind: 'conflict'; reason: 'body-mismatch' };

export interface IdempotencyTarget {
  readonly key: string;
  readonly userId: number;
  /** 归一化路由（含方法），如 `POST:/api/v1/me/profile` */
  readonly route: string;
  /** 请求体 SHA-256（hex 64） */
  readonly requestHash: string;
}

/** 计算请求体指纹。口径见文件头注释。 */
export function hashRequestBody(body: unknown, isMultipart: boolean, url: string, contentLength: string | undefined): string {
  const hash = createHash('sha256');
  if (isMultipart) {
    // 🔴 已知缺口：未按文件字节哈希，仅按长度 + 路径区分。M3 录音上传落地时必须替换。
    hash.update(`multipart:${url}:${contentLength ?? 'unknown'}:${jsonStringify(body)}`);
  } else {
    hash.update(jsonStringify(body ?? null));
  }
  return hash.digest('hex');
}

/**
 * JSON 列的跨方言读取。
 * 🔴 PG 驱动会把 JSON 列解析成对象，better-sqlite3 存的是 TEXT → 返回字符串。
 *    不统一会导致「replay 返回的是字符串而不是对象」。
 */
export function readJsonColumn(raw: unknown): unknown {
  if (typeof raw === 'string') {
    try {
      return JSON.parse(raw);
    } catch {
      return null;
    }
  }
  return raw ?? null;
}

@Injectable()
export class IdempotencyStore {
  constructor(@Inject(DbConnection) private readonly conn: DbConnection) {}

  /** 认领幂等键。首次插入返回 `first`，否则按已有记录归类。 */
  async claim(target: IdempotencyTarget): Promise<IdempotencyClaim> {
    const { key, userId, route, requestHash } = target;
    const createdAt = new Date();

    try {
      await this.conn.db
        .insert(idempotencyKey)
        .values({
          key,
          userId,
          route,
          requestHash,
          inProgress: true,
          createdAt,
          expireAt: idempotencyExpireAt(createdAt),
        })
        .onConflictDoNothing();
    } catch (err) {
      // SQLite 档下 onConflictDoNothing 语义一致；pg 档主键冲突走此路径兜底
      this.logInsertError(err, key, route);
    }

    const existing = await this.find(key, userId, route);
    if (existing === null) {
      // 插入成功（或并发插入后被对方先落库但仍未完成）→ 视为首次执行
      return { kind: 'first' };
    }
    if (existing.inProgress) {
      return { kind: 'in-flight' };
    }
    if (existing.requestHash !== requestHash) {
      return { kind: 'conflict', reason: 'body-mismatch' };
    }
    return { kind: 'replay', responseJson: readJsonColumn(existing.responseJson) };
  }

  /** 处理成功：落缓存响应并解除 in_progress。 */
  async finish(key: string, userId: number, route: string, responseJson: unknown): Promise<void> {
    await this.conn.db
      .update(idempotencyKey)
      .set({
        inProgress: false,
        responseJson: jsonStringify(responseJson) as unknown as Record<string, unknown>,
      })
      .where(and(eq(idempotencyKey.key, key), eq(idempotencyKey.userId, userId), eq(idempotencyKey.route, route)));
  }

  /** 处理失败：删除记录，允许客户端用同一 key 重试。 */
  async abort(key: string, userId: number, route: string): Promise<void> {
    await this.conn.db
      .delete(idempotencyKey)
      .where(and(eq(idempotencyKey.key, key), eq(idempotencyKey.userId, userId), eq(idempotencyKey.route, route)));
  }

  /** 清理过期键（scheduler 每日调用；单家庭量级下直接扫全表） */
  async purgeExpired(now: Date = new Date()): Promise<number> {
    const result = await this.conn.db
      .delete(idempotencyKey)
      .where(lt(idempotencyKey.expireAt, now))
      .returning({ key: idempotencyKey.key });
    return result.length;
  }

  /** TTL 供外部（scheduler / 文档）引用，避免魔法数字散落 */
  get ttlMs(): number {
    return IDEMPOTENCY_TTL_MS;
  }

  private async find(key: string, userId: number, route: string) {
    const rows = await this.conn.db
      .select({
        requestHash: idempotencyKey.requestHash,
        responseJson: idempotencyKey.responseJson,
        inProgress: idempotencyKey.inProgress,
      })
      .from(idempotencyKey)
      .where(and(eq(idempotencyKey.key, key), eq(idempotencyKey.userId, userId), eq(idempotencyKey.route, route)))
      .limit(1);
    return rows[0] ?? null;
  }

  private logInsertError(err: unknown, key: string, route: string): void {
    // 主键冲突是幂等语义的一部分（并发同 key），不是异常；但非冲突错误必须可见
    const message = err instanceof Error ? err.message : String(err);
    if (!/unique|duplicate|constraint|PRIMARY KEY/i.test(message)) {
      console.error(`[idempotency] 写入幂等键失败 key=${key} route=${route}: ${message}`);
    }
  }
}
