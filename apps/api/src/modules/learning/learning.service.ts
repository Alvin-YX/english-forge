/**
 * 学习域服务 —— 03 文档 §4.2.4 / §4.2.5 / §4.2.6 / §4.2.10
 *
 * 🔴 覆盖：
 *   - word_mastery   词条掌握度（四维分数 + FSRS 调度）
 *   - learning_record  学习记录统一大表
 *   - daily_stat     日统计
 *   - streak         连续打卡
 *   - heatmap        热力图（12 周，GitHub 式 4 级）
 *   - lesson_block   5 词循环块
 *
 * 🔴 本模块**不做 profileId 过滤的是**：
 *   - course / course_skill（课程定义属公共数据）
 * 🔴 本模块**必须 profileId 过滤的是**：
 *   - word_mastery / learning_record / daily_stat / streak / heatmap / lesson_block
 *     （这些表的 userId 列语义上是 profileId，必须经 profileWhere() 过滤）
 *
 * 🔴 04 文档 §5.6.3「绝不静默降级」：
 *    learning_record.confidence_level + learning_record.degrade_level
 *    必须持久化到**每一条**记录，降级状态不可丢失。
 */

import { ErrorCode } from '@eng-forge/contracts/api';
import { ConfidenceLevel, RecordKind, ScoreDegradeLevel } from '@eng-forge/contracts/enums';
import { FsrsState } from '@eng-forge/contracts/types';
import {
  dailyStat,
  fsrsStateFromDb,
  fsrsStateToDb,
  heatmap,
  learningRecord,
  lessonBlock,
  streak,
  wordMastery,
} from '@eng-forge/db/schema';
import { Inject, Injectable } from '@nestjs/common';
import { z } from 'zod';

import { internalInvariantError, notFoundError } from '../../common/errors.business.js';
import { DbConnection } from '../../infra/db/db.module.js';
import { asc, count, desc, eq, gte, lte, type PgUpdateSetSource, type SQL, sql } from '../../infra/db/query.js';
import { profileWhere, type ProfileScope } from '../../infra/profile/profile-scope.js';

// ═══════════════════════════════════════════════════════════
// View 类型
// ═══════════════════════════════════════════════════════════

/** 词条掌握度视图 */
export interface WordMasteryView {
  wordId: number;
  recognizeScore: number;
  listenScore: number;
  spellScore: number;
  speakScore: number;
  overallScore: number;
  fsrsState: FsrsState;
  fsrsNextReview?: string;
  fsrsReps: number;
  fsrsLapses: number;
  isLeech: boolean;
  speakErrorCount: number;
  spellErrorCount: number;
  totalAttempts: number;
  lastPracticedAt?: string;
}

/** 学习记录视图 */
export interface LearningRecordView {
  id: number;
  kind: RecordKind;
  refType: string;
  refId?: number;
  courseId?: number;
  isCorrect?: boolean;
  score?: number;
  accuracy?: number;
  fluency?: number;
  completeness?: number;
  prosody?: number;
  durationMs?: number;
  answerText?: string;
  confidenceLevel?: ConfidenceLevel;
  degradeLevel?: ScoreDegradeLevel;
  scoreAttribution?: string;
  formulaVersion?: string;
  status: string;
  createdAt: string;
}

/** 今日概览 */
export interface TodayOverview {
  date: string;
  studyMinutes: number;
  newWords: number;
  reviews: number;
  shadowCount: number;
  dictationCount: number;
  avgScore: number;
  correctRate: number;
  errorCount: number;
  goalMet: boolean;
  dueReviewCount: number;
}

/** 热力图条目 */
export interface HeatmapEntry {
  date: string;
  level: number;
  minutes: number;
  count: number;
}

/** 连续打卡 */
export interface StreakView {
  currentDays: number;
  longestDays: number;
  lastStudyDate?: string;
  freezeUsed: number;
}

/** 5 词循环块视图 */
export interface LessonBlockView {
  id: number;
  courseId: number;
  blockNo: number;
  wordIds: number[];
  consumed: boolean;
  createdAt: string;
}

// ═══════════════════════════════════════════════════════════
// Zod schemas
// ═══════════════════════════════════════════════════════════

