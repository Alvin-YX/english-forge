import { create } from 'zustand';

export interface TodayOverview {
  wordsLearned: number;
  wordsReviewed: number;
  studyMinutes: number;
  xpGained: number;
  streakDays: number;
  xpToNextLevel: number;
  level: number;
}

export interface StreakState {
  currentStreak: number;
  longestStreak: number;
  freezeAvailable: number;
  streakStartAt: string | null;
}

export interface HeatmapCell {
  date: string;
  count: number;
  level: 0 | 1 | 2 | 3 | 4;
}

export interface HeatmapData {
  weeks: HeatmapCell[][];
  totalWords: number;
}

export interface MasterySnapshot {
  totalWords: number;
  mastered: number;
  learning: number;
  newWords: number;
}

export interface LearningRecord {
  id: string;
  kind: 'word' | 'spell' | 'dictation' | 'pronunciation';
  target: string;
  correct: boolean;
  score?: number;
  createdAt: string;
}

interface LearningState {
  todayOverview: TodayOverview | null;
  streak: StreakState | null;
  heatmap: HeatmapData | null;
  mastery: MasterySnapshot | null;
  records: LearningRecord[];

  setTodayOverview: (v: TodayOverview) => void;
  setStreak: (v: StreakState) => void;
  setHeatmap: (v: HeatmapData) => void;
  setMastery: (v: MasterySnapshot) => void;
  addRecord: (r: LearningRecord) => void;
  reset: () => void;
}

const initialSnapshot: Pick<
  LearningState,
  'todayOverview' | 'streak' | 'heatmap' | 'mastery' | 'records'
> = {
  todayOverview: null,
  streak: null,
  heatmap: null,
  mastery: null,
  records: [],
};

export const useLearningStore = create<LearningState>((set) => ({
  ...initialSnapshot,
  setTodayOverview: (v) => set({ todayOverview: v }),
  setStreak: (v) => set({ streak: v }),
  setHeatmap: (v) => set({ heatmap: v }),
  setMastery: (v) => set({ mastery: v }),
  addRecord: (r) => set((s) => ({ records: [r, ...s.records].slice(0, 100) })),
  reset: () => set(initialSnapshot),
}));
