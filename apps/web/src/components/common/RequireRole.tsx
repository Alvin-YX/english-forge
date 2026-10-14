import type { ReactNode } from 'react';

import { Card } from '../ui/Card';

import { StateView } from './StateView';

interface RequireRoleProps {
  /** 当前登录用户的角色；`null`/`undefined` 表示用户信息尚未拉取 */
  userRole: string | undefined;
  /** 允许访问的角色（OR 关系） */
  allowed: ReadonlyArray<string>;
  /** 无权限时的标题 */
  fallbackTitle: string;
  /** 无权限时的说明 */
  fallbackMessage: string;
  children: ReactNode;
}

/**
 * 角色门禁：非授权角色看到锁定的空态，而不是加载圈或「服务不可用」。
 *
 * 为什么需要它：`ProtectedRoute` 只判断登录态，任何登录用户都能打开管理员路由。
 * 这里同时兜住两种进入方式 —— 侧栏菜单（由 `user.role === 'admin'` 决定是否渲染）
 * 和直接粘贴 URL。后端 `@Roles(Role.ADMIN)` 是真正的权限边界，本组件只负责
 * 让越权访问**看起来像越权**，而不是白屏或误报故障。
 *
 * 有意在 `userRole === undefined` 时也拦下：用户信息缺失时渲染表单会让用户
 * 填完才收到 403，不如先显示「请先完成登录」这类可读的空态。
 */
export function RequireRole({
  userRole,
  allowed,
  fallbackTitle,
  fallbackMessage,
  children,
}: RequireRoleProps) {
  if (!userRole || !allowed.includes(userRole)) {
    return (
      <Card>
        <StateView icon="🔒" tone="muted" title={fallbackTitle} message={fallbackMessage} />
      </Card>
    );
  }
  return <>{children}</>;
}
