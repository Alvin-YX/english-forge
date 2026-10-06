import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { PageLoader } from '../../components/common/PageLoader';
import { api } from '../../lib/api';
import type { WordCard } from '../../lib/types';

import { GameShell, useGameContext } from './GameShell';

const GRID_SIZE = 4;
const TOTAL_TILES = GRID_SIZE * GRID_SIZE;
const WORD_COUNT = 6;
const MAX_DIGS = 15;
const CORRECT_POINTS = 20;
const WRONG_PENALTY = 10;

interface Tile {
  id: number;
  word: WordCard | null;
  dug: boolean;
  correct: boolean | null; // null = not dug, true = correct dig, false = wrong dig
}

function generateTiles(words: WordCard[]): Tile[] {
  const tiles: Tile[] = Array.from({ length: TOTAL_TILES }, (_, i) => ({
    id: i,
    word: null,
    dug: false,
    correct: null,
  }));

  // Select words to place
  const shuffled = [...words].sort(() => Math.random() - 0.5);
  const selected = shuffled.slice(0, WORD_COUNT);

  // Randomly place words in tiles.
  // `positions[i]` / `selected[i]` 在 noUncheckedIndexedAccess 下均为
  // `number | undefined` / `WordCard | undefined`；两者长度都由上面的
  // `Array.from({length})` 与 `slice` 保证一致，但仍需显式收窄。
  const positions = Array.from({ length: TOTAL_TILES }, (_, i) => i).sort(
    () => Math.random() - 0.5,
  );
  for (let i = 0; i < WORD_COUNT; i++) {
    const pos = positions[i];
    const word = selected[i];
    if (pos === undefined || word === undefined) continue;
    const tile = tiles[pos];
    if (tile === undefined) continue;
    tiles[pos] = { ...tile, word };
  }

  return tiles;
}

