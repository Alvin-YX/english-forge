/**
 * 游戏化域服务 —— 03 文档 §4.2.10
 *
 * 🔴 覆盖：
 *   - badge           徽章授予
 *   - weekly_challenge 每周挑战
 *   - game_record     游戏记录
 *
 * 🔴 全部方法必须 profileId 过滤（profileWhere），
 *    唯一例外：getGameLeaderboard 是跨用户排行榜，不隔离档案。
 */

import { ErrorCode } from '@eng-forge/contracts/api';
import {
  CHALLENGE_METRICS,
  CHALLENGE_STATUSES,
  GAME_CODES,
  type ChallengeMetric,
  type ChallengeStatus,
  type GameCode,
  badge,
  gameRecord,
  weeklyChallenge,
} from '@eng-forge/db/schema';
import { Inject, Injectable } from '@nestjs/common';
import { z } from 'zod';

import { notFoundError } from '../../common/errors.business.js';
import { DbConnection } from '../../infra/db/db.module.js';
import { count, desc, eq, gte, lte, type sql } from '../../infra/db/query.js';
import { profileWhere, type ProfileScope } from '../../infra/profile/profile-scope.js';

// ═══════════════════════════════════════════════════════════
// View 类型
// ═══════════════════════════════════════════════════════════

export interface BadgeView {
  code: string;
  earnedAt: string;
}

export interface WeeklyChallengeView {
  id: number;
  weekStart: string;
  title: string;
  metric: ChallengeMetric;
  targetValue: number;
  currentValue: number;
  rewardPoints: number;
  status: ChallengeStatus;
}

export interface GameRecordView {
  id: number;
  gameCode: GameCode;
  score: number;
  comboMax: number;
  accuracy: number;
  durationMs: number;
  wrongWords: Array<{ wordId: number; count: number }>;
  createdAt: string;
}

export interface LeaderboardEntry {
  rank: number;
  userId: number;
  score: number;
  comboMax: number;
  createdAt: string;
}

// ═══════════════════════════════════════════════════════════
// Zod schemas
// ═══════════════════════════════════════════════════════════

const POSITIVE_INT = z.coerce.number().int().positive();

export const AWARD_BADGE_SCHEMA = z.object({ code: z.string().max(32) });

export const CREATE_CHALLENGE_SCHEMA = z.object({
  title: z.string().max(128),
  metric: z.enum([...CHALLENGE_METRICS]),
  targetValue: z.number().int().positive(),
  rewardPoints: z.number().int().min(0).default(0),
});

export const UPDATE_PROGRESS_SCHEMA = z.object({
  currentValue: z.number().int().min(0),
});

export const LIST_CHALLENGES_QUERY_SCHEMA = z.object({
  page: POSITIVE_INT.optional().default(1),
  pageSize: z.coerce.number().int().positive().max(100).optional().default(20),
  status: z.enum([...CHALLENGE_STATUSES]).optional(),
  metric: z.enum([...CHALLENGE_METRICS]).optional(),
  from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
});

export const SUBMIT_GAME_SCHEMA = z.object({
  gameCode: z.enum([...GAME_CODES]),
  score: z.number().int().min(0),
  comboMax: z.number().int().min(0).default(0),
  accuracy: z.number().min(0).max(100).default(0),
  durationMs: z.number().int().min(0).default(0),
  wrongWords: z.array(z.object({ wordId: POSITIVE_INT, count: z.number().int().min(1) })).default([]),
});

export const LIST_GAMES_QUERY_SCHEMA = z.object({
  page: POSITIVE_INT.optional().default(1),
  pageSize: z.coerce.number().int().positive().max(100).optional().default(20),
  gameCode: z.enum([...GAME_CODES]).optional(),
  sortBy: z.enum(['score', 'duration', 'createdAt']).optional().default('createdAt'),
});

