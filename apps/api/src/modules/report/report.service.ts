/**
 * Report service - Weekly/Monthly report + CSV export
 */

import { dailyStat, learningRecord, wordMastery, streak } from '@eng-forge/db/schema';
import { Inject, Injectable } from '@nestjs/common';
import { z } from 'zod';

import { DbConnection } from '../../infra/db/db.module.js';
import { asc, desc, gte, lte, type sql } from '../../infra/db/query.js';
import { profileWhere, type ProfileScope } from '../../infra/profile/profile-scope.js';

export interface DailyBreakdownView {
  date: string;
  studyMinutes: number;
  newWords: number;
  reviews: number;
  avgScore: number;
  correctRate: number;
}

export interface WeeklyReportView {
  weekStart: string;
  weekEnd: string;
  totalStudyMinutes: number;
  totalNewWords: number;
  totalReviews: number;
  totalErrors: number;
  avgDailyScore: number;
  correctRate: number;
  dailyBreakdown: DailyBreakdownView[];
  topMasteryWords: Array<{ wordId: number; overallScore: number; }>;
}

export interface WeeklyBreakdownView {
  weekStart: string;
  studyMinutes: number;
  newWords: number;
  reviews: number;
}

export interface MonthlyReportView {
  year: number;
  month: number;
  totalStudyMinutes: number;
  totalNewWords: number;
  totalReviews: number;
  totalErrors: number;
  avgDailyScore: number;
  correctRate: number;
  studyDays: number;
  longestStreak: number;
  weeklyBreakdown: WeeklyBreakdownView[];
}

export interface CsvExportView {
  filename: string;
  content: string;
  rowCount: number;
}

export const GET_WEEKLY_REPORT_SCHEMA = z.object({
  weekStart: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
});

export const GET_MONTHLY_REPORT_SCHEMA = z.object({
  // 🔴 必须用 z.coerce.number()：query 参数经 HTTP 到达时永远是字符串，
  //    裸 `z.number()` 会把 '2025' 拒为 400 VALIDATION_FAILED。
  //    与 z.coerce.boolean 的 'false' → true 同宗，是 z.coerce.* 家族的
  //    「非-coerce 变体在 query 参数上直接错」的第三例。
  year: z.coerce.number().int().min(2020).max(2035),
  month: z.coerce.number().int().min(1).max(12),
});

export const EXPORT_CSV_SCHEMA = z.object({
  type: z.enum(['learning_records', 'word_mastery']),
  startDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  endDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
});

export type GetWeeklyReportInput = z.infer<typeof GET_WEEKLY_REPORT_SCHEMA>;
export type GetMonthlyReportInput = z.infer<typeof GET_MONTHLY_REPORT_SCHEMA>;
export type ExportCsvInput = z.infer<typeof EXPORT_CSV_SCHEMA>;

const TOP_MASTERY_LIMIT = 5;

function parseDate(dateStr: string): Date {
  return new Date(dateStr + 'T00:00:00Z');
}

