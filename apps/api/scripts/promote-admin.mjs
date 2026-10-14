#!/usr/bin/env tsx
/**
 * 把指定用户名提为 admin（一次性运维脚本）。
 *
 * 为什么需要：注册接口的 role 是客户端自选的，但提权一个**已存在**的账号
 * 只能改库。比起重新注册一个 admin 账号，这里能避免生产库里多挂一个
 * 无用的测试账号，并且把变更写进 `audit_log` 留痕。
 *
 * 用法：
 *   pnpm --filter @eng-forge/api exec tsx scripts/promote-admin.mjs <username>
 *   # 生产容器内：
 *   docker exec englishforge-api-1 node apps/api/scripts/promote-admin.mjs alvin
 *
 * 🔴 放在 apps/api/scripts/ 而非仓库根 scripts/：生产镜像 `pnpm install --prod`，
 * workspace 符号链接只落在 apps/api/node_modules 下，放根 scripts/ 会 ERR_MODULE_NOT_FOUND
 * （2026-10-14 生产实测）。
 *
 * 🔴 本仓库 *.mjs 一律是纯 JS：tsx 不会对 .mjs 剥离 TypeScript 类型标注，
 * 函数签名写 `(): Promise<void>` 会直接抛 SyntaxError。
 *
 * 幂等：已经是 admin 则打印当前状态并退出 0。顺带把 `status` 置回 `active`
 * —— 被禁用/软删的账号提权没有意义，直接跳过会让运维误以为命令没生效。
 */

import { eq } from 'drizzle-orm';

import { createDb } from '@eng-forge/db/client.js';
import { auditLog } from '@eng-forge/db/schema/system.js';
import { user } from '@eng-forge/db/schema/user.js';

const ADMIN_ROLE = 'admin';

const username = process.argv[2]?.trim();

if (!username) {
  console.error('用法: tsx apps/api/scripts/promote-admin.mjs <username>');
  process.exit(1);
}

const client = createDb();

try {
  const rows = await client.db
    .select({ id: user.id, username: user.username, role: user.role, status: user.status })
    .from(user)
    .where(eq(user.username, username))
    .limit(1);

  const row = rows[0];

  if (!row) {
    console.error(`[promote-admin] 未找到用户 "${username}"（用户名区分大小写）`);
    process.exit(1);
  }

  if (row.role === ADMIN_ROLE && row.status === 'active') {
    console.log(`[promote-admin] "${username}" (id=${row.id}) 已是 admin 且状态 active，无需变更`);
    process.exit(0);
  }

  const prevRole = row.role;
  const prevStatus = row.status;

  await client.db.update(user).set({ role: ADMIN_ROLE, status: 'active', updatedAt: new Date() }).where(eq(user.id, row.id));

  // actorId 留 NULL：schema 约定「操作者；系统任务执行时为 NULL」，
  // CLI 脚本的操作者不在应用账号体系内，写目标用户 id 会把 actor 与 target 混为一谈。
  await client.db.insert(auditLog).values({
    actorId: null,
    action: 'role_change',
    targetType: 'user',
    targetId: String(row.id),
    detail: {
      username,
      from: prevRole,
      to: ADMIN_ROLE,
      statusFrom: prevStatus,
      statusTo: 'active',
      via: 'apps/api/scripts/promote-admin.mjs',
    },
  });

  console.log(`[promote-admin] 已提升 "${username}" (id=${row.id})：${prevRole}/${prevStatus} → ${ADMIN_ROLE}/active`);
  console.log('[promote-admin] 已写入 audit_log (action=role_change)。该用户需重新登录才会拿到新角色 token。');
} catch (err) {
  console.error(`[promote-admin] 失败：${err instanceof Error ? err.message : err}`);
  process.exit(2);
} finally {
  await client.close();
}