export type AwardBadgeInput = z.infer<typeof AWARD_BADGE_SCHEMA>;
export type CreateChallengeInput = z.infer<typeof CREATE_CHALLENGE_SCHEMA>;
export type UpdateProgressInput = z.infer<typeof UPDATE_PROGRESS_SCHEMA>;
export type ListChallengesQuery = z.infer<typeof LIST_CHALLENGES_QUERY_SCHEMA>;
export type SubmitGameInput = z.infer<typeof SUBMIT_GAME_SCHEMA>;
export type ListGamesQuery = z.infer<typeof LIST_GAMES_QUERY_SCHEMA>;

// ═══════════════════════════════════════════════════════════
// 常量
// ═══════════════════════════════════════════════════════════

const PAGE_SIZE_MAX = 100;

/** 本周周一日期（UTC，YYYY-MM-DD） */
function weekStartDate(): string {
  const now = new Date();
  const day = now.getUTCDay(); // 0=Sun, 1=Mon
  const mondayOffset = day === 0 ? -6 : 1 - day;
  const monday = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + mondayOffset));
  return monday.toISOString().slice(0, 10);
}

// ═══════════════════════════════════════════════════════════
// Service
// ═══════════════════════════════════════════════════════════

@Injectable()
export class GamificationService {
  constructor(@Inject(DbConnection) private readonly conn: DbConnection) {}

  // ═══════════════════════════════════════════════════════════
  // badge
  // ═══════════════════════════════════════════════════════════

  /** 获取用户的徽章列表 */
  async listBadges(scope: ProfileScope): Promise<BadgeView[]> {
    const rows = await this.conn.db
      .select({
        code: badge.code,
        earnedAt: badge.earnedAt,
      })
      .from(badge)
      .where(profileWhere(scope, badge.userId))
      .orderBy(desc(badge.earnedAt));

    return rows.map((row) => ({
      code: row.code,
      earnedAt: row.earnedAt.toISOString(),
    }));
  }

  /** 授予徽章（upsert：已存在则返回现有，否则插入） */
  async awardBadge(scope: ProfileScope, code: string): Promise<BadgeView> {
    // 检查是否已存在
    const existing = await this.conn.db
      .select()
      .from(badge)
      .where(profileWhere(scope, badge.userId, eq(badge.code, code)))
      .limit(1);

    if (existing.length > 0) {
      const row = existing[0]!;
      return {
        code: row.code,
        earnedAt: row.earnedAt.toISOString(),
      };
    }

    // 插入新徽章
    await this.conn.db.insert(badge).values({
      userId: scope.profileId,
      code,
    });

    // 返回刚插入的
    const rows = await this.conn.db
      .select()
      .from(badge)
      .where(profileWhere(scope, badge.userId, eq(badge.code, code)))
      .limit(1);

    const row = rows[0];
    if (row === undefined) {
      throw notFoundError(ErrorCode.RESOURCE_NOT_FOUND, '徽章不存在');
    }

    return {
      code: row.code,
      earnedAt: row.earnedAt.toISOString(),
    };
  }

  // ═══════════════════════════════════════════════════════════
  // weekly_challenge
  // ═══════════════════════════════════════════════════════════

  /** 获取当前用户的本周挑战 */
  async getWeeklyChallenge(scope: ProfileScope): Promise<WeeklyChallengeView | null> {
    const ws = weekStartDate();
    const rows = await this.conn.db
      .select()
      .from(weeklyChallenge)
      .where(profileWhere(scope, weeklyChallenge.userId, eq(weeklyChallenge.weekStart, ws)))
      .limit(1);

    const row = rows[0];
    if (row === undefined) return null;

    return {
      id: row.id,
      weekStart: row.weekStart,
      title: row.title,
      metric: row.metric,
      targetValue: row.targetValue,
      currentValue: row.currentValue,
      rewardPoints: row.rewardPoints,
      status: row.status,
    };
  }

