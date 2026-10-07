import { useCallback, useEffect, useState } from 'react';
import type { FormEvent } from 'react';

import { PageLoader } from '../../components/common/PageLoader';
import { Badge } from '../../components/ui/Badge';
import { Button } from '../../components/ui/Button';
import { Card } from '../../components/ui/Card';
import { Input } from '../../components/ui/Input';
import { api } from '../../lib/api';
import type { WordCard } from '../../lib/types';

const FALLBACK_WORDS: WordCard[] = [
  { id: '1', headword: 'apple', phonetic: '/ˈæpəl/', translation: '苹果', definition: '一种常见的水果，红色或绿色。' },
  { id: '2', headword: 'banana', phonetic: '/bəˈnɑːnə/', translation: '香蕉', definition: '一种热带水果。' },
  { id: '3', headword: 'orange', phonetic: '/ˈɒrɪndʒ/', translation: '橘子', definition: '一种柑橘类水果。' },
  { id: '4', headword: 'grape', phonetic: '/ɡreɪp/', translation: '葡萄', definition: '一种藤本植物结出的浆果。' },
  { id: '5', headword: 'watermelon', phonetic: '/ˈwɔːtəmelən/', translation: '西瓜', definition: '一种大个头的水果。' },
];

type Feedback = { correct: boolean; expected: string; input: string } | null;

export function SpellingPractice() {
  const [words, setWords] = useState<WordCard[]>([]);
  const [index, setIndex] = useState(0);
  const [input, setInput] = useState('');
  const [feedback, setFeedback] = useState<Feedback>(null);
  const [results, setResults] = useState<boolean[]>([]);
  const [submitted, setSubmitted] = useState(false);

  useEffect(() => {
    api
      .get<WordCard[]>('/words')
      .then(setWords)
      .catch(() => setWords(FALLBACK_WORDS));
  }, []);

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

      try {
        await api.post('/learning/record', {
          kind: 'spell',
          wordId: word.id,
          correct,
          input: normalized,
          expected: word.headword,
        });
      } catch {
        // 静默
      }

      if (index + 1 < words.length) {
        setTimeout(() => {
          setIndex((i) => i + 1);
          setInput('');
          setFeedback(null);
          setSubmitted(false);
        }, 1200);
      }
    },
    [index, input, submitted, words],
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
    setTimeout(() => {
      if (index + 1 < words.length) {
        setIndex((i) => i + 1);
        setInput('');
        setFeedback(null);
        setSubmitted(false);
      }
    }, 1000);
  }, [index, words]);

  if (words.length === 0) {
    return <PageLoader message="正在加载词汇…" />;
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
