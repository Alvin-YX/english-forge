/**
 * `@Public()` —— 白名单标记，把路由排除在「全局 JWT + 档案守卫」之外。
 *
 * 🔴 架构选择：**默认全部需要认证，白名单显式豁免**（opt-out），
 *    而不是「每个路由记得加 @UseGuards」。
 *    漏加守卫 = 接口裸奔；漏加 @Public = 401，前者是安全事故、后者只是 bug。
 *    这就是 04 文档 §6.5 第 4 条「架构保证 vs 纪律保证」的落地方式。
 *
 * 当前白名单（03 文档 §5.1 / §5.7）：
 *   - `POST /auth/register`  - 未登录才能注册
 *   - `POST /auth/login`     - 登录本身
 *   - `POST /auth/refresh`   - access 过期后刷新
 *   - `GET /healthz` `/readyz` - 存活/就绪探针（§9.3：除健康检查外全部鉴权）
 */

import { SetMetadata } from '@nestjs/common';

export const IS_PUBLIC_KEY = 'auth:isPublic';

export const Public = (): MethodDecorator & ClassDecorator => SetMetadata(IS_PUBLIC_KEY, true);
