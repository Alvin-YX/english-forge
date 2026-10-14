/**
 * 审计上下文注入装饰器 —— 控制器拿「谁干的 + 从哪干的」的唯一入口。
 *
 * 🔴 与 `@CurrentUser()` 并列而非复用：`ProfileScope` 只有 `userId/profileId/role`，
 *    审计还需要 IP 与 UA（`request.ip` / `user-agent`），这两项只在 HTTP 层可见。
 *    把请求对象直接注入控制器会让审计参数散落在每个方法里，评审时容易漏字段。
 *
 * actorId 只从 `request.scope.userId` 取 —— 绝不接受客户端在 body 里声明「我是谁」，
 * 这与 `profile-scope.ts` 的「数据来源被物理隔离在认证守卫之后」是同一原则。
 */

import { createParamDecorator, type ExecutionContext } from '@nestjs/common';

export interface AuditMeta {
  /** 操作者账号 id（`user.id`） */
  actorId: number;
  /** 客户端 IP */
  ip?: string;
  /** User-Agent */
  ua?: string;
}

export const CurrentAuditMeta = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): AuditMeta => {
    const req = ctx.switchToHttp().getRequest();
    const scope = req.scope;
    return {
      actorId: scope?.userId,
      ip: typeof req.ip === 'string' ? req.ip : undefined,
      ua: typeof req.get === 'function' ? req.get('user-agent') : undefined,
    };
  },
);