  /** 创建每周挑战 */
  async createChallenge(scope: ProfileScope, input: CreateChallengeInput): Promise<WeeklyChallengeView> {
    const ws = weekStartDate();

    const result = await this.conn.db
      .insert(weeklyChallenge)
      .values({
        userId: scope.profileId,
        weekStart: ws,
        title: input.title,
        metric: input.metric,
        targetValue: input.targetValue,
        currentValue: 0,
        rewardPoints: input.rewardPoints,
        status: 'ongoing',
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      } as any)
      .returning();

    const row = result[0];
    if (row === undefined) {
      throw notFoundError(ErrorCode.RESOURCE_NOT_FOUND, '挑战创建失败');
    }

    return {
      id: row.id,
      weekStart: row.weekStart,
      title: row.title,
      metric: row.metric,
      targetValue: row.targetValue,
      currentValue: row.currentValue,
      rewardPoints: row.rewardPoints,
      status: row.status,
    };
  }

  /** 更新挑战进度（currentValue >= targetValue 时自动标记 done） */
  async updateChallengeProgress(
    scope: ProfileScope,
    challengeId: number,
    currentValue: number,
  ): Promise<WeeklyChallengeView> {
    // 先获取现有记录
    const rows = await this.conn.db
      .select()
      .from(weeklyChallenge)
      .where(profileWhere(scope, weeklyChallenge.userId, eq(weeklyChallenge.id, challengeId)))
      .limit(1);

    const row = rows[0];
    if (row === undefined) {
      throw notFoundError(ErrorCode.RESOURCE_NOT_FOUND, '挑战不存在');
    }

    const newStatus: ChallengeStatus = currentValue >= row.targetValue ? 'done' : row.status;

    await this.conn.db
      .update(weeklyChallenge)
      .set({ currentValue, status: newStatus })
      .where(profileWhere(scope, weeklyChallenge.userId, eq(weeklyChallenge.id, challengeId)));

    return {
      id: row.id,
      weekStart: row.weekStart,
      title: row.title,
      metric: row.metric,
      targetValue: row.targetValue,
      currentValue,
      rewardPoints: row.rewardPoints,
      status: newStatus,
    };
  }

  /** 挑战列表（分页、状态/指标/日期范围过滤） */
  async listChallenges(
    scope: ProfileScope,
    query: ListChallengesQuery,
  ): Promise<{ items: WeeklyChallengeView[]; total: number; page: number; pageSize: number; totalPages: number }> {
    const page = query.page;
    const pageSize = Math.min(query.pageSize, PAGE_SIZE_MAX);

    const conditions: ReturnType<typeof sql>[] = [];

    if (query.status) {
      conditions.push(eq(weeklyChallenge.status, query.status));
    }

    if (query.metric) {
      conditions.push(eq(weeklyChallenge.metric, query.metric));
    }

    if (query.from) {
      conditions.push(gte(weeklyChallenge.weekStart, query.from));
    }

    if (query.to) {
      conditions.push(lte(weeklyChallenge.weekStart, query.to));
    }

    const where = profileWhere(scope, weeklyChallenge.userId, ...conditions);

    // 总数
    const countRows = await this.conn.db
      .select({ total: count() })
      .from(weeklyChallenge)
      .where(where)
      .limit(1);
    const total = countRows[0]?.total ?? 0;
    const totalPages = Math.max(1, Math.ceil(total / pageSize));

    // 分页查询
    const rows = await this.conn.db
      .select()
      .from(weeklyChallenge)
      .where(where)
      .orderBy(desc(weeklyChallenge.weekStart), desc(weeklyChallenge.id))
      .limit(pageSize)
      .offset((page - 1) * pageSize);

    const items = rows.map((row) => ({
      id: row.id,
      weekStart: row.weekStart,
      title: row.title,
      metric: row.metric,
      targetValue: row.targetValue,
      currentValue: row.currentValue,
      rewardPoints: row.rewardPoints,
      status: row.status,
    }));

    return { items, total, page, pageSize, totalPages };
  }