const POSITIVE_INT = z.coerce.number().int().positive();

export const GET_MASTERY_QUERY_SCHEMA = z.object({
  page: POSITIVE_INT.optional().default(1),
  pageSize: z.coerce.number().int().positive().max(100).optional().default(20),
  sortBy: z.enum(['overallScore', 'lastPracticed', 'fsrsNextReview']).optional().default('overallScore'),
  sortDir: z.enum(['asc', 'desc']).optional().default('desc'),
  dueOnly: z.coerce.boolean().optional().default(false),
  leechOnly: z.coerce.boolean().optional().default(false),
});

export const UPDATE_MASTERY_SCHEMA = z.object({
  wordId: POSITIVE_INT,
  recognizeScore: z.number().min(0).max(100).optional(),
  listenScore: z.number().min(0).max(100).optional(),
  spellScore: z.number().min(0).max(100).optional(),
  speakScore: z.number().min(0).max(100).optional(),
  fsrsState: z.nativeEnum(FsrsState).optional(),
  fsrsStability: z.number().positive().optional(),
  fsrsDifficulty: z.number().min(0).max(10).optional(),
  fsrsNextReview: z.coerce.date().optional(),
  speakErrorCount: z.number().int().min(0).optional(),
  spellErrorCount: z.number().int().min(0).optional(),
  phonemeErrorRate: z.number().min(0).max(1).optional(),
});

export const CREATE_LEARNING_RECORD_SCHEMA = z.object({
  kind: z.enum([
    'word_card', 'spell', 'dictation', 'shadowing',
    'pronounce', 'sentence', 'conversation', 'listen_identify',
  ]),
  refType: z.enum(['word', 'sentence', 'skill', 'conversation', 'game']),
  refId: POSITIVE_INT.optional(),
  courseId: POSITIVE_INT.optional(),
  isCorrect: z.boolean().optional(),
  score: z.number().min(0).max(100).optional(),
  accuracy: z.number().min(0).max(100).optional(),
  fluency: z.number().min(0).max(100).optional(),
  completeness: z.number().min(0).max(100).optional(),
  prosody: z.number().min(0).max(100).optional(),
  durationMs: z.number().int().min(0).optional(),
  answerText: z.string().max(500).optional(),
  confidenceLevel: z.enum(['high', 'medium', 'low']).optional(),
  degradeLevel: z.enum(['A', 'B', 'C', 'D', 'E', 'F']).optional(),
  scoreAttribution: z.string().max(32).optional(),
  formulaVersion: z.string().max(16).optional(),
});

export const GET_RECORDS_QUERY_SCHEMA = z.object({
  page: POSITIVE_INT.optional().default(1),
  pageSize: z.coerce.number().int().positive().max(100).optional().default(20),
  kind: z.enum(['word_card', 'spell', 'dictation', 'shadowing', 'pronounce', 'sentence', 'conversation', 'listen_identify']).optional(),
});

export const GET_HEATMAP_QUERY_SCHEMA = z.object({
  weeks: z.coerce.number().int().positive().max(52).optional().default(12),
});

export type GetMasteryQuery = z.infer<typeof GET_MASTERY_QUERY_SCHEMA>;
export type UpdateMasteryInput = z.infer<typeof UPDATE_MASTERY_SCHEMA>;
export type CreateLearningRecordInput = z.infer<typeof CREATE_LEARNING_RECORD_SCHEMA>;
export type GetRecordsQuery = z.infer<typeof GET_RECORDS_QUERY_SCHEMA>;
export type GetHeatmapQuery = z.infer<typeof GET_HEATMAP_QUERY_SCHEMA>;

// ═══════════════════════════════════════════════════════════
// 常量
// ═══════════════════════════════════════════════════════════

const PAGE_SIZE_DEFAULT = 20;
const PAGE_SIZE_MAX = 100;

/**
 * `numeric(p,s)` 列在 Drizzle 的**写入侧**类型是 `string`
 *（PG 用字符串传以避免浮点精度丢失），读取侧同样是 `string`。
 *
 * 🔴 不写 `as any` 绕过：读写两侧的转换必须成对出现，否则精度会在往返中漂移。
 * 🔴 这里不做定点量化 —— 精度由列声明 `numeric(precision, scale)` 唯一裁定，
 *    应用层再 `toFixed` 反而会造成二次舍入（如 `phoneme_error_rate` 是 scale=4）。
 */
