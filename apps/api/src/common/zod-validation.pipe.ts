/**
 * Zod 校验管道 —— 03 文档 §5「契约优先」的 NestJS 侧落地。
 *
 * 为什么不用 class-validator：03 文档 §8.5 依赖上限要求「后端运行依赖 ≤ 12」，
 * class-validator + class-transformer 是两个依赖，zod 是一个，且 zod 的 schema
 * 可直接序列化进 OpenAPI（`z.toJSONSchema()`），与「OpenAPI 3.1 单一契约」对齐。
 *
 * 用法：`@Body(new ZodValidationPipe(RegisterDtoSchema))` 或工厂 `zodPipe(Schema)`。
 * 失败统一抛 `BusinessError(VALIDATION_FAILED, 400, 字段清单)`，
 * 由 `ApiExceptionFilter` 包装成 envelope。
 */

import { ErrorCode } from '@eng-forge/contracts/api';
import { Injectable, type PipeTransform } from '@nestjs/common';
import type { ZodIssue, ZodSchema } from 'zod';

import { BusinessError } from './errors.business.js';

/** 校验失败最多回显 20 条，避免攻击者用超大畸形 payload 撑爆响应体 */
const MAX_ISSUES = 20;

export interface ValidationIssueView {
  path: string;
  message: string;
  code: string;
}

export function formatZodIssues(error: { issues: ZodIssue[] }): ValidationIssueView[] {
  return error.issues.slice(0, MAX_ISSUES).map((issue) => ({
    path: issue.path.map(String).join('.') || '<root>',
    message: issue.message,
    code: issue.code,
  }));
}

@Injectable()
export class ZodValidationPipe implements PipeTransform<unknown, unknown> {
  constructor(private readonly schema: ZodSchema) {}

  transform(value: unknown): unknown {
    const result = this.schema.safeParse(value);
    if (!result.success) {
      throw new BusinessError(
        ErrorCode.VALIDATION_FAILED,
        '请求参数校验失败',
        400,
        formatZodIssues(result.error),
      );
    }
    return result.data;
  }
}

/** 行内工厂：`@Body(zodPipe(RegisterDtoSchema))` */
export const zodPipe = (schema: ZodSchema): ZodValidationPipe => new ZodValidationPipe(schema);
