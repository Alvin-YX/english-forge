import { useCallback, useEffect, useState } from 'react';

import { api } from '../../lib/api';
import type { WordCard } from '../../lib/types';
import { Badge } from '../../components/ui/Badge';
import { Button } from '../../components/ui/Button';
import { Card } from '../../components/ui/Card';
import { PageLoader } from '../../components/common/PageLoader';

const FALLBACK_WORDS: WordCard[] = [
  { id: '1', headword: 'apple', phonetic: '/ˈæpəl/', translation: '苹果', definition: '一种常见的水果，红色或绿色，圆形。' },
  { id: '2', headword: 'banana', phonetic: '/bəˈnɑːnə/', translation: '香蕉', definition: '一种热带水果，外皮黄色，果肉白色。' },
  { id: '3', headword: 'orange', phonetic: '/ˈɒrɪndʒ/', translation: '橘子；橙色', definition: '一种柑橘类水果，外皮橙色。' },
  { id: '4', headword: 'grape', phonetic: '/ɡreɪp/', translation: '葡萄', definition: '一种藤本植物结出的浆果，可鲜食或酿酒。' },
  { id: '5', headword: 'watermelon', phonetic: '/ˈwɔːtəmelən/', translation: '西瓜', definition: '一种大个头的水果，外皮绿色，果肉红色。' },
];

export function WordCardPractice() {
  const [cards, setCards] = useState<WordCard[]>([]);
  const [index, setIndex] = useState(0);
  const [flipped, setFlipped] = useState(false);
  const [completed, setCompleted] = useState(false);

  useEffect(() => {
    api
      .get<WordCard[]>('/words')
      .then(setCards)
      .catch(() => setCards(FALLBACK_WORDS));
  }, []);

  const go = useCallback(
    (delta: number) => {
      if (cards.length === 0) return;
      setFlipped(false);
      setIndex((i) => {
        const next = (i + delta + cards.length) % cards.length;
        return next;
      });
    },
    [cards.length],
  );

  const handleComplete = async () => {
    try {
      await api.post('/learning/mastery', { wordIds: cards.map((c) => c.id), result: 'complete' });
    } catch {
      // 静默失败
    }
    setCompleted(true);
  };

  if (cards.length === 0) {
    return <PageLoader message="正在加载词卡…" />;
  }

  const current = cards[index];
  if (!current) return null;

  return (
    <div className="mx-auto max-w-2xl space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-bold text-slate-900">词卡复习 🃏</h1>
        <Badge variant="default">
          {index + 1} / {cards.length}
        </Badge>
      </div>

      {completed ? (
        <Card className="p-8 text-center">
          <p className="text-5xl">🎉</p>
          <h2 className="mt-3 text-xl font-bold text-slate-900">本轮完成！</h2>
          <p className="mt-1 text-slate-500">已完成 {cards.length} 张词卡</p>
          <Button className="mt-4" onClick={() => { setCompleted(false); setIndex(0); }}>
            再来一轮
          </Button>
        </Card>
      ) : (
        <>
          <div
            className="relative h-80 cursor-pointer select-none [perspective:1200px]"
            onClick={() => setFlipped((v) => !v)}
          >
            <div
              className={`relative h-full w-full transition-transform duration-500 [transform-style:preserve-3d] ${
                flipped ? '[transform:rotateY(180deg)]' : ''
              }`}
            >
              {/* 正面 */}
              <div className="absolute inset-0 flex flex-col items-center justify-center rounded-2xl bg-gradient-to-br from-primary-600 to-primary-700 p-6 text-white shadow-lg [backface-visibility:hidden]">
                <p className="text-4xl font-bold tracking-wide">{current.headword}</p>
                <p className="mt-2 text-lg text-primary-100">{current.phonetic}</p>
                <p className="mt-6 text-sm text-primary-200">点击翻面</p>
              </div>

              {/* 背面 */}
              <div className="absolute inset-0 flex flex-col items-center justify-center rounded-2xl border-2 border-primary-200 bg-white p-6 shadow-lg [backface-visibility:hidden] [transform:rotateY(180deg)]">
                <p className="text-2xl font-bold text-slate-900">{current.translation}</p>
                <p className="mt-2 text-sm text-slate-500">{current.definition}</p>
                {current.example ? (
                  <p className="mt-4 text-sm italic text-slate-600">"…{current.example}…"</p>
                ) : null}
              </div>
            </div>
          </div>

          <div className="flex items-center justify-between gap-2">
            <Button variant="outline" onClick={() => go(-1)}>
              上一张
            </Button>
            <Button variant="ghost" onClick={() => setFlipped((v) => !v)}>
              翻面
            </Button>
            <Button variant="secondary" onClick={() => go(1)}>
              下一张
            </Button>
          </div>

          <div className="flex justify-center gap-1">
            {cards.map((_, i) => (
              <span
                key={i}
                className={`h-2 w-2 rounded-full ${i === index ? 'bg-primary-600' : 'bg-slate-300'}`}
              />
            ))}
          </div>

          <Button className="w-full" onClick={handleComplete}>
            完成本轮
          </Button>
        </>
      )}
    </div>
  );
}
