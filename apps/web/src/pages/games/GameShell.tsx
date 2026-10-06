import type { ReactNode } from 'react';
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
} from 'react';
import { useNavigate } from 'react-router-dom';

import { Badge } from '../../components/ui/Badge';
import { Button } from '../../components/ui/Button';
import { api } from '../../lib/api';

export type GameCode = 'word_shooter' | 'spell_truck' | 'miner' | 'match4';
export type GamePhase = 'start' | 'playing' | 'over';

export interface WrongWord {
  wordId: number;
  count: number;
}

export interface GameState {
  phase: GamePhase;
  score: number;
  combo: number;
  maxCombo: number;
  elapsed: number;
  accuracy: number;
  attempts: number;
  correct: number;
  wrongWords: WrongWord[];
  durationMs: number;
}

const defaultState: GameState = {
  phase: 'start',
  score: 0,
  combo: 0,
  maxCombo: 0,
  elapsed: 0,
  accuracy: 100,
  attempts: 0,
  correct: 0,
  wrongWords: [],
  durationMs: 0,
};

export interface GameContextValue {
  state: GameState;
  start: () => void;
  endGame: () => void;
  reset: () => void;
  addScore: (points: number) => void;
  setCombo: (combo: number) => void;
  recordCorrect: () => void;
  recordWrong: (wordId?: number) => void;
  recordMiss: () => void;
  recordAttempt: () => void;
}

const GameContext = createContext<GameContextValue | null>(null);

export function useGameContext(): GameContextValue {
  const ctx = useContext(GameContext);
  if (!ctx) throw new Error('useGameContext must be used within GameShell');
  return ctx;
}

