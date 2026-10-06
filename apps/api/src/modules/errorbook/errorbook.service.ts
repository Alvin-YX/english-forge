/**
 * 错题本服务 —— 03 文档 §4.2.9
 *
 * 🔴 覆盖：
 *   - error_book     错题本聚合视图（按词条聚合错误次数）
 *   - error_sample   错误样本（可回放，7 天/90 天策略）
 *   - archive_error_sample_archive  拼写错误归档（90 天后转入）
 *
 * 🔴 全部方法必须 profileId 过滤：
 *    error_book / error_sample 表都有 userId 列，必须经 profileWhere() 过滤。
 *
 * 🔴 生命周期状态机（worker 每日 04:10 执行，本模块不提供 worker 入口）：
 *   - speak 错误样本 → keep_until = now()+7d，到期物理删除录音文件
 *   - spell 错误样本 → keep_until = now()+90d，到期转入 archive_error_sample_archive
 *   - error_book.right_streak >= 3 → 自动出清（is_resolved = true）
 *
 * 🔴 04 文档 §5.6.1 规则④：低分归因只能归因环境，严禁归因孩子能力。
 *    error_book.phonemeJson 字段用于记录出错音素，供 FSRS 难度调整。
 */

import { ErrorCode } from '@eng-forge/contracts/api';
import { ErrorCategory } from '@eng-forge/contracts/enums';
import {
  RESOLVE_RIGHT_STREAK,
  errorBook,
  errorSample,
} from '@eng-forge/db/schema';
import { Inject, Injectable } from '@nestjs/common';
import { z } from 'zod';

import { notFoundError } from '../../common/errors.business.js';
import { DbConnection } from '../../infra/db/db.module.js';
import { and, asc, count, desc, eq, isNull, sql } from '../../infra/db/query.js';
import { profileWhere, type ProfileScope } from '../../infra/profile/profile-scope.js';

// ═══════════════════════════════════════════════════════════
// View 类型
// ═══════════════════════════════════════════════════════════

/** 错题本条目视图 */
export interface ErrorBookView {
  id: number;
  category: ErrorCategory;
  wordId?: number;
  sentenceId?: number;
  message?: string;
  wrongCount: number;
  rightStreak: number;
  isResolved: boolean;
  isFavorite: boolean;
  phonemeJson?: unknown;
  lastErrorAt: string;
  resolvedAt?: string;
  createdAt: string;
}

/** 错误样本视图 */
export interface ErrorSampleView {
  id: number;
  wordId?: number;
  recordId?: number;
  recordingId?: number;
  category: string;
  priority: string;
  score?: number;
  wrongContent?: string;
  keepUntil: string;
  replayCount: number;
  lastReplayAt?: string;
  isPurged: boolean;
  createdAt: string;
}

// ═══════════════════════════════════════════════════════════
// Zod schemas
// ═══════════════════════════════════════════════════════════

const POSITIVE_INT = z.coerce.number().int().positive();

export const LIST_ERRORBOOK_QUERY_SCHEMA = z.object({
  page: POSITIVE_INT.optional().default(1),
  pageSize: z.coerce.number().int().positive().max(100).optional().default(20),
  category: z.enum(['speak', 'spell', 'grammar', 'listen', 'reading']).optional(),
  resolved: z.coerce.boolean().optional(),
  favorite: z.coerce.boolean().optional().default(false),
  sortBy: z.enum(['wrongCount', 'lastError', 'createdAt']).optional().default('lastError'),
});

export const LIST_ERRORSAMPLES_QUERY_SCHEMA = z.object({
  page: POSITIVE_INT.optional().default(1),
  pageSize: z.coerce.number().int().positive().max(100).optional().default(20),
  category: z.enum(['speak', 'spell']).optional(),
  priority: z.enum(['normal', 'high']).optional(),
  wordId: POSITIVE_INT.optional(),
  includePurged: z.coerce.boolean().optional().default(false),
});

export const RESOLVE_ERRORBOOK_SCHEMA = z.object({
  id: POSITIVE_INT,
});

export const TOGGLE_FAVORITE_SCHEMA = z.object({
  id: POSITIVE_INT,
});

export const REPLAY_SAMPLE_SCHEMA = z.object({
  id: POSITIVE_INT,
});

export type ListErrorBookQuery = z.infer<typeof LIST_ERRORBOOK_QUERY_SCHEMA>;
export type ListErrorSamplesQuery = z.infer<typeof LIST_ERRORSAMPLES_QUERY_SCHEMA>;

// ═══════════════════════════════════════════════════════════
// 常量
// ═══════════════════════════════════════════════════════════

const PAGE_SIZE_DEFAULT = 20;
const PAGE_SIZE_MAX = 100;

// ═══════════════════════════════════════════════════════════
// Service
// ═══════════════════════════════════════════════════════════

@Injectable()
export class ErrorBookService {
  constructor(@Inject(DbConnection) private readonly conn: DbConnection) {}

