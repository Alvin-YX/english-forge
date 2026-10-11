import { useCallback, useMemo, useState } from 'react';
import type { FormEvent } from 'react';

import { PageLoader } from '../../components/common/PageLoader';
import { StateView } from '../../components/common/StateView';
import { Badge } from '../../components/ui/Badge';
import { Button } from '../../components/ui/Button';
import { Card } from '../../components/ui/Card';
import { Input } from '../../components/ui/Input';
import { useResource } from '../../hooks/useResource';
import { api } from '../../lib/api';
import type { WordCard } from '../../lib/types';

type Feedback = { correct: boolean; expected: string; input: string } | null;

export function SpellingPractice() {
  const { data, loading, error, reload } = useResource<WordCard[]>(
    async () => api.get<WordCard[]>('/words'),
  );
  const [index, setIndex] = useState(0);
  const [input, setInput] = useState('');
  const [feedback, setFeedback] = useState<Feedback>(null);
  const [results, setResults] = useState<boolean[]>([]);
  const [submitted, setSubmitted] = useState(false);
  const [recordError, setRecordError] = useState<string | null>(null);

  const words = useMemo(() => data ?? [], [data]);

  const recordResult = useCallback(
    async (word: WordCard, correct: boolean, inputNorm: string) => {
      setRecordError(null);
      try {
        await api.post('/learning/record', {
          kind: 'spell',
          wordId: word.id,
          correct,
          input: inputNorm,
          expected: word.headword,
        });
      } catch (err) {
        setRecordError(
          err instanceof Error ? err.message : '学习记录上报失败',
        );
      }
    },
    [],
  );

  const submit = useCallback(
    async (e: FormEvent) => {
      e.preventDefault();
      if (words.length === 0 || submitted) return;
      const word = words[index];
      if (!word) return;
      const normalized = input.trim().toLowerCase();
      const correct = normalized === word.headword.toLowerCase();
      setFeedback({ correct, expected: word.headword, input: normalized });
      setResults((prev) => {
        const next = [...prev];
        next[index] = correct;
        return next;
      });
      setSubmitted(true);
      void recordResult(word, correct, normalized);

      if (index + 1 < words.length) {
        setTimeout(() => {
          setIndex((i) => i + 1);
          setInput('');
          setFeedback(null);
          setSubmitted(false);
        }, 1200);
      }
    },
    [index, input, submitted, words, recordResult],
  );

  const skip = useCallback(() => {
    if (words.length === 0) return;
    const word = words[index];
    if (!word) return;
    setFeedback({ correct: false, expected: word.headword, input: '—' });
    setResults((prev) => {
      const next = [...prev];
      next[index] = false;
      return next;
    });
    setSubmitted(true);
    void recordResult(word, false, '—');
    setTimeout(() => {
      if (index + 1 < words.length) {
        setIndex((i) => i + 1);
        setInput('');
        setFeedback(null);
        setSubmitted(false);
      }
    }, 1000);
  }, [index, words, recordResult]);

  if (loading) return <PageLoader message="正在加载词汇…" />;

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

  if (words.length === 0) {
    return (
      <Card>
        <StateView
          icon="📭"
          tone="muted"
          title="词库还是空的"
          message="请先导入词库数据（例如运行 scripts/import-ecdict.mjs），否则没有词可拼。"
          onRetry={reload}
          retryLabel="重新检查"
        />
      </Card>
    );
  }

  const current = words[index];
  if (!current) return null;
  const finished = index >= words.length;

  if (finished) {
    const score = results.filter(Boolean).length;
    return (
      <div className="mx-auto max-w-2xl space-y-4">
        <Card className="p-8 text-center">
          <p className="text-5xl">{score === words.length ? '🏆' : '🎉'}</p>
          <h2 className="mt-3 text-xl font-bold text-slate-900">拼写练习完成</h2>
          <p className="mt-1 text-slate-500">
            答对 <span className="font-bold text-primary-700">{score}</span> / {words.length} 个词
          </p>
          <div className="mt-4 flex justify-center gap-2">
            {results.map((r, i) => (
              <span
                key={i}
                className={`flex h-8 w-8 items-center justify-center rounded-full text-sm font-bold ${
                  r ? 'bg-success-100 text-success-700' : 'bg-danger-100 text-danger-700'
                }`}
              >
                {r ? '✓' : '✗'}
              </span>
            ))}
          </div>
          <Button className="mt-5" onClick={() => { setIndex(0); setResults([]); setInput(''); }}>
            再来一轮
          </Button>
        </Card>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-2xl space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-bold text-slate-900">单词拼写 ⌨️</h1>
        <Badge variant="default">
          {Math.min(index + 1, words.length)} / {words.length}
        </Badge>
      </div>

      <Card className="p-6">
        <div className="text-center">
          <p className="text-xs text-slate-500">请拼写下面的单词</p>
          <p className="mt-2 text-3xl font-bold text-slate-900">{current.translation}</p>
          <p className="mt-2 text-sm text-slate-500">{current.phonetic}</p>
        </div>

        <form onSubmit={submit} className="mt-6 space-y-4">
          <Input
            type="text"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            disabled={submitted}
            placeholder="输入英文单词"
            autoFocus
            required
          />

          {feedback ? (
            <div
              className={`rounded-lg p-3 text-sm ${
                feedback.correct ? 'bg-success-50 text-success-700' : 'bg-danger-50 text-danger-700'
              }`}
            >
              <p className="font-semibold">
                {feedback.correct ? '✅ 正确！' : '❌ 再想想'}
              </p>
              <p className="mt-1">
                你的输入：<code className="font-mono">{feedback.input || '(空)'}</code> · 正确答案：
                <code className="font-mono">{feedback.expected}</code>
              </p>
            </div>
          ) : null}

          {recordError ? (
            <div className="rounded-lg border border-warning-200 bg-warning-50 p-3 text-sm text-warning-700">
              <span className="font-semibold">⚠️ 判分已完成，但学习记录上报失败：</span>
              {recordError}
            </div>
          ) : null}

          <div className="flex gap-2">
            <Button type="submit" loading={submitted} className="flex-1">
              {submitted ? '提交中…' : '提交'}
            </Button>
            <Button type="button" variant="outline" onClick={skip} disabled={submitted}>
              跳过
            </Button>
          </div>
        </form>
      </Card>

      <div className="flex justify-center gap-1">
        {words.map((_, i) => {
          const r = results[i];
          return (
            <span
              key={i}
              className={`h-2 w-2 rounded-full ${
                r === true ? 'bg-success-500' : r === false ? 'bg-danger-500' : i === index ? 'bg-primary-600' : 'bg-slate-300'
              }`}
            />
          );
        })}
      </div>
    </div>
  );
}
