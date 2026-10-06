/**
 * Web 端本地类型 —— 与 contracts 无冲突的前端专用视图模型。
 * 契约层类型（ApiResponse / WordEntry 等）从 @eng-forge/contracts 导入。
 */

export type TrendDirection = 'up' | 'down' | 'flat';

export interface WordCard {
  id: string;
  headword: string;
  phonetic: string;
  translation: string;
  definition: string;
  example?: string;
  category?: string;
}

export interface SentenceItem {
  id: string;
  sentence: string;
  translation: string;
}

export interface ErrorBookItem {
  id: string;
  kind: 'word' | 'spell' | 'dictation' | 'pronunciation';
  target: string;
  translation?: string;
  category?: string;
  correctCount: number;
  totalCount: number;
  favorite: boolean;
  createdAt: string;
  lastSeenAt: string;
}

export interface ChildProfile {
  id: string;
  displayName: string;
  avatarColor?: string;
  grade?: string;
  streakDays: number;
  todayWords: number;
  xp: number;
  lastStudyAt: string | null;
}

// ── Gamification types ──
export interface BadgeView {
  code: string;
  earnedAt: string;
}

export interface WeeklyChallengeView {
  id: number;
  weekStart: string;
  title: string;
  metric: string;
  targetValue: number;
  currentValue: number;
  rewardPoints: number;
  status: 'ongoing' | 'done' | 'expired';
}

export interface GameRecordView {
  id: number;
  gameCode: string;
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

// ── Conversation types ──
export interface ConversationView {
  id: number;
  mode: string;
  persona: string;
  level: string;
  turnCount: number;
  totalTokens: number;
  status: 'active' | 'finished' | 'error';
  startedAt: string;
  endedAt?: string;
}

export interface MessageView {
  id: number;
  conversationId: number;
  seq: number;
  role: 'user' | 'assistant' | 'system';
  content: string;
  inputType: 'text' | 'voice';
  filtered: boolean;
  createdAt: string;
}

// ── Report types ──
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
  topMasteryWords: Array<{ wordId: number; overallScore: number }>;
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
  weeklyBreakdown: Array<{ weekStart: string; studyMinutes: number; newWords: number; reviews: number }>;
}

export interface CsvExportView {
  filename: string;
  content: string;
  rowCount: number;
}

// ── Common types ──
export interface PaginatedResponse<T> {
  items: T[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
}