  // ═══════════════════════════════════════════════════════════
  // error_book
  // ═══════════════════════════════════════════════════════════

  /** 错题本列表 */
  async listErrorBook(scope: ProfileScope, query: ListErrorBookQuery): Promise<{ items: ErrorBookView[]; total: number; page: number; pageSize: number; totalPages: number }> {
    const page = query.page;
    const pageSize = Math.min(query.pageSize, PAGE_SIZE_MAX);

    const conditions: ReturnType<typeof sql>[] = [];

    // 分类过滤
    if (query.category) {
      conditions.push(eq(errorBook.category, query.category));
    }

    // 已解决/未解决过滤
    if (query.resolved !== undefined) {
      conditions.push(eq(errorBook.isResolved, query.resolved));
    }

    // 收藏过滤
    if (query.favorite !== undefined) {
      conditions.push(eq(errorBook.isFavorite, query.favorite));
    }

    const where = profileWhere(scope, errorBook.userId, ...conditions);

    // 排序
    let orderBy: any[];
    if (query.sortBy === 'wrongCount') {
      orderBy = [desc(errorBook.wrongCount), desc(errorBook.id)];
    } else if (query.sortBy === 'createdAt') {
      orderBy = [desc(errorBook.createdAt), desc(errorBook.id)];
    } else {
      orderBy = [desc(errorBook.lastErrorAt), desc(errorBook.id)];
    }

    // 总数
    const countRows = await this.conn.db
      .select({ total: count() })
      .from(errorBook)
      .where(where)
      .limit(1);
    const total = countRows[0]?.total ?? 0;
    const totalPages = Math.max(1, Math.ceil(total / pageSize));

    // 分页查询
    const rows = await this.conn.db
      .select()
      .from(errorBook)
      .where(where)
      .orderBy(...orderBy)
      .limit(pageSize)
      .offset((page - 1) * pageSize);

    const items = rows.map((row) => ({
      id: row.id,
      category: row.category,
      wordId: row.wordId ?? undefined,
      sentenceId: row.sentenceId ?? undefined,
      message: row.message ?? undefined,
      wrongCount: row.wrongCount,
      rightStreak: row.rightStreak,
      isResolved: row.isResolved,
      isFavorite: row.isFavorite,
      phonemeJson: row.phonemeJson ?? undefined,
      lastErrorAt: row.lastErrorAt.toISOString(),
      resolvedAt: row.resolvedAt?.toISOString() ?? undefined,
      createdAt: row.createdAt.toISOString(),
    }));

    return { items, total, page, pageSize, totalPages };
  }

  /** 错题本条目详情 */
  async getErrorBookById(scope: ProfileScope, id: number): Promise<ErrorBookView> {
    const rows = await this.conn.db
      .select()
      .from(errorBook)
      .where(profileWhere(scope, errorBook.userId, eq(errorBook.id, id)))
      .limit(1);

    const row = rows[0];
    if (row === undefined) {
      throw notFoundError(ErrorCode.RESOURCE_NOT_FOUND, '错题不存在');
    }

    return {
      id: row.id,
      category: row.category,
      wordId: row.wordId ?? undefined,
      sentenceId: row.sentenceId ?? undefined,
      message: row.message ?? undefined,
      wrongCount: row.wrongCount,
      rightStreak: row.rightStreak,
      isResolved: row.isResolved,
      isFavorite: row.isFavorite,
      phonemeJson: row.phonemeJson ?? undefined,
      lastErrorAt: row.lastErrorAt.toISOString(),
      resolvedAt: row.resolvedAt?.toISOString() ?? undefined,
      createdAt: row.createdAt.toISOString(),
    };
  }

  /** 标记已解决（增加 right_streak，≥3 自动出清） */
  async resolveErrorBook(scope: ProfileScope, id: number): Promise<ErrorBookView> {
    const existing = await this.getErrorBookById(scope, id);

    const newRightStreak = existing.rightStreak + 1;
    const isResolved = newRightStreak >= RESOLVE_RIGHT_STREAK;

    await this.conn.db
      .update(errorBook)
      .set({
        rightStreak: newRightStreak,
        isResolved,
        resolvedAt: isResolved ? new Date() : null,
        updatedAt: new Date(),
      })
      .where(profileWhere(scope, errorBook.userId, eq(errorBook.id, id)));

    return {
      ...existing,
      rightStreak: newRightStreak,
      isResolved,
      resolvedAt: isResolved ? new Date().toISOString() : undefined,
    };
  }

  /** 切换收藏 */
  async toggleFavorite(scope: ProfileScope, id: number): Promise<ErrorBookView> {
    const existing = await this.getErrorBookById(scope, id);

    await this.conn.db
      .update(errorBook)
      .set({
        isFavorite: !existing.isFavorite,
        updatedAt: new Date(),
      })
      .where(profileWhere(scope, errorBook.userId, eq(errorBook.id, id)));

    return {
      ...existing,
      isFavorite: !existing.isFavorite,
    };
  }

