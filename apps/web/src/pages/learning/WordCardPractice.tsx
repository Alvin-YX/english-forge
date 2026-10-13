import { useCallback, useState } from 'react';

import { PageLoader } from '../../components/common/PageLoader';
import { StateView } from '../../components/common/StateView';
import { Badge } from '../../components/ui/Badge';
import { Button } from '../../components/ui/Button';
import { Card } from '../../components/ui/Card';
import { useResource } from '../../hooks/useResource';
import { api, apiList } from '../../lib/api';
import type { WordCard } from '../../lib/types';

export function WordCardPractice() {
  const { data, loading, error, reload } = useResource<WordCard[]>(
    async () => apiList.get<WordCard>('/words'),
  );
  const [index, setIndex] = useState(0);
  const [flipped, setFlipped] = useState(false);
  const [completed, setCompleted] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  const cards = data ?? [];

  const go = useCallback(
    (delta: number) => {
      if (cards.length === 0) return;
      setFlipped(false);
      setIndex((i) => (i + delta + cards.length) % cards.length);
    },
    [cards.length],
  );

  const handleComplete = async () => {
    setSaveError(null);
    try {
      await api.post('/learning/mastery', {
        wordIds: cards.map((c) => c.id),
        result: 'complete',
      });
      setCompleted(true);
    } catch (err) {
      // 不再静默：掌握度上报失败就明说，不能让用户以为已记账
      setSaveError(
        err instanceof Error ? err.message : '学习记录保存失败，请重试',
      );
    }
  };

  if (loading) return <PageLoader message="正在加载词卡…" />;

  if (error) {
    return (
      <Card>
        <StateView
          title="词库服务暂不可用"
          message={error}
          onRetry={reload}
        />
      </Card>
    );
  }

  if (cards.length === 0) {
    return (
      <Card>
        <StateView
          icon="📭"
          tone="muted"
          title="词库还是空的"
          message="请先导入词库数据（例如运行 scripts/import-ecdict.mjs），否则没有词可复习。"
          onRetry={reload}
          retryLabel="重新检查"
        />
      </Card>
    );
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
          {saveError ? (
            <div className="rounded-lg border border-danger-200 bg-danger-50 p-3 text-sm text-danger-700">
              <p className="font-semibold">⚠️ 学习记录保存失败</p>
              <p className="mt-1">
                {saveError}
                —— 本轮已学完 {cards.length} 张词卡，但掌握度没有上报到服务端。
              </p>
            </div>
          ) : null}

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
                  <p className="mt-4 text-sm italic text-slate-600">&quot;…{current.example}…&quot;</p>
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
