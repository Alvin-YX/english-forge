/**
 * `audit_log` 写入服务 —— 03 文档 §9.2「安全基线：关键操作留存 ≥ 6 个月」
 *
 * 🔴 为什么单独抽一个服务：审计要写 `user.id`（操作者）与 `detail`（json），
 *    如果各控制器各自拼 insert，很容易漏掉 `actorId` 或把敏感字段写进 `detail`
 *    —— 而审计表**永久留存**，写错一次的代价远高于多一个类。
 *
 * 放在 `infra/audit/` 而不是 `modules/system/`：
 *   - 依赖边界规则 `infra-no-business-dep` 允许 infra 依赖 `auth|user|taxonomy`，
 *     但**禁止**依赖 `conversation` / `content` 等业务层；
 *   - 审计本身无业务语义（只写一行日志），做成 infra 服务后
 *     conversation / content / system 都可以依赖它，不会产生反向边。
 *
 * 🔴 `detail` 只允许调用方显式传入「可留存的结构化摘要」：
 *    审计表随数据库备份导出，任何 Key、token、原始音频路径都不该落进来。
 *    本服务不做字段级过滤（调用方才知道什么敏感），但**不做 JSON.stringify 兜底**，
 *    传入不可序列化的值时直接抛错，让「想记敏感数据」这件事在测试期就暴露。
 */

import type { AuditAction } from '@eng-forge/db/schema';
import { auditLog } from '@eng-forge/db/schema';
import { Inject, Injectable, Logger } from '@nestjs/common';

import { DbConnection } from '../db/db.module.js';

export interface AuditInput {
  /** 操作类型（`AUDIT_ACTIONS` 枚举） */
  action: AuditAction;
  /** 被操作对象的类型，如 `word` / `app_config` / `user` */
  targetType?: string;
  /** 被操作对象的 id（字符串：`bigint` 在边界处统一转 string） */
  targetId?: string;
  /** 操作者账号 id；系统任务/CLI 脚本执行时为 undefined（落库为 NULL） */
  actorId?: number;
  /** 可留存的结构化摘要（禁止放密钥、token、个人信息原文） */
  detail?: Record<string, unknown>;
  /** 客户端 IP */
  ip?: string;
  /** User-Agent */
  ua?: string;
}

const USER_AGENT_MAX = 255;
const IP_MAX = 45; // IPv6 最长 45 字符，见 `audit_log` schema 注释

@Injectable()
export class AuditService {
  private readonly logger = new Logger(AuditService.name);

  constructor(@Inject(DbConnection) private readonly conn: DbConnection) {}

  /**
   * 写一条审计记录。
   *
   * 🔴 **失败不抛错**：审计是旁路观测，不能让「审计写失败」把主流程打挂
   *    （否则一次磁盘抖动会让全站保存操作 500，用户会以为是功能坏了）。
   *    失败只打 error 日志 —— 这条日志本身就要能被运维看到。
   */
  async record(input: AuditInput): Promise<void> {
    try {
      await this.conn.db.insert(auditLog).values({
        actorId: input.actorId ?? null,
        action: input.action,
        targetType: input.targetType ?? null,
        targetId: input.targetId ?? null,
        detail: input.detail ?? null,
        ip: input.ip ? input.ip.slice(0, IP_MAX) : null,
        ua: input.ua ? input.ua.slice(0, USER_AGENT_MAX) : null,
        createdAt: new Date(),
      });
    } catch (err) {
      this.logger.error(`[audit] 写入失败 action=${input.action}：${err instanceof Error ? err.message : err}`);
    }
  }
}