export function formatTime(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

export interface GameShellProps {
  gameCode: GameCode;
  gameName: string;
  description: string;
  children: ReactNode;
}

export function GameShell({
  gameCode,
  gameName,
  description,
  children,
}: GameShellProps) {
  const navigate = useNavigate();
  const [state, setState] = useState<GameState>(defaultState);
  const startTimeRef = useRef(0);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const submittingRef = useRef(false);

  const start = useCallback(() => {
    setState({ ...defaultState, phase: 'playing' });
    startTimeRef.current = Date.now();
    if (timerRef.current) clearInterval(timerRef.current);
    timerRef.current = setInterval(() => {
      setState((prev) => ({
        ...prev,
        elapsed: Math.floor((Date.now() - startTimeRef.current) / 1000),
      }));
    }, 1000);
  }, []);

  const endGame = useCallback(() => {
    if (timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }
    const durationMs = Date.now() - startTimeRef.current;

    setState((prev) => {
      const next = { ...prev, phase: 'over' as GamePhase, durationMs };
      if (!submittingRef.current) {
        submittingRef.current = true;
        api
          .post('/gamification/games', {
            gameCode,
            score: next.score,
            comboMax: next.maxCombo,
            accuracy: next.accuracy,
            durationMs,
            wrongWords: next.wrongWords,
          })
          .catch(() => {});
      }
      return next;
    });
  }, [gameCode]);

  const reset = useCallback(() => {
    submittingRef.current = false;
    setState(defaultState);
  }, []);

  const addScore = useCallback((points: number) => {
    setState((prev) => ({ ...prev, score: Math.max(0, prev.score + points) }));
  }, []);

  const setCombo = useCallback((combo: number) => {
    setState((prev) => ({
      ...prev,
      combo,
      maxCombo: Math.max(prev.maxCombo, combo),
    }));
  }, []);

  const recordCorrect = useCallback(() => {
    setState((prev) => {
      const newCorrect = prev.correct + 1;
      const accuracy =
        prev.attempts > 0
          ? Math.round((newCorrect / prev.attempts) * 100)
          : 100;
      return { ...prev, correct: newCorrect, accuracy };
    });
  }, []);

  const recordWrong = useCallback((wordId?: number) => {
    setState((prev) => {
      const newAttempts = prev.attempts + 1;
      const accuracy = Math.round((prev.correct / newAttempts) * 100);
      let wrongWords = prev.wrongWords;
      if (wordId !== undefined) {
        const existing = wrongWords.find((w) => w.wordId === wordId);
        if (existing) {
          wrongWords = wrongWords.map((w) =>
            w.wordId === wordId ? { ...w, count: w.count + 1 } : w,
          );
        } else {
          wrongWords = [...wrongWords, { wordId, count: 1 }];
        }
      }
      return { ...prev, attempts: newAttempts, accuracy, wrongWords, combo: 0 };
    });
  }, []);

  const recordMiss = useCallback(() => {
    setState((prev) => {
      const newAttempts = prev.attempts + 1;
      const accuracy = Math.round((prev.correct / newAttempts) * 100);
      return { ...prev, attempts: newAttempts, accuracy, combo: 0 };
    });
  }, []);

  const recordAttempt = useCallback(() => {
    setState((prev) => {
      const newAttempts = prev.attempts + 1;
      const accuracy =
        newAttempts > 0
          ? Math.round((prev.correct / newAttempts) * 100)
          : 100;
      return { ...prev, attempts: newAttempts, accuracy };
    });
  }, []);

  useEffect(() => {
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, []);

  const ctxValue: GameContextValue = {
    state,
    start,
    endGame,
    reset,
    addScore,
    setCombo,
    recordCorrect,
    recordWrong,
    recordMiss,
    recordAttempt,
  };

  const accuracyDisplay =
    state.attempts > 0 ? state.accuracy : 100;

  return (
    <GameContext.Provider value={ctxValue}>
      {state.phase === 'start' ? (
        <StartScreen
          gameName={gameName}
          description={description}
          onStart={start}
        />
      ) : (
        <div className="flex flex-col gap-4">
          <div className="flex items-center justify-between rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
            <div className="flex items-center gap-2">
              <span className="text-2xl font-bold text-primary-600">
                {state.score}
              </span>
              <span className="text-sm text-slate-500">分</span>
              {state.combo > 1 ? (
                <Badge variant="warning">连击 x{state.combo}</Badge>
              ) : null}
            </div>
            <div className="text-center">
              <p className="text-xs text-slate-500">正确率</p>
              <p className="text-lg font-semibold text-slate-800">
                {accuracyDisplay}%
              </p>
            </div>
            <div className="text-right">
              <p className="text-xs text-slate-500">时间</p>
              <p className="text-lg font-semibold text-slate-800">
                {formatTime(state.elapsed)}
              </p>
            </div>
          </div>

          {state.phase === 'playing' ? (
            <div className="flex-1">{children}</div>
          ) : null}

          {state.phase === 'over' ? (
            <GameOverScreen
              score={state.score}
              maxCombo={state.maxCombo}
              accuracy={state.accuracy}
              durationMs={state.durationMs}
              onPlayAgain={() => {
                reset();
                start();
              }}
              onBack={() => navigate('/gamification')}
            />
          ) : null}
        </div>
      )}
    </GameContext.Provider>
  );
}

function StartScreen({
  gameName,
  description,
  onStart,
}: {
  gameName: string;
  description: string;
  onStart: () => void;
}) {
  return (
    <div className="flex min-h-[60vh] flex-col items-center justify-center gap-6">
      <div className="flex h-20 w-20 items-center justify-center rounded-full bg-primary-100 text-5xl">
        🎮
      </div>
      <h1 className="text-3xl font-bold text-slate-900">{gameName}</h1>
      <p className="max-w-md text-center text-slate-500">{description}</p>
      <Button size="lg" onClick={onStart}>
        开始游戏
      </Button>
    </div>
  );
}

function GameOverScreen({
  score,
  maxCombo,
  accuracy,
  durationMs,
  onPlayAgain,
  onBack,
}: {
  score: number;
  maxCombo: number;
  accuracy: number;
  durationMs: number;
  onPlayAgain: () => void;
  onBack: () => void;
}) {
  return (
    <div className="flex min-h-[50vh] flex-col items-center justify-center gap-6">
      <div className="flex h-20 w-20 items-center justify-center rounded-full bg-warning-50 text-5xl">
        🏁
      </div>
      <h2 className="text-2xl font-bold text-slate-900">游戏结束</h2>
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
        <div className="rounded-xl bg-slate-50 p-4 text-center">
          <p className="text-xs text-slate-500">得分</p>
          <p className="mt-1 text-2xl font-bold text-primary-600">{score}</p>
        </div>
        <div className="rounded-xl bg-slate-50 p-4 text-center">
          <p className="text-xs text-slate-500">最高连击</p>
          <p className="mt-1 text-2xl font-bold text-warning-600">
            {maxCombo}x
          </p>
        </div>
        <div className="rounded-xl bg-slate-50 p-4 text-center">
          <p className="text-xs text-slate-500">正确率</p>
          <p className="mt-1 text-2xl font-bold text-success-600">
            {accuracy}%
          </p>
        </div>
        <div className="rounded-xl bg-slate-50 p-4 text-center">
          <p className="text-xs text-slate-500">用时</p>
          <p className="mt-1 text-2xl font-bold text-slate-700">
            {(durationMs / 1000).toFixed(1)}s
          </p>
        </div>
      </div>
      <div className="flex gap-3">
        <Button variant="outline" onClick={onBack}>
          ← 返回游戏中心
        </Button>
        <Button onClick={onPlayAgain}>再来一局</Button>
      </div>
    </div>
  );
}
