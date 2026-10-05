/**
 * 统一响应体拦截器 —— 03 文档 §5「`{code, message, data}` 全 API 共用」
 *
 * 成功响应统一包装为 `{ code: 0, message: 'ok', data: <handler 返回值> }`，
 * 错误响应由 `ApiExceptionFilter` 负责（本拦截器不碰异常路径）。
 *
 * 🔴 顺序约定（**重要**）：本拦截器必须注册在 `IdempotencyInterceptor` **内侧**。
 *    幂等重放要缓存「客户端实际看到的响应体」，因此它必须在最外层截获
 *    已完成 envelope 包装的响应。`app.module.ts` 的 `APP_INTERCEPTOR`
 *    数组顺序即该约定（外层在前）。
 *
 * 🔴 SSE 与二进制流（跟读评分进度、对话流式、音频回放）会破坏 JSON 包装，
 *    此类路由必须标 `@NoEnvelope()`。见 `no-envelope.decorator.ts`。
 */

import { type ApiResponse, ErrorCode } from '@eng-forge/contracts/api';
import { type CallHandler, type ExecutionContext, Injectable, type NestInterceptor, Inject } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { type Observable, map } from 'rxjs';

import { NO_ENVELOPE_KEY } from './no-envelope.decorator.js';

@Injectable()
export class EnvelopeInterceptor implements NestInterceptor<unknown, ApiResponse<unknown>> {
  constructor(@Inject(Reflector) private readonly reflector: Reflector) {}

  intercept(context: ExecutionContext, next: CallHandler<unknown>): Observable<ApiResponse<unknown>> {
    const skip = this.reflector.getAllAndOverride<boolean>(NO_ENVELOPE_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (skip === true) {
      return next.handle() as Observable<ApiResponse<unknown>>;
    }

    return next.handle().pipe(
      map((data): ApiResponse<unknown> => ({
        code: ErrorCode.OK,
        message: 'ok',
        data: data === undefined ? null : data,
      })),
    );
  }
}