function MinerInner() {
  const { state, endGame, addScore, setCombo, recordCorrect, recordWrong } =
    useGameContext();
  const [words, setWords] = useState<WordCard[]>([]);
  const [loading, setLoading] = useState(true);
  const [tiles, setTiles] = useState<Tile[]>([]);
  const [digsLeft, setDigsLeft] = useState(MAX_DIGS);
  const [targetWord, setTargetWord] = useState<WordCard | null>(null);
  const [feedback, setFeedback] = useState<'idle' | 'correct' | 'wrong'>('idle');
  const comboRef = useRef(0);
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  comboRef.current = state.combo;

  const loadWords = useCallback(async () => {
    setLoading(true);
    try {
      const data = await api.get<WordCard[]>('/words?pageSize=200');
      setWords(
        data.filter(
          (w) => w.translation && w.headword && w.translation.trim().length > 0,
        ),
      );
    } catch {
      setWords([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadWords();
  }, [loadWords]);

  // Initialize game when words are loaded
  useEffect(() => {
    if (words.length < WORD_COUNT) return;
    const newTiles = generateTiles(words);
    setTiles(newTiles);
    setDigsLeft(MAX_DIGS);
    // Pick first target word
    const targetWords = newTiles
      .map((t) => t.word)
      .filter((w): w is WordCard => w !== null);
    const first = targetWords[Math.floor(Math.random() * targetWords.length)];
    if (first) setTargetWord(first);
  }, [words]);

  const foundCount = useMemo(
    () => tiles.filter((t) => t.dug && t.correct === true).length,
    [tiles],
  );

  // Check game over conditions
  useEffect(() => {
    if (state.phase !== 'playing') return;
    if (digsLeft <= 0 || foundCount >= WORD_COUNT) {
      if (timeoutRef.current) clearTimeout(timeoutRef.current);
      timeoutRef.current = setTimeout(() => endGame(), 800);
    }
    return () => {
      if (timeoutRef.current) clearTimeout(timeoutRef.current);
    };
  }, [digsLeft, foundCount, state.phase, endGame]);

  const handleDig = useCallback(
    (tileId: number) => {
      if (digsLeft <= 0 || feedback !== 'idle') return;

      const tile = tiles[tileId];
      if (!tile || tile.dug) return;

      const isCorrect = tile.word !== null;
      const digsAfter = digsLeft - 1;
      setDigsLeft(digsAfter);

      setTiles((prev) =>
        prev.map((t) =>
          t.id === tileId ? { ...t, dug: true, correct: isCorrect } : t,
        ),
      );

      if (isCorrect && tile.word) {
        // Correct dig
        setFeedback('correct');
        addScore(CORRECT_POINTS);
        recordCorrect();
        const newCombo = comboRef.current + 1;
        setCombo(newCombo);

        if (timeoutRef.current) clearTimeout(timeoutRef.current);
        timeoutRef.current = setTimeout(() => {
          setFeedback('idle');
          // Pick next target word
          const remaining = tiles
            .filter((t) => !t.dug)
            .map((t) => t.word)
            .filter((w): w is WordCard => w !== null);
          const next = remaining[Math.floor(Math.random() * remaining.length)];
          if (next) setTargetWord(next);
        }, 800);
      } else {
        // Wrong dig
        setFeedback('wrong');
        addScore(-WRONG_PENALTY);
        recordWrong();
        setCombo(0);

        if (timeoutRef.current) clearTimeout(timeoutRef.current);
        timeoutRef.current = setTimeout(() => setFeedback('idle'), 800);
      }
    },
    [
      tiles,
      digsLeft,
      feedback,
      addScore,
      recordCorrect,
      recordWrong,
      setCombo,
    ],
  );

  useEffect(() => {
    return () => {
      if (timeoutRef.current) clearTimeout(timeoutRef.current);
    };
  }, []);

  if (loading) return <PageLoader message="正在加载词库…" />;
  if (words.length < WORD_COUNT)
    return (
      <div className="flex flex-col items-center justify-center gap-3 py-20 text-slate-400">
        <span className="text-4xl">📚</span>
        <p className="text-sm">词库不足，需要至少 {WORD_COUNT} 个单词</p>
      </div>
    );

  return (
    <div className="flex flex-col items-center gap-6">
      {/* Target word display */}
      <div
        className={`rounded-xl border-2 bg-white p-5 text-center shadow-sm transition-colors ${
          feedback === 'correct'
            ? 'border-success-400 bg-success-50'
            : feedback === 'wrong'
              ? 'border-danger-400 bg-danger-50'
              : 'border-primary-200 bg-primary-50'
        }`}
      >
        <p className="text-sm text-slate-500">
          🎯 挖掘目标单词：<span className="font-semibold">{targetWord?.translation}</span>
        </p>
        {feedback === 'correct' ? (
          <p className="mt-2 text-lg font-bold text-success-600">
            ✓ 找到了！+{CORRECT_POINTS} 分
          </p>
        ) : feedback === 'wrong' ? (
          <p className="mt-2 text-lg font-bold text-danger-600">
            ✗ 这里没有！-{WRONG_PENALTY} 分
          </p>
        ) : null}
      </div>

      {/* Digs remaining */}
      <div className="flex items-center gap-4">
        <div className="flex items-center gap-2">
          <span className="text-sm text-slate-500">剩余挖掘次数：</span>
          <div className="flex gap-1">
            {Array.from({ length: MAX_DIGS }).map((_, i) => (
              <div
                key={i}
                className={`h-3 w-3 rounded-full ${
                  i < digsLeft ? 'bg-primary-500' : 'bg-slate-300'
                }`}
              />
            ))}
          </div>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-sm text-slate-500">已找到：</span>
          <span className="text-lg font-bold text-primary-600">
            {foundCount}/{WORD_COUNT}
          </span>
        </div>
      </div>

      {/* Grid */}
      <div
        className="grid gap-3"
        style={{ gridTemplateColumns: `repeat(${GRID_SIZE}, minmax(0, 1fr))` }}
      >
        {tiles.map((tile) => (
          <button
            key={tile.id}
            onClick={() => handleDig(tile.id)}
            disabled={tile.dug || digsLeft <= 0 || feedback !== 'idle'}
            className={`flex h-24 w-24 flex-col items-center justify-center rounded-xl border-2 text-center transition-all duration-200 sm:h-28 sm:w-28 ${
              tile.dug
                ? tile.correct
                  ? 'border-success-400 bg-success-50 shadow-inner'
                  : 'border-danger-300 bg-danger-50'
                : 'cursor-pointer border-slate-300 bg-gradient-to-br from-slate-600 to-slate-700 text-white hover:border-primary-400 hover:from-primary-600 hover:to-primary-700 active:scale-95'
            }`}
          >
            {tile.dug ? (
              tile.correct ? (
                <div className="flex flex-col items-center gap-1 px-2">
                  <span className="text-lg font-bold text-success-700">
                    {tile.word?.headword}
                  </span>
                  <span className="text-xs text-success-600">
                    {tile.word?.translation}
                  </span>
                </div>
              ) : (
                <span className="text-3xl text-danger-500">✕</span>
              )
            ) : (
              <span className="text-2xl">⛏️</span>
            )}
          </button>
        ))}
      </div>

      {foundCount >= WORD_COUNT ? (
        <div className="rounded-xl bg-success-50 p-4 text-center text-success-700">
          <p className="font-semibold">🎉 恭喜！找到了所有单词！</p>
        </div>
      ) : digsLeft <= 0 ? (
        <div className="rounded-xl bg-warning-50 p-4 text-center text-warning-700">
          <p className="font-semibold">
            挖掘次数用完了，找到了 {foundCount}/{WORD_COUNT} 个单词
          </p>
        </div>
      ) : null}
    </div>
  );
}

export function MinerGame() {
  return (
    <GameShell
      gameCode="miner"
      gameName="单词矿工"
      description="显示目标单词的中文释义，挖掘格子找到对应的英文单词。挖掘次数有限，找对得分，挖错扣分！"
    >
      <MinerInner />
    </GameShell>
  );
}