function toNumeric(value: number | undefined): string | undefined {
  return value === undefined ? undefined : String(value);
}

/** 今日 0 点（UTC+8） */
function todayStart(): Date {
  const now = new Date();
  return new Date(Date.UTC(now.getFullYear(), now.getMonth(), now.getDate(), 0, 0, 0, 0));
}

/** 今日结束（明天 0 点） */
function todayEnd(): Date {
  const now = new Date();
  return new Date(Date.UTC(now.getFullYear(), now.getMonth(), now.getDate() + 1, 0, 0, 0, 0));
}

// ═══════════════════════════════════════════════════════════
// Service
// ═══════════════════════════════════════════════════════════

@Injectable()
export class LearningService {
  constructor(@Inject(DbConnection) private readonly conn: DbConnection) {}

  // ═══════════════════════════════════════════════════════════
  // word_mastery
  // ═══════════════════════════════════════════════════════════

  /** 获取用户的词条掌握度列表 */
  async getMasteryList(scope: ProfileScope, query: GetMasteryQuery): Promise<{ items: WordMasteryView[]; total: number; page: number; pageSize: number; totalPages: number }> {
    const page = query.page;
    const pageSize = Math.min(query.pageSize, PAGE_SIZE_MAX);

    const conditions: SQL[] = [];

    // 今日待复习（fsrs_next_review <= now）
    if (query.dueOnly) {
      conditions.push(lte(wordMastery.fsrsNextReview, new Date()));
    }

    // 仅 leech
    if (query.leechOnly) {
      conditions.push(eq(wordMastery.isLeech, true));
    }

    const where = profileWhere(scope, wordMastery.userId, ...conditions);

    // 排序
    let orderBy: SQL[];
    if (query.sortBy === 'lastPracticed') {
      orderBy = [desc(wordMastery.lastPracticedAt), desc(wordMastery.id)];
    } else if (query.sortBy === 'fsrsNextReview') {
      orderBy = [asc(wordMastery.fsrsNextReview), asc(wordMastery.id)];
    } else {
      orderBy = [desc(wordMastery.overallScore), asc(wordMastery.id)];
    }

    // 总数
    const countRows = await this.conn.db
      .select({ total: count() })
      .from(wordMastery)
      .where(where)
      .limit(1);
    const total = countRows[0]?.total ?? 0;
    const totalPages = Math.max(1, Math.ceil(total / pageSize));

    // 分页查询
    const rows = await this.conn.db
      .select({
        id: wordMastery.id,
        wordId: wordMastery.wordId,
        recognizeScore: wordMastery.recognizeScore,
        listenScore: wordMastery.listenScore,
        spellScore: wordMastery.spellScore,
        speakScore: wordMastery.speakScore,
        overallScore: wordMastery.overallScore,
        fsrsState: wordMastery.fsrsState,
        fsrsNextReview: wordMastery.fsrsNextReview,
        fsrsReps: wordMastery.fsrsReps,
        fsrsLapses: wordMastery.fsrsLapses,
        isLeech: wordMastery.isLeech,
        speakErrorCount: wordMastery.speakErrorCount,
        spellErrorCount: wordMastery.spellErrorCount,
        totalAttempts: wordMastery.totalAttempts,
        lastPracticedAt: wordMastery.lastPracticedAt,
      })
      .from(wordMastery)
      .where(where)
      .orderBy(...orderBy)
      .limit(pageSize)
      .offset((page - 1) * pageSize);

    const items = rows.map((row) => ({
      wordId: row.wordId,
      recognizeScore: parseFloat(row.recognizeScore),
      listenScore: parseFloat(row.listenScore),
      spellScore: parseFloat(row.spellScore),
      speakScore: parseFloat(row.speakScore),
      overallScore: parseFloat(row.overallScore),
      fsrsState: fsrsStateFromDb(row.fsrsState),
      fsrsNextReview: row.fsrsNextReview?.toISOString() ?? undefined,
      fsrsReps: row.fsrsReps,
      fsrsLapses: row.fsrsLapses,
      isLeech: row.isLeech,
      speakErrorCount: row.speakErrorCount,
      spellErrorCount: row.spellErrorCount,
      totalAttempts: row.totalAttempts,
      lastPracticedAt: row.lastPracticedAt?.toISOString() ?? undefined,
    }));

    return { items, total, page, pageSize, totalPages };
  }

