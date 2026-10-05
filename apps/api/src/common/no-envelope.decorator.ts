/**
 * `@NoEnvelope()` —— 标记不需要 `{code,message,data}` 包装的路由。
 *
 * 适用场景（03 文档 §5）：
 * - SSE 流（跟读评分进度 `GET /records/:id/events`、对话流式）：`text/event-stream`
 * - 二进制/Range 回放（`GET /error-samples/:id/replay`）
 * - 302 跳转（nginx `X-Accel-Redirect`）
 *
 * 这些路由的响应体不是 JSON 对象，被 `EnvelopeInterceptor` 包装会直接产出非法响应。
 */

import { SetMetadata } from '@nestjs/common';

export const NO_ENVELOPE_KEY = 'api:noEnvelope';

export const NoEnvelope = (): MethodDecorator & ClassDecorator => SetMetadata(NO_ENVELOPE_KEY, true);
