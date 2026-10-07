/**
 * Zod query 参数布尔值 helper —— 03 文档 §5「契约优先」
 *
 * 🔴 为什么不能直接用 `z.coerce.boolean()`：
 *
 *   JS 的 `Boolean('false')` 是 **true**（非空字符串恒真）。
 *   于是 `?resolved=false` 会被 coerce 成 `true`，
 *   本意「只看未解决」却变成「只看已解决」——过滤方向反了，且静默无报错。
 *   同理 `?includePurged=true` 会被 coerce 成 `false`，
 *   把「含已清除」变成「只看未清除」。
 *
 *   这是 `z.coerce.*` 家族的通病：`coerce` 等价于 `Boolean(value)` / `Number(value)`，
 *   不理解「显式 false 标记」的 HTTP 查询语义。
 *
 *   正确做法是把字符串白名单化：只接受 `'true'` / `'false'`（大小写不敏感），
 *   其余原样交给 `z.coerce.boolean()` 处理（数字 1/0、真正的布尔值等）。
 *
 * 用法：
 * ```ts
 * import { boolQuery } from '../../common/bool-query.js';
 * const SCHEMA = z.object({
 *   resolved: boolQuery().optional(),       // 无默认值 = 「不过滤」
 *   includePurged: boolQuery().optional().default(false),
 * });
 * ```
 *
 * ⚠️ 「过滤型」布尔参数**不要**给默认值：
 *    不传该参数应表示「不过滤」，而不是「过滤为 false」。
 *    `.optional()` 让字段保持 `undefined`，service 层用
 *    `if (query.x !== undefined) conditions.push(...)` 判断是否生效。
 */

import { z } from 'zod';

/**
 * 把 HTTP 查询字符串转成布尔值的 Zod schema。
 *
 * - `'true'` / `'1'` → `true`
 * - `'false'` / `'0'` → `false`
 * - 其他值（空串、undefined、非法字符串）→ 校验失败，返回 `VALIDATION_FAILED`
 *
 * 比 `z.coerce.boolean()` 严格：非法值会 400，而不是被静默当作 `true`。
 * 比 `z.boolean()` 宽容：仍然接受 query string 传过来的字符串形态。
 */
export function boolQuery(): z.ZodType<boolean, z.ZodTypeDef, boolean> {
  // 🔴 `z.preprocess` 返回 `ZodEffects<ZodBoolean, boolean, unknown>`，
  //    其 `_input` 是 `unknown`（因为预处理前拿到的可能是任何类型）。
  //    直接声明返回 `ZodType<boolean>` 会报「_input: unknown 不能赋给 boolean」，
  //    这里用一个类型断言显式收窄 —— 语义上等价：`safeParse` 的输出恒为 `boolean`。
  return z
    .preprocess((v) => {
      if (typeof v === 'string') {
        const s = v.trim().toLowerCase();
        if (s === 'true' || s === '1') return true;
        if (s === 'false' || s === '0') return false;
      }
      return v;
    }, z.boolean()) as unknown as z.ZodType<boolean, z.ZodTypeDef, boolean>;
}
