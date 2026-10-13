import { useCallback, useEffect, useRef, useState } from 'react';

import { PageLoader } from '../../components/common/PageLoader';
import { apiList } from '../../lib/api';
import type { WordCard } from '../../lib/types';

import { GameShell, useGameContext } from './GameShell';

const GAME_DURATION = 60;

interface FloatingWord {
  id: number;
  word: WordCard;
  x: number;
  y: number;
  speed: number;
  status: 'active' | 'hit' | 'missed';
}

let nextId = 0;

function WordShooterInner() {
  const { state, endGame, addScore, setCombo, recordCorrect, recordMiss } =
    useGameContext();
  const [words, setWords] = useState<WordCard[]>([]);
  const [loading, setLoading] = useState(true);
  const [activeWords, setActiveWords] = useState<FloatingWord[]>([]);
  const wordPoolRef = useRef<WordCard[]>([]);
  const gameTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const animFrameRef = useRef<ReturnType<typeof requestAnimationFrame> | null>(null);
  const lastSpawnRef = useRef(0);
  const lastTickRef = useRef(0);
  const elapsedAtStartRef = useRef(0);
  const comboRef = useRef(0);
  const scoreRef = useRef(0);

  comboRef.current = state.combo;
  scoreRef.current = state.score;

  const loadWords = useCallback(async () => {
    setLoading(true);
    try {
      const data = await apiList.get<WordCard>('/words?pageSize=100');
      const pool = data.filter((w) => w.translation && w.headword);
      wordPoolRef.current = pool;
      setWords(pool);
    } catch {
      setWords([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadWords();
  }, [loadWords]);

  // Game countdown timer
  useEffect(() => {
    if (state.phase !== 'playing') return;
    const remaining = GAME_DURATION - state.elapsed;
    if (remaining <= 0) {
      endGame();
      return;
    }
    gameTimerRef.current = setTimeout(() => endGame(), remaining * 1000);
    return () => {
      if (gameTimerRef.current) clearTimeout(gameTimerRef.current);
    };
  }, [state.phase, state.elapsed, endGame]);

  // Spawn words and animate
  useEffect(() => {
    if (state.phase !== 'playing') return;
    elapsedAtStartRef.current = state.elapsed;
    lastTickRef.current = performance.now();
    lastSpawnRef.current = performance.now();

    const spawnInterval = () => 800 + Math.random() * 800;

    let lastSpawn = lastSpawnRef.current;
    let lastTick = lastTickRef.current;
    let pool = [...wordPoolRef.current];
    if (pool.length < 5) return;

    const tick = (now: number) => {
      // Spawn new words
      if (now - lastSpawn > spawnInterval()) {
        const word = pool[Math.floor(Math.random() * pool.length)];
        const x = 10 + Math.random() * 80;
        const speed = 6 + Math.random() * 4; // percent per second
        // FloatingWord.word 非空，索引结果可能为 undefined —— 无词则跳过本次生成
        if (word) {
          setActiveWords((prev) => [
            ...prev,
            {
              id: ++nextId,
              word,
              x,
              y: 110,
              speed,
              status: 'active',
            },
          ]);
        }
        lastSpawn = now;
      }

      // Update positions
      const dt = (now - lastTick) / 1000;
      lastTick = now;

      setActiveWords((prev) => {
        const updated = prev
          .map((fw) => {
            if (fw.status !== 'active') return fw;
            return { ...fw, y: fw.y - fw.speed * dt };
          })
          .filter((fw) => {
            if (fw.y < -15) {
              // Word exited top — miss
              if (fw.status === 'active') {
                recordMiss();
              }
              return false;
            }
            return true;
          });
        return updated;
      });

      animFrameRef.current = requestAnimationFrame(tick);
    };

    animFrameRef.current = requestAnimationFrame(tick);
    return () => {
      if (animFrameRef.current) cancelAnimationFrame(animFrameRef.current);
    };
  }, [state.phase, recordMiss]);

  const handleShoot = useCallback(
    (fw: FloatingWord) => {
      if (fw.status !== 'active') return;
      // Mark as hit
      setActiveWords((prev) =>
        prev.map((w) => (w.id === fw.id ? { ...w, status: 'hit' } : w)),
      );
      // Score
      const points = 10;
      addScore(points);
      recordCorrect();
      const newCombo = comboRef.current + 1;
      setCombo(newCombo);
      // Remove after animation
      setTimeout(() => {
        setActiveWords((prev) => prev.filter((w) => w.id !== fw.id));
      }, 300);
    },
    [addScore, recordCorrect, setCombo],
  );

  if (loading) return <PageLoader message="正在加载词库…" />;
  if (words.length === 0)
    return (
      <div className="flex flex-col items-center justify-center gap-3 py-20 text-slate-400">
        <span className="text-4xl">📚</span>
        <p className="text-sm">词库为空，请先在词库管理中添加单词</p>
      </div>
    );

  const remainingTime = GAME_DURATION - state.elapsed;

  return (
    <div className="relative overflow-hidden rounded-xl bg-gradient-to-b from-sky-50 to-blue-100" style={{ height: '70vh', minHeight: '400px' }}>
      {/* Target zone indicator */}
      <div className="absolute left-0 right-0 top-0 z-10 flex items-center justify-between px-4 py-2">
        <span className="rounded-full bg-white/80 px-3 py-1 text-xs font-medium text-slate-600 backdrop-blur">
          点击你认识的单词！
        </span>
        <span className="rounded-full bg-white/80 px-3 py-1 text-xs font-medium text-danger-600 backdrop-blur">
          剩余 {remainingTime}s
        </span>
      </div>

      {/* Floating words */}
      {activeWords.map((fw) => (
        <button
          key={fw.id}
          onClick={() => handleShoot(fw)}
          disabled={fw.status !== 'active'}
          className={`absolute z-20 cursor-pointer rounded-xl border-2 bg-white px-4 py-3 text-left shadow-lg transition-all duration-200 hover:scale-105 ${
            fw.status === 'hit'
              ? 'scale-125 border-success-400 bg-success-50 opacity-0'
              : 'border-primary-200 hover:border-primary-400'
          }`}
          style={{
            left: `${fw.x}%`,
            top: `${fw.y}%`,
            transform: `translate(-50%, -50%) scale(${fw.status === 'hit' ? 1.5 : 1})`,
            opacity: fw.status === 'hit' ? 0 : 1,
            pointerEvents: fw.status === 'active' ? 'auto' : 'none',
            transition: 'opacity 0.3s, transform 0.3s',
          }}
        >
          <p className="text-lg font-bold text-slate-800">{fw.word.headword}</p>
          <p className="text-sm text-slate-500">{fw.word.translation}</p>
        </button>
      ))}

      {/* Decorative elements */}
      <div className="pointer-events-none absolute bottom-4 left-1/2 -translate-x-1/2 text-4xl opacity-20">
        🎯
      </div>
    </div>
  );
}

export function WordShooterGame() {
  return (
    <GameShell
      gameCode="word_shooter"
      gameName="单词射击"
      description="单词从底部飘浮上升，点击你认识的单词得分。不认识的就让它飘走吧！60 秒限时挑战。"
    >
      <WordShooterInner />
    </GameShell>
  );
}