  /** 获取单个词条的掌握度 */
  async getMasteryByWordId(scope: ProfileScope, wordId: number): Promise<WordMasteryView | null> {
    const rows = await this.conn.db
      .select({
        wordId: wordMastery.wordId,
        recognizeScore: wordMastery.recognizeScore,
        listenScore: wordMastery.listenScore,
        spellScore: wordMastery.spellScore,
        speakScore: wordMastery.speakScore,
        overallScore: wordMastery.overallScore,
        fsrsState: wordMastery.fsrsState,
        fsrsNextReview: wordMastery.fsrsNextReview,
        fsrsReps: wordMastery.fsrsReps,
        fsrsLapses: wordMastery.fsrsLapses,
        isLeech: wordMastery.isLeech,
        speakErrorCount: wordMastery.speakErrorCount,
        spellErrorCount: wordMastery.spellErrorCount,
        totalAttempts: wordMastery.totalAttempts,
        lastPracticedAt: wordMastery.lastPracticedAt,
      })
      .from(wordMastery)
      .where(profileWhere(scope, wordMastery.userId, eq(wordMastery.wordId, wordId)))
      .limit(1);

    const row = rows[0];
    if (row === undefined) return null;

    return {
      wordId: row.wordId,
      recognizeScore: parseFloat(row.recognizeScore),
      listenScore: parseFloat(row.listenScore),
      spellScore: parseFloat(row.spellScore),
      speakScore: parseFloat(row.speakScore),
      overallScore: parseFloat(row.overallScore),
      fsrsState: fsrsStateFromDb(row.fsrsState),
      fsrsNextReview: row.fsrsNextReview?.toISOString() ?? undefined,
      fsrsReps: row.fsrsReps,
      fsrsLapses: row.fsrsLapses,
      isLeech: row.isLeech,
      speakErrorCount: row.speakErrorCount,
      spellErrorCount: row.spellErrorCount,
      totalAttempts: row.totalAttempts,
      lastPracticedAt: row.lastPracticedAt?.toISOString() ?? undefined,
    };
  }

