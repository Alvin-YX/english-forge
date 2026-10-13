import { useCallback, useEffect, useRef, useState } from 'react';
import type { FormEvent } from 'react';

import { PageLoader } from '../../components/common/PageLoader';
import { Button } from '../../components/ui/Button';
import { apiList } from '../../lib/api';
import type { WordCard } from '../../lib/types';

import { GameShell, useGameContext } from './GameShell';

const MAX_WRONG = 5;
const POINTS_PER_WORD = 15;
const WRONG_PENALTY = 5;

function SpellTruckInner() {
  const { state, endGame, addScore, setCombo, recordCorrect, recordWrong } =
    useGameContext();
  const [words, setWords] = useState<WordCard[]>([]);
  const [loading, setLoading] = useState(true);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [input, setInput] = useState('');
  const [wrongCount, setWrongCount] = useState(0);
  const [feedback, setFeedback] = useState<
    'idle' | 'correct' | 'wrong'
  >('idle');
  const [loadedWords, setLoadedWords] = useState<WordCard[]>([]);
  const inputRef = useRef<HTMLInputElement>(null);
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const comboRef = useRef(0);

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

  const currentWord = words[currentIndex];

  useEffect(() => {
    if (currentWord) {
      inputRef.current?.focus();
    }
  }, [currentWord]);

  const handleSubmit = useCallback(
    (e: FormEvent) => {
      e.preventDefault();
      if (!currentWord || feedback !== 'idle') return;

      const answer = input.trim().toLowerCase();
      const correct = currentWord.headword.toLowerCase();

      if (answer === correct) {
        // Correct!
        addScore(POINTS_PER_WORD);
        recordCorrect();
        const newCombo = comboRef.current + 1;
        setCombo(newCombo);
        setFeedback('correct');
        setLoadedWords((prev) => [...prev, currentWord]);
        setInput('');

        if (timeoutRef.current) clearTimeout(timeoutRef.current);
        timeoutRef.current = setTimeout(() => {
          setFeedback('idle');
          setCurrentIndex((prev) => prev + 1);
        }, 800);
      } else {
        // Wrong!
        addScore(-WRONG_PENALTY);
        recordWrong(Number(currentWord.id));
        setCombo(0);
        setFeedback('wrong');
        const newWrong = wrongCount + 1;
        setWrongCount(newWrong);
        setInput('');

        if (newWrong >= MAX_WRONG) {
          if (timeoutRef.current) clearTimeout(timeoutRef.current);
          timeoutRef.current = setTimeout(() => {
            endGame();
          }, 1000);
        } else {
          if (timeoutRef.current) clearTimeout(timeoutRef.current);
          timeoutRef.current = setTimeout(() => {
            setFeedback('idle');
            setCurrentIndex((prev) => prev + 1);
          }, 1200);
        }
      }
    },
    [
      currentWord,
      feedback,
      wrongCount,
      addScore,
      recordCorrect,
      recordWrong,
      setCombo,
      endGame,
    ],
  );

  useEffect(() => {
    return () => {
      if (timeoutRef.current) clearTimeout(timeoutRef.current);
    };
  }, []);

  if (loading) return <PageLoader message="正在加载词库…" />;
  if (words.length === 0)
    return (
      <div className="flex flex-col items-center justify-center gap-3 py-20 text-slate-400">
        <span className="text-4xl">📚</span>
        <p className="text-sm">词库为空，请先添加单词</p>
      </div>
    );

  const livesLeft = MAX_WRONG - wrongCount;

  return (
    <div className="flex flex-col gap-6">
      {/* Truck visual */}
      <div className="relative h-32 overflow-hidden rounded-xl bg-gradient-to-r from-sky-100 to-blue-100">
        {/* Road */}
        <div className="absolute bottom-0 left-0 right-0 h-1 bg-slate-400" />
        {/* Truck */}
        <div className="absolute bottom-4 left-1/2 -translate-x-1/2">
          <div className="relative">
            {/* Truck bed */}
            <div className="flex h-16 w-48 items-center justify-end gap-1 overflow-hidden rounded-lg bg-amber-600 p-2 shadow-lg">
              {loadedWords.slice(-8).map((w, i) => (
                <div
                  key={i}
                  className="flex h-10 w-10 shrink-0 items-center justify-center rounded bg-white text-xs font-bold text-amber-800 shadow"
                >
                  {w.headword}
                </div>
              ))}
            </div>
            {/* Truck cab */}
            <div className="flex h-10 w-12 items-center justify-center rounded-lg bg-amber-500">
              <div className="h-5 w-5 rounded bg-sky-200" />
            </div>
            {/* Wheels */}
            <div className="flex justify-between">
              <div className="ml-8 h-5 w-5 rounded-full bg-slate-800 border-4 border-slate-600" />
              <div className="mr-2 h-5 w-5 rounded-full bg-slate-800 border-4 border-slate-600" />
            </div>
          </div>
        </div>
        {/* Word count */}
        <div className="absolute top-2 right-3 rounded-full bg-white/80 px-3 py-1 text-xs font-medium text-slate-600 backdrop-blur">
          已装载 {loadedWords.length} 个单词
        </div>
      </div>

      {/* Question area */}
      <div className="flex flex-col items-center gap-4">
        {/* Chinese translation */}
        <div
          className={`rounded-xl border-2 bg-white p-6 text-center shadow-sm transition-colors ${
            feedback === 'correct'
              ? 'border-success-400 bg-success-50'
              : feedback === 'wrong'
                ? 'border-danger-400 bg-danger-50'
                : 'border-slate-200'
          }`}
        >
          <p className="text-sm text-slate-500">请拼写以下单词的英文：</p>
          <p className="mt-2 text-2xl font-bold text-slate-800">
            {currentWord?.translation}
          </p>
          {feedback === 'correct' ? (
            <p className="mt-2 text-success-600 font-semibold">
              ✓ 正确！+{POINTS_PER_WORD} 分
            </p>
          ) : feedback === 'wrong' ? (
            <p className="mt-2 text-danger-600 font-semibold">
              ✗ 正确答案：<span className="text-xl">{currentWord?.headword}</span>
            </p>
          ) : null}
        </div>

        {/* Input */}
        <form onSubmit={handleSubmit} className="flex w-full max-w-md gap-2">
          <input
            ref={inputRef}
            type="text"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder="输入英文单词后按回车…"
            disabled={feedback !== 'idle' || !currentWord}
            className="h-12 flex-1 rounded-xl border-2 border-slate-300 bg-white px-4 text-lg text-slate-900 placeholder:text-slate-400 focus:border-primary-500 focus:outline-none focus:ring-2 focus:ring-primary-200"
            autoComplete="off"
            autoCapitalize="off"
            spellCheck={false}
          />
          <Button
            type="submit"
            size="lg"
            disabled={feedback !== 'idle' || !input.trim() || !currentWord}
          >
            提交
          </Button>
        </form>

        {/* Lives */}
        <div className="flex items-center gap-2">
          <span className="text-sm text-slate-500">剩余机会：</span>
          <div className="flex gap-1">
            {Array.from({ length: MAX_WRONG }).map((_, i) => (
              <span
                key={i}
                className={`text-xl ${
                  i < livesLeft ? '' : 'opacity-30 grayscale'
                }`}
              >
                ❤️
              </span>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

export function SpellTruckGame() {
  return (
    <GameShell
      gameCode="spell_truck"
      gameName="拼写卡车"
      description="看到中文释义，拼写出正确的英文单词。每拼对一个单词，卡车就装载一个！5 次错误游戏结束。"
    >
      <SpellTruckInner />
    </GameShell>
  );
}