  // ═══════════════════════════════════════════════════════════
  // game_record
  // ═══════════════════════════════════════════════════════════

  /** 提交游戏成绩 */
  async submitGameResult(scope: ProfileScope, input: SubmitGameInput): Promise<GameRecordView> {
    const result = await this.conn.db
      .insert(gameRecord)
      .values({
        userId: scope.profileId,
        gameCode: input.gameCode,
        score: input.score,
        comboMax: input.comboMax,
        accuracy: input.accuracy,
        durationMs: input.durationMs,
        wrongWords: input.wrongWords,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      } as any)
      .returning();

    const row = result[0];
    if (row === undefined) {
      throw notFoundError(ErrorCode.RESOURCE_NOT_FOUND, '游戏记录创建失败');
    }

    return {
      id: row.id,
      gameCode: row.gameCode,
      score: row.score,
      comboMax: row.comboMax,
      accuracy: parseFloat(row.accuracy),
      durationMs: row.durationMs,
      wrongWords: (row.wrongWords as Array<{ wordId: number; count: number }> | null) ?? [],
      createdAt: row.createdAt.toISOString(),
    };
  }

  /** 游戏记录列表（分页、游戏类型/排序过滤） */
  async listGameRecords(
    scope: ProfileScope,
    query: ListGamesQuery,
  ): Promise<{ items: GameRecordView[]; total: number; page: number; pageSize: number; totalPages: number }> {
    const page = query.page;
    const pageSize = Math.min(query.pageSize, PAGE_SIZE_MAX);

    const conditions: ReturnType<typeof sql>[] = [];

    if (query.gameCode) {
      conditions.push(eq(gameRecord.gameCode, query.gameCode));
    }

    const where = profileWhere(scope, gameRecord.userId, ...conditions);

    // 排序
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let orderBy: any[];
    if (query.sortBy === 'score') {
      orderBy = [desc(gameRecord.score), desc(gameRecord.id)];
    } else if (query.sortBy === 'duration') {
      orderBy = [desc(gameRecord.durationMs), desc(gameRecord.id)];
    } else {
      orderBy = [desc(gameRecord.createdAt), desc(gameRecord.id)];
    }

    // 总数
    const countRows = await this.conn.db
      .select({ total: count() })
      .from(gameRecord)
      .where(where)
      .limit(1);
    const total = countRows[0]?.total ?? 0;
    const totalPages = Math.max(1, Math.ceil(total / pageSize));

    // 分页查询
    const rows = await this.conn.db
      .select()
      .from(gameRecord)
      .where(where)
      .orderBy(...orderBy)
      .limit(pageSize)
      .offset((page - 1) * pageSize);

    const items = rows.map((row) => ({
      id: row.id,
      gameCode: row.gameCode,
      score: row.score,
      comboMax: row.comboMax,
      accuracy: parseFloat(row.accuracy),
      durationMs: row.durationMs,
      wrongWords: (row.wrongWords as Array<{ wordId: number; count: number }> | null) ?? [],
      createdAt: row.createdAt.toISOString(),
    }));

    return { items, total, page, pageSize, totalPages };
  }

  /** 排行榜（跨用户，按 score 降序 TOP 50） */
  async getGameLeaderboard(_scope: ProfileScope, gameCode: GameCode): Promise<LeaderboardEntry[]> {
    const rows = await this.conn.db
      .select({
        userId: gameRecord.userId,
        score: gameRecord.score,
        comboMax: gameRecord.comboMax,
        createdAt: gameRecord.createdAt,
      })
      .from(gameRecord)
      .where(eq(gameRecord.gameCode, gameCode))
      .orderBy(desc(gameRecord.score), desc(gameRecord.id))
      .limit(50);

    return rows.map((row, index) => ({
      rank: index + 1,
      userId: row.userId,
      score: row.score,
      comboMax: row.comboMax,
      createdAt: row.createdAt.toISOString(),
    }));
  }
}
