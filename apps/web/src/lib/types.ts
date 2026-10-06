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
