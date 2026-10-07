import { useCallback, useEffect, useState } from 'react';
import type { FormEvent } from 'react';

import { PageLoader } from '../../components/common/PageLoader';
import { Badge } from '../../components/ui/Badge';
import { Button } from '../../components/ui/Button';
import { Card } from '../../components/ui/Card';
import { Input } from '../../components/ui/Input';
import { api } from '../../lib/api';
import type { SentenceItem } from '../../lib/types';

const FALLBACK_SENTENCES: SentenceItem[] = [
  { id: '1', sentence: 'The sun rises in the east.', translation: '太阳从东方升起。' },
  { id: '2', sentence: 'Practice makes perfect.', translation: '熟能生巧。' },
  { id: '3', sentence: 'Every day I learn a new word.', translation: '我每天学一个新单词。' },
];

type Feedback = { correct: boolean; expected: string; input: string } | null;

export function DictationPractice() {
  const [sentences, setSentences] = useState<SentenceItem[]>([]);
  const [index, setIndex] = useState(0);
  const [input, setInput] = useState('');
  const [feedback, setFeedback] = useState<Feedback>(null);
  const [results, setResults] = useState<boolean[]>([]);
  const [submitted, setSubmitted] = useState(false);

  useEffect(() => {
    api
      .get<SentenceItem[]>('/words/sentences')
      .then((res) => {
        if (res && res.length > 0) setSentences(res);
        else setSentences(FALLBACK_SENTENCES);
      })
      .catch(() => setSentences(FALLBACK_SENTENCES));
  }, []);

  const normalize = (s: string) =>
    s
      .toLowerCase()
      .replace(/[^a-z\s']/g, '')
      .replace(/\s+/g, ' ')
      .trim();

  const submit = useCallback(
    async (e: FormEvent) => {
      e.preventDefault();
      if (sentences.length === 0 || submitted) return;
      const item = sentences[index];
      if (!item) return;
      const inputNorm = normalize(input);
      const expectedNorm = normalize(item.sentence);
      const correct = inputNorm === expectedNorm;
      setFeedback({ correct, expected: item.sentence, input: inputNorm });
      setResults((prev) => {
        const next = [...prev];
        next[index] = correct;
        return next;
      });
      setSubmitted(true);

      try {
        await api.post('/learning/record', {
          kind: 'dictation',
          wordId: item.id,
          correct,
          input: inputNorm,
          expected: item.sentence,
        });
      } catch {
        // 静默
      }

      if (index + 1 < sentences.length) {
        setTimeout(() => {
          setIndex((i) => i + 1);
          setInput('');
          setFeedback(null);
          setSubmitted(false);
        }, 1500);
      }
    },
    [index, input, sentences, submitted],
  );

  if (sentences.length === 0) {
    return <PageLoader message="正在加载句子…" />;
  }

  const current = sentences[index];
  if (!current) return null;
  const finished = index >= sentences.length;

  if (finished) {
    const score = results.filter(Boolean).length;
    return (
      <div className="mx-auto max-w-2xl space-y-4">
        <Card className="p-8 text-center">
          <p className="text-5xl">🎉</p>
          <h2 className="mt-3 text-xl font-bold text-slate-900">听写完成</h2>
          <p className="mt-1 text-slate-500">
            答对 <span className="font-bold text-primary-700">{score}</span> / {sentences.length} 句
          </p>
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
        <h1 className="text-xl font-bold text-slate-900">句子听写 ✍️</h1>
        <Badge variant="default">
          {index + 1} / {sentences.length}
        </Badge>
      </div>

      <Card className="p-6">
        <div className="text-center">
          <p className="text-xs text-slate-500">请写出下面的英文句子</p>
          <p className="mt-2 text-xl font-semibold text-slate-900">{current.translation}</p>
        </div>

        <form onSubmit={submit} className="mt-6 space-y-4">
          <Input
            type="text"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            disabled={submitted}
            placeholder="输入英文句子"
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
                {feedback.correct ? '✅ 正确！' : '❌ 有差异，请对比'}
              </p>
              <p className="mt-1">
                你的答案：
                <span className="font-mono">{feedback.input || '(空)'}</span>
              </p>
              <p className="mt-1">
                参考答案：
                <span className="font-mono">{feedback.expected}</span>
              </p>
            </div>
          ) : null}

          <Button type="submit" loading={submitted} className="w-full">
            {submitted ? '提交中…' : '提交'}
          </Button>
        </form>
      </Card>

      <div className="flex justify-center gap-1">
        {sentences.map((_, i) => {
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
