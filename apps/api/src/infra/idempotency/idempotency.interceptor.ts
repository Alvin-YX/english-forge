/**
 * 幂等拦截器 —— 03 文档 §5「所有写操作接受 `Idempotency-Key` 头」。
 *
 * 🔴 实现为 Interceptor 而非 Middleware（03 文档口径写作「中间件」，功能等价，
 *    但中间件跑在 Guard 之前拿不到 `request.userId`，也拿不到 handler 返回值来缓存，
 *    因此无法实现「重放时原样返回首次响应」。这里如实登记此偏离。
 *
 * 🔴 注册顺序：本拦截器必须在外层（`EnvelopeInterceptor` 在内层）。
 *    这样缓存的是**已完成 `{code,message,data}` 包装**的最终响应体，
 *    重放时直接返回，形状与首次调用完全一致。
 *
 * 覆盖范围：`POST` / `PATCH` / `PUT` / `DELETE`。无 `Idempotency-Key` 头时
 * 行为与不加拦截器一致（文档口径是「接受」而非「强制」）。
 */

import { ErrorCode } from '@eng-forge/contracts/api';
import { type CallHandler, type ExecutionContext, Injectable, type NestInterceptor, Inject } from '@nestjs/common';
import type { Request } from 'express';
import { type Observable, from } from 'rxjs';
import { lastValueFrom } from 'rxjs';

import { BusinessError } from '../../common/errors.business.js';

import { IdempotencyStore, hashRequestBody } from './idempotency.store.js';

const WRITE_METHODS = new Set(['POST', 'PATCH', 'PUT', 'DELETE']);

/** Idempotency-Key 长度上限 = 表主键列 `key VARCHAR(191)` */
const MAX_KEY_LENGTH = 191;

@Injectable()
export class IdempotencyInterceptor implements NestInterceptor<unknown, unknown> {
  constructor(@Inject(IdempotencyStore) private readonly store: IdempotencyStore) {}

  intercept(context: ExecutionContext, next: CallHandler<unknown>): Observable<unknown> {
    const request = context.switchToHttp().getRequest<Request>();

    if (!WRITE_METHODS.has(request.method)) return next.handle();
    if (request.userId === undefined) return next.handle();

    const rawKey = request.headers['idempotency-key'];
    if (typeof rawKey !== 'string' || rawKey.trim() === '') return next.handle();

    const key = rawKey.trim().slice(0, MAX_KEY_LENGTH);
    const userId = request.userId;
    const contentType = request.headers['content-type'];
    const isMultipart = typeof contentType === 'string' && contentType.includes('multipart/');
    const requestHash = hashRequestBody(request.body, isMultipart, request.path, request.headers['content-length']);
    const route = `${request.method}:${request.path ?? request.originalUrl}`;

    return from(
      this.store.claim({ key, userId, route, requestHash }).then((claim) => {
        if (claim.kind === 'replay') {
          return claim.responseJson;
        }
        if (claim.kind === 'conflict') {
          throw new BusinessError(
            ErrorCode.IDEMPOTENCY_CONFLICT,
            '同一 Idempotency-Key 已用于不同的请求体',
            409,
          );
        }
        if (claim.kind === 'in-flight') {
          throw new BusinessError(
            ErrorCode.IDEMPOTENCY_CONFLICT,
            '同一 Idempotency-Key 正在处理中，请稍后重试',
            409,
          );
        }

        return lastValueFrom(next.handle()).then(
          (data) => this.store.finish(key, userId, route, data).then(() => data),
          (err: unknown) =>
            this.store.abort(key, userId, route).then(() => {
              throw err;
            }),
        );
      }),
    );
  }
}
