/**
 * 全局异常过滤器 —— 把任意异常收敛为「HTTP 语义码 + ErrorCode 分段」的 envelope。
 *
 * 错误码分段严格遵循 `packages/contracts/src/api/response.ts` 已定义的取值：
 *   `1xxx` 认证与授权 / `2xxx` 词库与教材 / `3xxx` 练习与评分 / `6xxx` 媒体与系统。
 *
 * 🔴 已知文档偏差（如实登记，未擅改文档口径）：03 文档 §1.6 写的是
 *   「`4001x` 参数/校验、`401xx` 未认证…」五位分段，而 contracts 实际实现是
 *   `VALIDATION_FAILED=1001`、`UNAUTHENTICATED=1101` 的**四位**分段。
 *   以 contracts 为准（它是前端 `openapi-typescript` 生成的类型单一来源，
 *   改这里会立刻炸掉契约）。详见 ADR-0004 的「已知偏差」章节。
 *
 * 🔴 5xx 绝不回显异常原文：`UNKNOWN_ERROR` + 固定文案。日志里才有堆栈。
 *    否则 SQL/路径/栈信息会随响应体泄漏给客户端（03 文档 §8.5 安全测试）。
 */

import { randomBytes } from 'node:crypto';

import { type ApiResponse, type ErrorCodeValue, ErrorCode } from '@eng-forge/contracts/api';
import { type ArgumentsHost, Catch, type ExceptionFilter, HttpException, HttpStatus, Injectable, Logger } from '@nestjs/common';
import type { Request, Response } from 'express';
import { ZodError } from 'zod';

import { BusinessError } from './errors.business.js';

const TRACE_HEADER = 'x-trace-id';

interface MappedError {
  status: number;
  code: ErrorCodeValue;
  message: string;
}

/** HTTP 语义码 → ErrorCode（contracts 已定义分段内取值） */
function codeForStatus(status: number): ErrorCodeValue {
  switch (status) {
    case HttpStatus.UNAUTHORIZED:
      return ErrorCode.UNAUTHENTICATED;
    case HttpStatus.FORBIDDEN:
      return ErrorCode.FORBIDDEN;
    case HttpStatus.NOT_FOUND:
      return ErrorCode.RESOURCE_NOT_FOUND;
    case HttpStatus.CONFLICT:
      return ErrorCode.DUPLICATE_RESOURCE;
    case HttpStatus.TOO_MANY_REQUESTS:
      return ErrorCode.RATE_LIMITED;
    case HttpStatus.UNPROCESSABLE_ENTITY:
      return ErrorCode.IDEMPOTENCY_CONFLICT;
    case HttpStatus.PAYLOAD_TOO_LARGE:
      return ErrorCode.VALIDATION_FAILED;
    case HttpStatus.BAD_REQUEST:
      return ErrorCode.VALIDATION_FAILED;
    default:
      return status >= HttpStatus.INTERNAL_SERVER_ERROR ? ErrorCode.UNKNOWN_ERROR : ErrorCode.VALIDATION_FAILED;
  }
}

/**
 * 🔴 `@Catch()` 必须标在**类**上，不能标在 `catch()` 方法上：
 *    `@nestjs/common` 的 `Catch` 返回类型是 `ClassDecorator`（1 参数），
 *    当 TS 5.7 的 `experimentalDecorators: true` 下用作方法装饰器时，
 *    期望的是 `MethodDecorator`（3 参数），会报 TS1241/TS1270。
 *    官方示例文档里把 `@Catch()` 写在方法上方，但那在严格类型下编译不过。
 */
@Injectable()
@Catch()
export class ApiExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger(ApiExceptionFilter.name);

  catch(exception: unknown, host: ArgumentsHost): void {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();
    const request = ctx.getRequest<Request>();

    const mapped = this.map(exception);
    const traceId = this.traceId(request);

    if (mapped.status >= HttpStatus.INTERNAL_SERVER_ERROR) {
      this.logger.error(
        `[${traceId}] 未处理异常 status=${mapped.status} :: ${this.describe(exception)}`,
      );
    }

    const body: ApiResponse<null> = {
      code: mapped.code,
      message: mapped.message,
      data: null,
      traceId,
    };
    response.status(mapped.status).json(body);
  }

  private map(exception: unknown): MappedError {
    if (exception instanceof BusinessError) {
      return { status: exception.httpStatus, code: exception.code, message: exception.message };
    }

    // zod 校验失败：走统一的 400 + VALIDATION_FAILED
    // （zod 3.25 没有 `isZodError` 工具函数，用 instanceof 判定）
    if (exception instanceof ZodError) {
      return { status: HttpStatus.BAD_REQUEST, code: ErrorCode.VALIDATION_FAILED, message: '请求参数校验失败' };
    }

    // passport-jwt / jsonwebtoken 抛的类不走 HttpException，按 name 兜底
    if (exception instanceof Error && exception.name === 'TokenExpiredError') {
      return { status: HttpStatus.UNAUTHORIZED, code: ErrorCode.TOKEN_EXPIRED, message: '登录已过期' };
    }
    if (
      exception instanceof Error &&
      (exception.name === 'JsonWebTokenError' || exception.name === 'NotBeforeError')
    ) {
      return { status: HttpStatus.UNAUTHORIZED, code: ErrorCode.TOKEN_INVALID, message: '登录凭证无效' };
    }

    if (exception instanceof HttpException) {
      const status = exception.getStatus();
      const reason = exception.getResponse();
      const message =
        typeof reason === 'string'
          ? reason
          : ((reason as { message?: string | string[] }).message ?? exception.message);
      const flat = Array.isArray(message) ? message.join('; ') : message;
      return { status, code: codeForStatus(status), message: flat };
    }

    return {
      status: HttpStatus.INTERNAL_SERVER_ERROR,
      code: ErrorCode.UNKNOWN_ERROR,
      message: '服务内部错误',
    };
  }

  private traceId(request: Request): string {
    const raw = request.header(TRACE_HEADER);
    if (typeof raw === 'string' && raw.length > 0) return raw;
    return randomBytes(8).toString('hex');
  }

  private describe(exception: unknown): string {
    if (exception instanceof Error) return exception.stack ?? `${exception.name}: ${exception.message}`;
    return String(exception);
  }
}
