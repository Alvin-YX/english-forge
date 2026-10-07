/**
 * 业务异常 —— 全 API 唯一受检异常形态。
 *
 * 约定（03 文档 §5 + CONTRIBUTING.md §3）：
 * - 业务侧**一律** `throw new BusinessError(ErrorCode.X, ...)`，禁止抛原始 Error/HttpException，
 *   否则错误码会退化成 `UNKNOWN_ERROR` 且 HTTP 语义码丢失。
 * - `httpStatus` 走 HTTP 语义（4xx/5xx），`code` 走 contracts 的错误码分段，
 *   两者**独立**：同一个 code 不会绑定固定 HTTP 码，反之亦然。
 * - `details` 只放**可安全暴露给前端**的结构化信息（如校验失败字段清单），
 *   不得放栈信息、SQL、密钥。
 */

import { type ErrorCodeValue, ErrorCode } from '@eng-forge/contracts/api';

export class BusinessError extends Error {
  readonly code: ErrorCodeValue;
  readonly httpStatus: number;
  readonly details?: unknown;

  constructor(code: ErrorCodeValue, message: string, httpStatus = 400, details?: unknown) {
    super(message);
    this.name = 'BusinessError';
    this.code = code;
    this.httpStatus = httpStatus;
    this.details = details;
  }
}

/** 参数校验失败的统一构造器（zod pipe 与手写校验共用，避免各写各的 code） */
export function validationError(message: string, details?: unknown): BusinessError {
  return new BusinessError(ErrorCode.VALIDATION_FAILED, message, 400, details);
}

/** 资源不存在 */
export function notFoundError(code: ErrorCodeValue, message: string): BusinessError {
  return new BusinessError(code, message, 404);
}

/**
 * 服务端不变量被破坏（如 `INSERT ... RETURNING` 回了空数组）。
 *
 * 🔴 刻意与 `notFoundError` 区分：这类错误**不是**「用户请求的资源不存在」，
 *    而是「代码/数据状态违反了本不该违反的约定」，用 404 会把基础设施故障
 *    伪装成正常业务分支，导致排障时走错方向。
 *    code 走 `UNKNOWN_ERROR` 是刻意的 —— 5xx 一律不向前端暴露内部细节，
 *    详见 `http-exception.filter.ts` §5xx 处理。
 */
export function internalInvariantError(message: string): BusinessError {
  return new BusinessError(ErrorCode.UNKNOWN_ERROR, message, 500);
}

/** 未认证（缺 token / 凭证形态不合法） */
export function unauthenticatedError(message = '请先登录'): BusinessError {
  return new BusinessError(ErrorCode.UNAUTHENTICATED, message, 401);
}

/** 凭证无效（签名错、payload 形状不合法） */
export function tokenInvalidError(message = '登录凭证无效'): BusinessError {
  return new BusinessError(ErrorCode.TOKEN_INVALID, message, 401);
}

/** 越权（角色不足） */
export function rbacDeniedError(message = '当前角色无此权限'): BusinessError {
  return new BusinessError(ErrorCode.RBAC_DENIED, message, 403);
}

/** 🔴 跨档案访问（REQ-011 架构级隔离） */
export function profileForbiddenError(message = '无权访问该档案的数据'): BusinessError {
  return new BusinessError(ErrorCode.PROFILE_FORBIDDEN, message, 403);
}
