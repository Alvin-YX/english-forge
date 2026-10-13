import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { PageLoader } from '../../components/common/PageLoader';
import { apiList } from '../../lib/api';
import type { WordCard } from '../../lib/types';

import { GameShell, useGameContext, formatTime } from './GameShell';

const PAIRS = 6;
const POINTS_PER_MATCH = 25;

type CardType = 'english' | 'chinese';

interface MatchCard {
  id: number;
  wordId: number;
  type: CardType;
  display: string;
  flipped: boolean;
  matched: boolean;
}

function generateCards(words: WordCard[]): MatchCard[] {
  const shuffled = [...words].sort(() => Math.random() - 0.5);
  const selected = shuffled.slice(0, PAIRS);
  const cards: MatchCard[] = [];

  selected.forEach((word, idx) => {
    cards.push({
      id: idx * 2,
      wordId: Number(word.id),
      type: 'english',
      display: word.headword,
      flipped: false,
      matched: false,
    });
    cards.push({
      id: idx * 2 + 1,
      wordId: Number(word.id),
      type: 'chinese',
      display: word.translation,
      flipped: false,
      matched: false,
    });
  });

  // Shuffle the cards
  return cards.sort(() => Math.random() - 0.5);
}

function Match4Inner() {
  const { state, endGame, addScore, setCombo, recordCorrect, recordAttempt } =
    useGameContext();
  const [words, setWords] = useState<WordCard[]>([]);
  const [loading, setLoading] = useState(true);
  const [cards, setCards] = useState<MatchCard[]>([]);
  const [flippedIds, setFlippedIds] = useState<number[]>([]);
  const [attempts, setAttempts] = useState(0);
  const comboRef = useRef(0);
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const startRef = useRef(0);

  comboRef.current = state.combo;

  const loadWords = useCallback(async () => {
    setLoading(true);
    try {
      const data = await apiList.get<WordCard>('/words?pageSize=200');
      setWords(
        data.filter(
          (w) =>
            w.translation && w.headword && w.translation.trim().length > 0,
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
    if (words.length < PAIRS) return;
    setCards(generateCards(words));
    setFlippedIds([]);
    setAttempts(0);
    startRef.current = Date.now();
  }, [words]);

  const matchedCount = useMemo(
    () => cards.filter((c) => c.matched).length / 2,
    [cards],
  );

  // Check game over
  useEffect(() => {
    if (state.phase !== 'playing') return;
    if (matchedCount >= PAIRS) {
      if (timeoutRef.current) clearTimeout(timeoutRef.current);
      timeoutRef.current = setTimeout(() => endGame(), 800);
    }
    return () => {
      if (timeoutRef.current) clearTimeout(timeoutRef.current);
    };
  }, [matchedCount, state.phase, endGame]);

  const handleCardClick = useCallback(
    (cardId: number) => {
      const card = cards.find((c) => c.id === cardId);
      if (!card || card.flipped || card.matched) return;
      if (flippedIds.length >= 2) return;

      // Flip this card
      setCards((prev) =>
        prev.map((c) => (c.id === cardId ? { ...c, flipped: true } : c)),
      );
      const newFlipped = [...flippedIds, cardId];
      setFlippedIds(newFlipped);

      if (newFlipped.length === 2) {
        setAttempts((prev) => prev + 1);
        recordAttempt();

        const [id1, id2] = newFlipped;
        const card1 = cards.find((c) => c.id === id1);
        const card2 = cards.find((c) => c.id === id2);

        if (!card1 || !card2) return;

        const isMatch =
          card1.wordId === card2.wordId && card1.type !== card2.type;

        if (timeoutRef.current) clearTimeout(timeoutRef.current);

        if (isMatch) {
          // Match!
          timeoutRef.current = setTimeout(() => {
            setCards((prev) =>
              prev.map((c) =>
                c.id === id1 || c.id === id2
                  ? { ...c, matched: true }
                  : c,
              ),
            );
            setFlippedIds([]);
            addScore(POINTS_PER_MATCH);
            recordCorrect();
            const newCombo = comboRef.current + 1;
            setCombo(newCombo);
          }, 400);
        } else {
          // No match
          setCombo(0);
          timeoutRef.current = setTimeout(() => {
            setCards((prev) =>
              prev.map((c) =>
                c.id === id1 || c.id === id2
                  ? { ...c, flipped: false }
                  : c,
              ),
            );
            setFlippedIds([]);
          }, 1000);
        }
      }
    },
    [cards, flippedIds, addScore, recordCorrect, recordAttempt, setCombo],
  );

  useEffect(() => {
    return () => {
      if (timeoutRef.current) clearTimeout(timeoutRef.current);
    };
  }, []);

  if (loading) return <PageLoader message="正在加载词库…" />;
  if (words.length < PAIRS)
    return (
      <div className="flex flex-col items-center justify-center gap-3 py-20 text-slate-400">
        <span className="text-4xl">📚</span>
        <p className="text-sm">词库不足，需要至少 {PAIRS} 个单词</p>
      </div>
    );

  const accuracy =
    attempts > 0 ? Math.round((matchedCount / attempts) * 100) : 100;

  return (
    <div className="flex flex-col items-center gap-6">
      {/* Stats */}
      <div className="flex items-center gap-6">
        <div className="text-center">
          <p className="text-xs text-slate-500">匹配</p>
          <p className="text-lg font-bold text-primary-600">
            {matchedCount}/{PAIRS}
          </p>
        </div>
        <div className="text-center">
          <p className="text-xs text-slate-500">步数</p>
          <p className="text-lg font-bold text-slate-700">{attempts}</p>
        </div>
        <div className="text-center">
          <p className="text-xs text-slate-500">准确率</p>
          <p className="text-lg font-bold text-success-600">{accuracy}%</p>
        </div>
      </div>

      {/* Card grid */}
      <div className="grid grid-cols-4 gap-3">
        {cards.map((card) => {
          const isRevealed = card.flipped || card.matched;
          return (
            <button
              key={card.id}
              onClick={() => handleCardClick(card.id)}
              disabled={isRevealed}
              className={`flex h-24 w-20 items-center justify-center rounded-xl border-2 text-center transition-all duration-300 sm:h-28 sm:w-24 ${
                card.matched
                  ? 'border-success-400 bg-success-50 shadow-inner'
                  : isRevealed
                    ? 'border-primary-300 bg-white shadow-md'
                    : 'cursor-pointer border-slate-300 bg-gradient-to-br from-primary-600 to-primary-700 hover:border-primary-400 hover:from-primary-500 hover:to-primary-600 active:scale-95'
              }`}
            >
              {isRevealed ? (
                <span
                  className={`px-1 text-sm font-semibold ${
                    card.matched
                      ? 'text-success-700'
                      : 'text-slate-800'
                  }`}
                >
                  {card.display}
                </span>
              ) : (
                <span className="text-2xl text-white opacity-80">❓</span>
              )}
            </button>
          );
        })}
      </div>

      {matchedCount >= PAIRS ? (
        <div className="rounded-xl bg-success-50 p-4 text-center text-success-700">
          <p className="font-semibold">
            🎉 全部匹配完成！用时 {formatTime(state.elapsed)}
          </p>
        </div>
      ) : null}
    </div>
  );
}

export function Match4Game() {
  return (
    <GameShell
      gameCode="match4"
      gameName="配对挑战"
      description="翻开卡片，将英文单词与对应的中文释义配对。6 对卡片，看谁记得最牢！"
    >
      <Match4Inner />
    </GameShell>
  );
}