  /** 删除错题 */
  async deleteErrorBook(scope: ProfileScope, id: number): Promise<void> {
    const result = await this.conn.db
      .delete(errorBook)
      .where(profileWhere(scope, errorBook.userId, eq(errorBook.id, id)))
      .returning({ id: errorBook.id });

    if (result.length === 0) {
      throw notFoundError(ErrorCode.RESOURCE_NOT_FOUND, '错题不存在');
    }
  }

  // ═══════════════════════════════════════════════════════════
  // error_sample
  // ═══════════════════════════════════════════════════════════

  /** 错误样本列表 */
  async listErrorSamples(scope: ProfileScope, query: ListErrorSamplesQuery): Promise<{ items: ErrorSampleView[]; total: number; page: number; pageSize: number; totalPages: number }> {
    const page = query.page;
    const pageSize = Math.min(query.pageSize, PAGE_SIZE_MAX);

    const conditions:ReturnType<typeof sql>[] = [];

    // 分类过滤
    if (query.category) {
      conditions.push(eq(errorSample.category, query.category));
    }

    // 优先级过滤
    if (query.priority) {
      conditions.push(eq(errorSample.priority, query.priority));
    }

    // 词条过滤
    if (query.wordId) {
      conditions.push(eq(errorSample.wordId, query.wordId));
    }

    // 是否包含已清除的样本
    if (!query.includePurged) {
      conditions.push(eq(errorSample.isPurged, false));
    }

    const where = profileWhere(scope, errorSample.userId, ...conditions);

    // 总数
    const countRows = await this.conn.db
      .select({ total: count() })
      .from(errorSample)
      .where(where)
      .limit(1);
    const total = countRows[0]?.total ?? 0;
    const totalPages = Math.max(1, Math.ceil(total / pageSize));

    // 分页查询
    const rows = await this.conn.db
      .select()
      .from(errorSample)
      .where(where)
      .orderBy(desc(errorSample.createdAt))
      .limit(pageSize)
      .offset((page - 1) * pageSize);

    const items = rows.map((row) => ({
      id: row.id,
      wordId: row.wordId ?? undefined,
      recordId: row.recordId ?? undefined,
      recordingId: row.recordingId ?? undefined,
      category: row.category,
      priority: row.priority,
      score: row.score !== null ? parseFloat(row.score) : undefined,
      wrongContent: row.wrongContent ?? undefined,
      keepUntil: row.keepUntil.toISOString(),
      replayCount: row.replayCount,
      lastReplayAt: row.lastReplayAt?.toISOString() ?? undefined,
      isPurged: row.isPurged,
      createdAt: row.createdAt.toISOString(),
    }));

    return { items, total, page, pageSize, totalPages };
  }

  /** 错误样本详情 */
  async getErrorSampleById(scope: ProfileScope, id: number): Promise<ErrorSampleView> {
    const rows = await this.conn.db
      .select()
      .from(errorSample)
      .where(profileWhere(scope, errorSample.userId, eq(errorSample.id, id)))
      .limit(1);

    const row = rows[0];
    if (row === undefined) {
      throw notFoundError(ErrorCode.RESOURCE_NOT_FOUND, '错误样本不存在');
    }

    return {
      id: row.id,
      wordId: row.wordId ?? undefined,
      recordId: row.recordId ?? undefined,
      recordingId: row.recordingId ?? undefined,
      category: row.category,
      priority: row.priority,
      score: row.score !== null ? parseFloat(row.score) : undefined,
      wrongContent: row.wrongContent ?? undefined,
      keepUntil: row.keepUntil.toISOString(),
      replayCount: row.replayCount,
      lastReplayAt: row.lastReplayAt?.toISOString() ?? undefined,
      isPurged: row.isPurged,
      createdAt: row.createdAt.toISOString(),
    };
  }

  /** 回放错误样本（更新 replay_count 和 last_replay_at） */
  async replayErrorSample(scope: ProfileScope, id: number): Promise<ErrorSampleView> {
    const existing = await this.getErrorSampleById(scope, id);

    await this.conn.db
      .update(errorSample)
      .set({
        replayCount: existing.replayCount + 1,
        lastReplayAt: new Date(),
      })
      .where(profileWhere(scope, errorSample.userId, eq(errorSample.id, id)));

    return {
      ...existing,
      replayCount: existing.replayCount + 1,
      lastReplayAt: new Date().toISOString(),
    };
  }

  /** 删除错误样本 */
  async deleteErrorSample(scope: ProfileScope, id: number): Promise<void> {
    const result = await this.conn.db
      .delete(errorSample)
      .where(profileWhere(scope, errorSample.userId, eq(errorSample.id, id)))
      .returning({ id: errorSample.id });

    if (result.length === 0) {
      throw notFoundError(ErrorCode.RESOURCE_NOT_FOUND, '错误样本不存在');
    }
  }
}
