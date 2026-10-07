/**
 * 调度器服务 —— 作业审计 + 系统通知
 *
 * 🔴 jobAudit 表无 userId 列，是系统级表，不需要 profileWhere。
 * 🔴 systemNotice 表有 userId 列，必须经 profileWhere() 过滤。
 */

import { ErrorCode } from '@eng-forge/contracts/api';
import { jobAudit, systemNotice } from '@eng-forge/db/schema';
import { Inject, Injectable } from '@nestjs/common';
import { z } from 'zod';

import { notFoundError } from '../../common/errors.business.js';
import { boolQuery } from '../../common/bool-query.js';
import { DbConnection } from '../../infra/db/db.module.js';
import { asc, count, desc, eq, sql } from '../../infra/db/query.js';
import { profileWhere, type ProfileScope } from '../../infra/profile/profile-scope.js';

export interface JobAuditView {
  id: number;
  jobName: string;
  refId?: number;
  status: 'running' | 'done' | 'failed';
  attempts: number;
  error?: string;
  startedAt?: string;
  finishedAt?: string;
  createdAt: string;
}

export interface NoticeView {
  id: number;
  category: string;
  level: string;
  title: string;
  body?: string;
  link?: string;
  refType?: string;
  refId?: string;
  readAt?: string;
  createdAt: string;
}

const POSITIVE_INT = z.coerce.number().int().positive();

export const LIST_JOBS_QUERY_SCHEMA = z.object({
  page: POSITIVE_INT.optional().default(1),
  pageSize: z.coerce.number().int().positive().max(100).optional().default(20),
  jobName: z.string().max(64).optional(),
  status: z.enum(['running', 'done', 'failed']).optional(),
});

export const LIST_NOTICES_QUERY_SCHEMA = z.object({
  page: POSITIVE_INT.optional().default(1),
  pageSize: z.coerce.number().int().positive().max(100).optional().default(20),
  category: z.enum(['degrade', 'expiry', 'review', 'report', 'system']).optional(),
  level: z.enum(['info', 'warning', 'critical']).optional(),
  // 🔴 不能用 z.coerce.boolean()：JS Boolean('false')===true，
  //    于是 ?read=false 会被解析成 true，「只看未读」变「只看已读」。
  read: boolQuery().optional(),
});

export type ListJobsQuery = z.infer<typeof LIST_JOBS_QUERY_SCHEMA>;
export type ListNoticesQuery = z.infer<typeof LIST_NOTICES_QUERY_SCHEMA>;

const PAGE_SIZE_MAX = 100;

@Injectable()
export class SchedulerService {
  constructor(@Inject(DbConnection) private readonly conn: DbConnection) {}

  /** 作业审计列表 */
  async listJobs(scope: ProfileScope, query: ListJobsQuery): Promise<{ items: JobAuditView[]; total: number; page: number; pageSize: number; totalPages: number }> {
    const page = query.page;
    const pageSize = Math.min(query.pageSize, PAGE_SIZE_MAX);

    const conditions: ReturnType<typeof sql>[] = [];
    if (query.jobName) {
      conditions.push(eq(jobAudit.jobName, query.jobName));
    }
    if (query.status) {
      conditions.push(eq(jobAudit.status, query.status));
    }

    // jobAudit 表无 userId 列，是系统级表，不需要 profileWhere
    const where = conditions.length > 0 ? conditions.reduce((acc, cond) => acc ? sql`${acc} AND ${cond}` : cond) : undefined;

    const countRows = await this.conn.db
      .select({ total: count() })
      .from(jobAudit)
      .where(where as any)
      .limit(1);
    const total = countRows[0]?.total ?? 0;
    const totalPages = Math.max(1, Math.ceil(total / pageSize));

    const rows = await this.conn.db
      .select()
      .from(jobAudit)
      .where(where as any)
      .orderBy(desc(jobAudit.createdAt))
      .limit(pageSize)
      .offset((page - 1) * pageSize);

    const items = rows.map((row) => ({
      id: row.id,
      jobName: row.jobName,
      refId: row.refId ?? undefined,
      status: row.status,
      attempts: row.attempts,
      error: row.error ?? undefined,
      startedAt: row.startedAt?.toISOString() ?? undefined,
      finishedAt: row.finishedAt?.toISOString() ?? undefined,
      createdAt: row.createdAt.toISOString(),
    }));

    return { items, total, page, pageSize, totalPages };
  }

  /** 系统通知列表 */
  async listNotices(scope: ProfileScope, query: ListNoticesQuery): Promise<{ items: NoticeView[]; total: number; page: number; pageSize: number; totalPages: number }> {
    const page = query.page;
    const pageSize = Math.min(query.pageSize, PAGE_SIZE_MAX);

    const conditions: ReturnType<typeof sql>[] = [];
    if (query.category) {
      conditions.push(eq(systemNotice.category, query.category));
    }
    if (query.level) {
      conditions.push(eq(systemNotice.level, query.level));
    }
    if (query.read !== undefined) {
      if (query.read) {
        conditions.push(sql`${systemNotice.readAt} IS NOT NULL`);
      } else {
        conditions.push(sql`${systemNotice.readAt} IS NULL`);
      }
    }

    const where = profileWhere(scope, systemNotice.userId, ...conditions);

    const countRows = await this.conn.db
      .select({ total: count() })
      .from(systemNotice)
      .where(where)
      .limit(1);
    const total = countRows[0]?.total ?? 0;
    const totalPages = Math.max(1, Math.ceil(total / pageSize));

    const rows = await this.conn.db
      .select()
      .from(systemNotice)
      .where(where)
      .orderBy(desc(systemNotice.createdAt))
      .limit(pageSize)
      .offset((page - 1) * pageSize);

    const items = rows.map((row) => ({
      id: row.id,
      category: row.category,
      level: row.level,
      title: row.title,
      body: row.body ?? undefined,
      link: row.link ?? undefined,
      refType: row.refType ?? undefined,
      refId: row.refId ?? undefined,
      readAt: row.readAt?.toISOString() ?? null,
      createdAt: row.createdAt.toISOString(),
    }));

    return { items, total, page, pageSize, totalPages };
  }

  /** 标记通知已读 */
  async markNoticeRead(scope: ProfileScope, noticeId: number): Promise<void> {
    const rows = await this.conn.db
      .select({ id: systemNotice.id })
      .from(systemNotice)
      .where(profileWhere(scope, systemNotice.userId, eq(systemNotice.id, noticeId)))
      .limit(1);

    if (rows.length === 0) {
      throw notFoundError(ErrorCode.RESOURCE_NOT_FOUND, '通知不存在');
    }

    await this.conn.db
      .update(systemNotice)
      .set({ readAt: new Date() })
      .where(profileWhere(scope, systemNotice.userId, eq(systemNotice.id, noticeId)));
  }

  /** 标记所有通知已读 */
  async markAllNoticesRead(scope: ProfileScope): Promise<void> {
    await this.conn.db
      .update(systemNotice)
      .set({ readAt: new Date() })
      .where(profileWhere(scope, systemNotice.userId));
  }
}