  /** 创建或更新词条掌握度（upsert） */
  async upsertMastery(scope: ProfileScope, input: UpdateMasteryInput): Promise<WordMasteryView> {
    const existing = await this.getMasteryByWordId(scope, input.wordId);

    const now = new Date();

    // 🔴 五维分数先算出来（insert / update 两条路径共用），numeric 列写入侧是 string
    const rs: number = input.recognizeScore ?? existing?.recognizeScore ?? 0;
    const ls: number = input.listenScore ?? existing?.listenScore ?? 0;
    const ss: number = input.spellScore ?? existing?.spellScore ?? 0;
    const sk: number = input.speakScore ?? existing?.speakScore ?? 0;
    // 加权综合：认读 0.3 + 听辨 0.25 + 拼写 0.25 + 口语 0.2
    const scores = {
      recognizeScore: toNumeric(rs),
      listenScore: toNumeric(ls),
      spellScore: toNumeric(ss),
      speakScore: toNumeric(sk),
      overallScore: toNumeric(Math.round((rs * 0.3 + ls * 0.25 + ss * 0.25 + sk * 0.2) * 100) / 100),
    };

    /** 可选列：undefined 表示「本次不更新」，不能落null（null 会清掉旧值） */
    const patch: PgUpdateSetSource<typeof wordMastery> = {
      ...scores,
      updatedAt: now,
      lastPracticedAt: now,
      totalAttempts: (existing?.totalAttempts ?? 0) + 1,
    };

    if (input.fsrsState !== undefined) patch.fsrsState = fsrsStateToDb(input.fsrsState);
    if (input.fsrsStability !== undefined) patch.fsrsStability = input.fsrsStability;
    if (input.fsrsDifficulty !== undefined) patch.fsrsDifficulty = input.fsrsDifficulty;
    if (input.fsrsNextReview !== undefined) patch.fsrsNextReview = input.fsrsNextReview;
    if (input.speakErrorCount !== undefined) patch.speakErrorCount = input.speakErrorCount;
    if (input.spellErrorCount !== undefined) patch.spellErrorCount = input.spellErrorCount;
    if (input.phonemeErrorRate !== undefined) patch.phonemeErrorRate = toNumeric(input.phonemeErrorRate);

    if (existing) {
      await this.conn.db
        .update(wordMastery)
        .set(patch)
        .where(profileWhere(scope, wordMastery.userId, eq(wordMastery.wordId, input.wordId)));
    } else {
      await this.conn.db.insert(wordMastery).values({
        userId: scope.profileId,
        wordId: input.wordId,
        ...scores,
        lastPracticedAt: now,
        totalAttempts: 1,
        // 🔴 phonemeErrorRate 是 notNull + default，缺省交给 DB 默认值，不要显式传 null
        ...(input.phonemeErrorRate === undefined
          ? {}
          : { phonemeErrorRate: toNumeric(input.phonemeErrorRate) }),
        speakErrorCount: input.speakErrorCount ?? 0,
        spellErrorCount: input.spellErrorCount ?? 0,
        fsrsState: fsrsStateToDb(input.fsrsState ?? FsrsState.NEW),
        fsrsStability: input.fsrsStability ?? 0.3,
        fsrsDifficulty: input.fsrsDifficulty ?? 5.0,
      });
    }

    // 刚 upsert 过必定存在；查不到说明 profileWhere 过滤掉了刚写入的行，属不变量破坏
    const saved = await this.getMasteryByWordId(scope, input.wordId);
    if (saved === null) {
      throw internalInvariantError('掌握度写入后读取失败');
    }
    return saved;
  }

  // ═══════════════════════════════════════════════════════════
  // learning_record
  // ═══════════════════════════════════════════════════════════

  /** 创建学习记录 */
  async createLearningRecord(scope: ProfileScope, input: CreateLearningRecordInput): Promise<LearningRecordView> {
    const result = await this.conn.db
      .insert(learningRecord)
      .values({
        userId: scope.profileId,
        kind: input.kind,
        refType: input.refType,
        refId: input.refId,
        courseId: input.courseId,
        isCorrect: input.isCorrect,
        // 🔴 numeric 列写入侧是 string（见 toNumeric 注释）
        score: toNumeric(input.score),
        accuracy: toNumeric(input.accuracy),
        fluency: toNumeric(input.fluency),
        completeness: toNumeric(input.completeness),
        prosody: toNumeric(input.prosody),
        durationMs: input.durationMs,
        answerText: input.answerText,
        confidenceLevel: input.confidenceLevel,
        degradeLevel: input.degradeLevel,
        scoreAttribution: input.scoreAttribution,
        formulaVersion: input.formulaVersion,
        status: 'done',
      })
      .returning();

    const row = result[0];
    // 🔴 `INSERT ... RETURNING` 走主键 upsert 语义必然回一行；
    //    空数组说明 DB 层被 truncate/规则拦截，属不变量破坏，必须显式失败而非返回半成品视图。
    if (row === undefined) {
      throw internalInvariantError('学习记录写入后未返回任何行');
    }
    return {
      id: row.id,
      kind: row.kind,
      refType: row.refType,
      refId: row.refId ?? undefined,
      courseId: row.courseId ?? undefined,
      isCorrect: row.isCorrect ?? undefined,
      score: row.score !== null ? parseFloat(row.score) : undefined,
      accuracy: row.accuracy !== null ? parseFloat(row.accuracy) : undefined,
      fluency: row.fluency !== null ? parseFloat(row.fluency) : undefined,
      completeness: row.completeness !== null ? parseFloat(row.completeness) : undefined,
      prosody: row.prosody !== null ? parseFloat(row.prosody) : undefined,
      durationMs: row.durationMs ?? undefined,
      answerText: row.answerText ?? undefined,
      confidenceLevel: row.confidenceLevel ?? undefined,
      degradeLevel: row.degradeLevel ?? undefined,
      scoreAttribution: row.scoreAttribution ?? undefined,
      formulaVersion: row.formulaVersion ?? undefined,
      status: row.status,
      createdAt: row.createdAt.toISOString(),
    };
  }

