/**
 * 测试断言助手 —— 收口 `{ code, message, data }` 信封的拆包与下标访问。
 *
 * 🔴 为什么需要它（而不是在每个用例里写 `data.items[0]!.headword`）：
 *   tsconfig 开了 `noUncheckedIndexedAccess`，`arr[0]` 的类型是 `T | undefined`。
 *   直接 `!` 会把「列表为空」这个真实失败原因变成运行时的
 *   `Cannot read properties of undefined`，报错位置还落在断言之外，
 *   排障时看不出是哪个接口少返回了数据。
 *
 *   `at()` 在这里把 undefined 变成一条**指名道姓**的失败信息：
 *   哪个用例、哪个下标越界，一目了然。
 */

import { expect } from 'vitest';

import type { ApiResponse } from '@eng-forge/contracts/api';
import { ErrorCode } from '@eng-forge/contracts/api';

/** 拆出 `data` 并断言业务码为 OK —— 失败时直接打印 code + message */
export function expectOk<T>(body: ApiResponse<unknown>): T {
  expect(body.code, `期望 code=OK，实际 code=${body.code} message=${body.message}`).toBe(ErrorCode.OK);
  return body.data as T;
}

/**
 * 安全取下标元素：越界即失败，且失败信息里带上下文。
 *
 * @param label 出错时要展示的字段名（如 `words[0]`），用于定位
 */
export function at<T>(items: readonly T[] | undefined, index: number, label: string): T {
  expect(items, `${label}：响应 items 不是数组`).toBeInstanceOf(Array);
  const item = items?.[index];
  expect(item, `${label}：下标 ${index} 越界（实际长度 ${items?.length ?? 0}）`).toBeDefined();
  return item as T;
}

/** `at()` 的批量版：一次性断言列表至少有 `n` 个元素 */
export function atAll<T>(items: readonly T[] | undefined, n: number, label: string): T[] {
  expect(items, `${label}：响应 items 不是数组`).toBeInstanceOf(Array);
  expect(items?.length ?? 0, `${label}：期望至少 ${n} 个元素，实际 ${items?.length ?? 0} 个`).toBeGreaterThanOrEqual(n);
  return items?.slice(0, n) as T[];
}