function toDateString(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function addDays(date: Date, days: number): Date {
  const result = new Date(date);
  result.setUTCDate(result.getUTCDate() + days);
  return result;
}

@Injectable()
export class ReportService {
  constructor(@Inject(DbConnection) private readonly conn: DbConnection) {}

  async getWeeklyReport(scope: ProfileScope, input: GetWeeklyReportInput): Promise<WeeklyReportView> {
    const weekStart = parseDate(input.weekStart);
    const weekEnd = addDays(weekStart, 6);
    const weekEndStr = toDateString(weekEnd);

    const rows = await this.conn.db
      .select()
      .from(dailyStat)
      .where(
        profileWhere(
          scope,
          dailyStat.userId,
          gte(dailyStat.statDate, input.weekStart),
          lte(dailyStat.statDate, weekEndStr),
        ),
      )
      .orderBy(asc(dailyStat.statDate));

    const dayMap = new Map<string, typeof rows[number]>();
    for (const row of rows) {
      dayMap.set(row.statDate, row);
    }

    const dailyBreakdown: DailyBreakdownView[] = [];
    let totalStudyMinutes = 0;
    let totalNewWords = 0;
    let totalReviews = 0;
    let totalErrors = 0;

    for (let i = 0; i < 7; i++) {
      const d = addDays(weekStart, i);
      const dateStr = toDateString(d);
      const row = dayMap.get(dateStr);
      const studyMinutes = row?.studyMinutes ?? 0;
      const newWords = row?.newWords ?? 0;
      const reviews = row?.reviews ?? 0;
      const errorCount = row?.errorCount ?? 0;
      const avgScore = row ? parseFloat(row.avgScore) : 0;
      const correctRate = row ? parseFloat(row.correctRate) : 0;
      totalStudyMinutes += studyMinutes;
      totalNewWords += newWords;
      totalReviews += reviews;
      totalErrors += errorCount;
      dailyBreakdown.push({ date: dateStr, studyMinutes, newWords, reviews, avgScore, correctRate });
    }

    const dayCount = rows.length;
    let scoreSum = 0;
    let correctRateSum = 0;
    for (const row of rows) {
      scoreSum += parseFloat(row.avgScore);
      correctRateSum += parseFloat(row.correctRate);
    }
    const avgDailyScore = dayCount > 0 ? Math.round((scoreSum / dayCount) * 100) / 100 : 0;
    const correctRate = dayCount > 0 ? Math.round((correctRateSum / dayCount) * 100) / 100 : 0;

    const topWords = await this.conn.db
      .select({ wordId: wordMastery.wordId, overallScore: wordMastery.overallScore })
      .from(wordMastery)
      .where(profileWhere(scope, wordMastery.userId))
      .orderBy(desc(wordMastery.overallScore))
      .limit(TOP_MASTERY_LIMIT);

    const topMasteryWords = topWords.map((row) => ({
      wordId: row.wordId,
      overallScore: parseFloat(row.overallScore),
    }));

    return {
      weekStart: input.weekStart,
      weekEnd: weekEndStr,
      totalStudyMinutes,
      totalNewWords,
      totalReviews,
      totalErrors,
      avgDailyScore,
      correctRate,
      dailyBreakdown,
      topMasteryWords,
    };
  }

  async getMonthlyReport(scope: ProfileScope, input: GetMonthlyReportInput): Promise<MonthlyReportView> {
    const { year, month } = input;
    const monthStart = year + '-' + month.toString().padStart(2, '0') + '-01';
    const lastDay = new Date(Date.UTC(year, month, 0)).getUTCDate();
    const monthEnd = year + '-' + month.toString().padStart(2, '0') + '-' + lastDay.toString().padStart(2, '0');

    const rows = await this.conn.db
      .select()
      .from(dailyStat)
      .where(
        profileWhere(
          scope,
          dailyStat.userId,
          gte(dailyStat.statDate, monthStart),
          lte(dailyStat.statDate, monthEnd),
        ),
      )
      .orderBy(asc(dailyStat.statDate));

    let totalStudyMinutes = 0;
    let totalNewWords = 0;
    let totalReviews = 0;
    let totalErrors = 0;
    let studyDays = 0;

    for (const row of rows) {
      totalStudyMinutes += row.studyMinutes;
      totalNewWords += row.newWords;
      totalReviews += row.reviews;
      totalErrors += row.errorCount;
      if (row.studyMinutes > 0 || row.newWords > 0 || row.reviews > 0) {
        studyDays++;
      }
    }

    const dayCount = rows.length;
    let scoreSum = 0;
    let correctRateSum = 0;
    for (const row of rows) {
      scoreSum += parseFloat(row.avgScore);
      correctRateSum += parseFloat(row.correctRate);
    }
    const avgDailyScore = dayCount > 0 ? Math.round((scoreSum / dayCount) * 100) / 100 : 0;
    const correctRate = dayCount > 0 ? Math.round((correctRateSum / dayCount) * 100) / 100 : 0;

    const [streakRow] = await this.conn.db
      .select()
      .from(streak)
      .where(profileWhere(scope, streak.userId))
      .limit(1);
    const longestStreak = streakRow?.longestDays ?? 0;

    const weekMap = new Map<string, { studyMinutes: number; newWords: number; reviews: number }>();
    for (const row of rows) {
      const date = parseDate(row.statDate);
      const dayOfWeek = date.getUTCDay();
      const diff = dayOfWeek === 0 ? 6 : dayOfWeek - 1;
      const weekStartDate = new Date(date.getTime() - diff * 24 * 3600 * 1000);
      const weekStartStr = toDateString(weekStartDate);
      const existing = weekMap.get(weekStartStr) ?? { studyMinutes: 0, newWords: 0, reviews: 0 };
      existing.studyMinutes += row.studyMinutes;
      existing.newWords += row.newWords;
      existing.reviews += row.reviews;
      weekMap.set(weekStartStr, existing);
    }

    const weeklyBreakdown = Array.from(weekMap.entries())
      .map(([weekStart, data]) => ({ weekStart: weekStart, studyMinutes: data.studyMinutes, newWords: data.newWords, reviews: data.reviews }))
      .sort((a, b) => a.weekStart.localeCompare(b.weekStart));

    return {
      year,
      month,
      totalStudyMinutes,
      totalNewWords,
      totalReviews,
      totalErrors,
      avgDailyScore,
      correctRate,
      studyDays,
      longestStreak,
      weeklyBreakdown,
    };
  }

  async exportCsv(scope: ProfileScope, input: ExportCsvInput): Promise<CsvExportView> {
    if (input.type === 'learning_records') {
      return this.exportLearningRecordsCsv(scope, input.startDate, input.endDate);
    }
    return this.exportWordMasteryCsv(scope, input.startDate, input.endDate);
  }

  private async exportLearningRecordsCsv(scope: ProfileScope, startDate?: string, endDate?: string): Promise<CsvExportView> {
    const conditions: ReturnType<typeof sql>[] = [];
    if (startDate) {
      conditions.push(gte(learningRecord.createdAt, new Date(startDate + 'T00:00:00Z')));
    }
    if (endDate) {
      conditions.push(lte(learningRecord.createdAt, new Date(endDate + 'T23:59:59Z')));
    }
    const where = profileWhere(scope, learningRecord.userId, ...conditions);
    const rows = await this.conn.db.select().from(learningRecord).where(where).orderBy(desc(learningRecord.createdAt));
    const headers = ['id', 'kind', 'refType', 'refId', 'courseId', 'isCorrect', 'score', 'accuracy', 'durationMs', 'createdAt'];
    const csvLines = [headers.join(',')];
    for (const row of rows) {
      const values = [
        row.id, row.kind, row.refType, row.refId ?? '', row.courseId ?? '',
        row.isCorrect !== null ? String(row.isCorrect) : '',
        row.score !== null ? parseFloat(row.score).toString() : '',
        row.accuracy !== null ? parseFloat(row.accuracy).toString() : '',
        row.durationMs ?? '', row.createdAt.toISOString(),
      ];
      csvLines.push(values.map(csvEscape).join(','));
    }
    return {
      filename: 'learning_records_' + new Date().toISOString().slice(0, 10) + '.csv',
      content: csvLines.join('\n'),
      rowCount: rows.length,
    };
  }

  private async exportWordMasteryCsv(scope: ProfileScope, startDate?: string, endDate?: string): Promise<CsvExportView> {
    const conditions: ReturnType<typeof sql>[] = [];
    if (startDate) {
      conditions.push(gte(wordMastery.lastPracticedAt, new Date(startDate + 'T00:00:00Z')));
    }
    if (endDate) {
      conditions.push(lte(wordMastery.lastPracticedAt, new Date(endDate + 'T23:59:59Z')));
    }
    const where = profileWhere(scope, wordMastery.userId, ...conditions);
    const rows = await this.conn.db.select().from(wordMastery).where(where).orderBy(desc(wordMastery.overallScore));
    const headers = ['wordId', 'recognizeScore', 'listenScore', 'spellScore', 'speakScore', 'overallScore', 'fsrsState', 'fsrsNextReview', 'totalAttempts'];
    const csvLines = [headers.join(',')];
    for (const row of rows) {
      const values = [
        row.wordId,
        parseFloat(row.recognizeScore).toString(),
        parseFloat(row.listenScore).toString(),
        parseFloat(row.spellScore).toString(),
        parseFloat(row.speakScore).toString(),
        parseFloat(row.overallScore).toString(),
        String(row.fsrsState),
        row.fsrsNextReview?.toISOString() ?? '',
        String(row.totalAttempts),
      ];
      csvLines.push(values.map(csvEscape).join(','));
    }
    return {
      filename: 'word_mastery_' + new Date().toISOString().slice(0, 10) + '.csv',
      content: csvLines.join('\n'),
      rowCount: rows.length,
    };
  }
}

function csvEscape(value: unknown): string {
  const str = value === null || value === undefined ? '' : String(value);
  if (str.includes(',') || str.includes('"') || str.includes('\n')) {
    return '"' + str.replace(/"/g, '""') + '"';
  }
  return str;
}