  /** 学习记录列表 */
  async listLearningRecords(scope: ProfileScope, query: GetRecordsQuery): Promise<{ items: LearningRecordView[]; total: number; page: number; pageSize: number; totalPages: number }> {
    const page = query.page;
    const pageSize = Math.min(query.pageSize, PAGE_SIZE_MAX);

    const conditions: SQL[] = [];
    if (query.kind) {
      conditions.push(eq(learningRecord.kind, query.kind));
    }

    const where = profileWhere(scope, learningRecord.userId, ...conditions);

    // 总数
    const countRows = await this.conn.db
      .select({ total: count() })
      .from(learningRecord)
      .where(where)
      .limit(1);
    const total = countRows[0]?.total ?? 0;
    const totalPages = Math.max(1, Math.ceil(total / pageSize));

    // 分页查询
    const rows = await this.conn.db
      .select()
      .from(learningRecord)
      .where(where)
      .orderBy(desc(learningRecord.createdAt))
      .limit(pageSize)
      .offset((page - 1) * pageSize);

    const items = rows.map((row) => ({
      id: row.id,
      kind: row.kind,
      refType: row.refType,
      refId: row.refId ?? undefined,
      courseId: row.courseId ?? undefined,
      isCorrect: row.isCorrect ?? undefined,
      score: row.score !== null ? parseFloat(row.score) : undefined,
      accuracy: row.accuracy !== null ? parseFloat(row.accuracy) : undefined,
      fluency: row.fluency !== null ? parseFloat(row.fluency) : undefined,
      completeness: row.completeness !== null ? parseFloat(row.completeness) : undefined,
      prosody: row.prosody !== null ? parseFloat(row.prosody) : undefined,
      durationMs: row.durationMs ?? undefined,
      answerText: row.answerText ?? undefined,
      confidenceLevel: row.confidenceLevel ?? undefined,
      degradeLevel: row.degradeLevel ?? undefined,
      scoreAttribution: row.scoreAttribution ?? undefined,
      formulaVersion: row.formulaVersion ?? undefined,
      status: row.status,
      createdAt: row.createdAt.toISOString(),
    }));

    return { items, total, page, pageSize, totalPages };
  }

  // ═══════════════════════════════════════════════════════════
  // today overview
  // ═══════════════════════════════════════════════════════════

  /** 今日概览：今日统计 + 待复习数 */
  async getTodayOverview(scope: ProfileScope): Promise<TodayOverview> {
    const tStart = todayStart();
    const tEnd = todayEnd();

    // 今日日统计
    const [dailyRow] = await this.conn.db
      .select()
      .from(dailyStat)
      .where(profileWhere(scope, dailyStat.userId, eq(dailyStat.statDate, tStart.toISOString().slice(0, 10))))
      .limit(1);

    // 待复习数量（fsrs_next_review <= now）
    const dueRows = await this.conn.db
      .select({ total: count() })
      .from(wordMastery)
      .where(profileWhere(scope, wordMastery.userId, lte(wordMastery.fsrsNextReview, new Date())))
      .limit(1);

    return {
      date: new Date().toISOString().slice(0, 10),
      studyMinutes: dailyRow?.studyMinutes ?? 0,
      newWords: dailyRow?.newWords ?? 0,
      reviews: dailyRow?.reviews ?? 0,
      shadowCount: dailyRow?.shadowCount ?? 0,
      dictationCount: dailyRow?.dictationCount ?? 0,
      avgScore: dailyRow ? parseFloat(dailyRow.avgScore) : 0,
      correctRate: dailyRow ? parseFloat(dailyRow.correctRate) : 0,
      errorCount: dailyRow?.errorCount ?? 0,
      goalMet: dailyRow?.goalMet ?? false,
      dueReviewCount: dueRows[0]?.total ?? 0,
    };
  }

  // ═══════════════════════════════════════════════════════════
  // streak
  // ═══════════════════════════════════════════════════════════

  /** 连续打卡 */
  async getStreak(scope: ProfileScope): Promise<StreakView> {
    const [row] = await this.conn.db
      .select()
      .from(streak)
      .where(profileWhere(scope, streak.userId))
      .limit(1);

    if (row === undefined) {
      return { currentDays: 0, longestDays: 0, freezeUsed: 0 };
    }

    return {
      currentDays: row.currentDays,
      longestDays: row.longestDays,
      lastStudyDate: row.lastStudyDate ?? undefined,
      freezeUsed: row.freezeUsed,
    };
  }

  // ═══════════════════════════════════════════════════════════
  // heatmap
  // ═══════════════════════════════════════════════════════════

  /** 热力图数据（12 周，跨月不清零） */
  async getHeatmap(scope: ProfileScope, query: GetHeatmapQuery): Promise<HeatmapEntry[]> {
    const weeks = Math.min(query.weeks, 52);
    const now = new Date();
    // 区间为「含今天的 weeks×7 天」：向前推weeks×7−1 天，
    // 再加上今天，正好 weeks×7 天。原先用 now+1天 作上界，
    // 而下方补齐循环是闭区间（d <= endDate），会多产出 1 天。
    const startDate = new Date(now.getTime() - (weeks * 7 - 1) * 24 * 3600 * 1000);
    const endDate = now;

    const rows = await this.conn.db
      .select({
        activityDate: heatmap.activityDate,
        level: heatmap.level,
        minutes: heatmap.minutes,
        count: heatmap.count,
      })
      .from(heatmap)
      .where(
        profileWhere(
          scope,
          heatmap.userId,
          gte(heatmap.activityDate, startDate.toISOString().slice(0, 10)),
          lte(heatmap.activityDate, endDate.toISOString().slice(0, 10)),
        ),
      )
      .orderBy(asc(heatmap.activityDate));

    // 补齐缺失日期（level 0）
    const dateMap = new Map<string, HeatmapEntry>();
    for (const row of rows) {
      dateMap.set(row.activityDate, {
        date: row.activityDate,
        level: row.level,
        minutes: row.minutes,
        count: row.count,
      });
    }

    const entries: HeatmapEntry[] = [];
    const d = new Date(startDate);
    while (d <= endDate) {
      const dateStr = d.toISOString().slice(0, 10);
      entries.push(dateMap.get(dateStr) ?? { date: dateStr, level: 0, minutes: 0, count: 0 });
      d.setDate(d.getDate() + 1);
    }

    return entries;
  }

  // ═══════════════════════════════════════════════════════════
  // lesson_block
  // ═══════════════════════════════════════════════════════════

  /** 获取下一个待消费的 5 词循环块 */
  async getNextBlock(scope: ProfileScope, courseId: number): Promise<LessonBlockView | null> {
    const [row] = await this.conn.db
      .select()
      .from(lessonBlock)
      .where(
        profileWhere(
          scope,
          lessonBlock.userId,
          eq(lessonBlock.courseId, courseId),
          eq(lessonBlock.consumed, false),
        ),
      )
      .orderBy(asc(lessonBlock.blockNo))
      .limit(1);

    if (row === undefined) return null;

    return {
      id: row.id,
      courseId: row.courseId,
      blockNo: row.blockNo,
      wordIds: row.wordIds as number[],
      consumed: row.consumed,
      createdAt: row.createdAt.toISOString(),
    };
  }

  /** 标记 5 词循环块已消费 */
  async consumeBlock(scope: ProfileScope, blockId: number): Promise<void> {
    const [block] = await this.conn.db
      .select({ id: lessonBlock.id, userId: lessonBlock.userId })
      .from(lessonBlock)
      .where(profileWhere(scope, lessonBlock.userId, eq(lessonBlock.id, blockId)))
      .limit(1);

    if (block === undefined) {
      throw notFoundError(ErrorCode.RESOURCE_NOT_FOUND, '学习块不存在');
    }

    await this.conn.db
      .update(lessonBlock)
      .set({ consumed: true })
      .where(profileWhere(scope, lessonBlock.userId, eq(lessonBlock.id, blockId)));
  }
}
