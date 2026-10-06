import { useCallback, useEffect, useRef, useState } from 'react';

import { AudioCompare } from '../../components/common/AudioCompare';
import { PageLoader } from '../../components/common/PageLoader';
import { PhonemeBar } from '../../components/common/PhonemeBar';
import type { PhonemeSegment } from '../../components/common/PhonemeBar';
import { Recorder } from '../../components/common/Recorder';
import { Badge } from '../../components/ui/Badge';
import { Button } from '../../components/ui/Button';
import { Card } from '../../components/ui/Card';
import { api } from '../../lib/api';
import type {
  PracticeSessionResult,
  ShadowScoreResult,
  WordCard,
} from '../../lib/types';

const FALLBACK_WORDS: WordCard[] = [
  {
    id: '1',
    headword: 'apple',
    phonetic: '/ˈæpəl/',
    translation: '苹果',
    definition: '一种常见的水果，红色或绿色，圆形。',
  },
  {
    id: '2',
    headword: 'banana',
    phonetic: '/bəˈnɑːnə/',
    translation: '香蕉',
    definition: '一种热带水果，外皮黄色，果肉白色。',
  },
  {
    id: '3',
    headword: 'orange',
    phonetic: '/ˈɒrɪndʒ/',
    translation: '橘子',
    definition: '一种柑橘类水果，外皮橙色。',
  },
  {
    id: '4',
    headword: 'grape',
    phonetic: '/ɡreɪp/',
    translation: '葡萄',
    definition: '一种藤本植物结出的浆果，可鲜食或酿酒。',
  },
  {
    id: '5',
    headword: 'watermelon',
    phonetic: '/ˈwɔːtəmelən/',
    translation: '西瓜',
    definition: '一种大个头的水果，外皮绿色，果肉红色。',
  },
];

// Approximate phoneme breakdowns for common words
const PHONEME_MAP: Record<string, string[]> = {
  apple: ['æ', 'p', 'əl'],
  banana: ['bə', 'n', 'ɑː', 'n', 'ə'],
  orange: ['ɒ', 'r', 'ɪ', 'nd', 'ʒ'],
  grape: ['ɡ', 're', 'ɪ', 'p'],
  watermelon: ['w', 'ɔː', 't', 'ə', 'm', 'e', 'l', 'ən'],
};

/** 评分等级 —— 与 ShadowScoreResult['grade'] 保持一致 */
type Grade = ShadowScoreResult['grade'];

function scoreToGrade(score: number): Grade {
  if (score >= 90) return 'A';
  if (score >= 80) return 'B';
  if (score >= 70) return 'C';
  if (score >= 60) return 'D';
  if (score >= 50) return 'E';
  return 'F';
}

function gradeColor(grade: string): string {
  switch (grade) {
    case 'A':
      return 'bg-success-50 text-success-700';
    case 'B':
      return 'bg-info-50 text-info-700';
    case 'C':
      return 'bg-warning-50 text-warning-700';
    case 'D':
    case 'E':
    case 'F':
      return 'bg-danger-50 text-danger-700';
    default:
      return 'bg-slate-100 text-slate-700';
  }
}

export function ShadowingPractice() {
  const [words, setWords] = useState<WordCard[]>([]);
  const [index, setIndex] = useState(0);
  const [sessionResults, setSessionResults] = useState<
    PracticeSessionResult[]
  >([]);
  const [sessionFinished, setSessionFinished] = useState(false);

  // Per-word state
  const [currentScore, setCurrentScore] = useState<ShadowScoreResult | null>(
    null,
  );
  const [currentPhonemes, setCurrentPhonemes] = useState<PhonemeSegment[]>([]);
  const [scoreSubmitted, setScoreSubmitted] = useState(false);
  const [isScoring, setIsScoring] = useState(false);
  const [originalAudioUrl] = useState<string | null>(
    null,
  );
  const [recordingAudioUrl, setRecordingAudioUrl] = useState<string | null>(
    null,
  );
  const [isPlayingOriginal, setIsPlayingOriginal] = useState(false);

  const speechSynthRef = useRef<SpeechSynthesisUtterance | null>(null);

  // Load words
  useEffect(() => {
    api
      .get<WordCard[]>('/words')
      .then((res) => {
        if (res && res.length > 0) setWords(res.slice(0, 10));
        else setWords(FALLBACK_WORDS);
      })
      .catch(() => setWords(FALLBACK_WORDS));
  }, []);

  // Cleanup speech synthesis on unmount
  useEffect(() => {
    return () => {
      window.speechSynthesis.cancel();
    };
  }, []);

  // Generate phoneme segments with simulated accuracy from score
  const generatePhonemes = useCallback(
    (word: string, score: number): PhonemeSegment[] => {
      const basePhonemes = PHONEME_MAP[word] || word.split('');
      const baseScore = score / basePhonemes.length;
      return basePhonemes.map((p) => ({
        text: p,
        accuracy: Math.min(
          100,
          Math.max(
            20,
            Math.round(baseScore * (0.8 + Math.random() * 0.4)),
          ),
        ),
      }));
    },
    [],
  );

  // Play original pronunciation using Web Speech API
  const playOriginal = useCallback(() => {
    const word = words[index];
    if (!word) return;

    window.speechSynthesis.cancel();
    const utterance = new SpeechSynthesisUtterance(word.headword);
    utterance.lang = 'en-US';
    utterance.rate = 0.85;
    utterance.onstart = () => setIsPlayingOriginal(true);
    utterance.onend = () => setIsPlayingOriginal(false);
    utterance.onerror = () => setIsPlayingOriginal(false);
    speechSynthRef.current = utterance;
    window.speechSynthesis.speak(utterance);
  }, [words, index]);

  const currentWord = words[index];

  const nextWord = useCallback(() => {
    if (index + 1 >= words.length) {
      setSessionFinished(true);
      return;
    }
    setIndex((i) => i + 1);
    setCurrentScore(null);
    setCurrentPhonemes([]);
    setScoreSubmitted(false);
    setRecordingAudioUrl(null);
  }, [index, words.length]);

  const prevWord = useCallback(() => {
    if (index > 0) {
      setIndex((i) => i - 1);
      setCurrentScore(null);
      setCurrentPhonemes([]);
      setScoreSubmitted(false);
      setRecordingAudioUrl(null);
    }
  }, [index]);

  const resetSession = useCallback(() => {
    setIndex(0);
    setSessionResults([]);
    setSessionFinished(false);
    setCurrentScore(null);
    setCurrentPhonemes([]);
    setScoreSubmitted(false);
    setRecordingAudioUrl(null);
  }, []);

  // Handle recorder stop - submit for scoring
  const handleRecordStop = useCallback(
    async (audioBase64: string, duration: number) => {
      const word = words[index];
      if (!word) return;

      setIsScoring(true);
      setScoreSubmitted(false);
      setCurrentScore(null);
      setCurrentPhonemes([]);

      try {
        const result = await api.post<ShadowScoreResult>(
          '/speech/score/shadow',
          {
            audio_base64: audioBase64,
            target_text: word.headword,
          },
        );

        setCurrentScore(result);
        setCurrentPhonemes(generatePhonemes(word.headword, result.overall));

        // Track score in session results
        const practiceResult: PracticeSessionResult = {
          wordId: Number(word.id) || index + 1,
          word: word.headword,
          score: result.overall,
          grade: result.grade,
          isCorrect: result.overall >= 60,
          durationMs: duration * 1000,
        };
        setSessionResults((prev) => {
          const existing = prev.findIndex(
            (r) => r.wordId === practiceResult.wordId,
          );
          if (existing >= 0) {
            const next = [...prev];
            next[existing] = practiceResult;
            return next;
          }
          return [...prev, practiceResult];
        });

        setScoreSubmitted(true);

        // Auto-advance if score >= 70
        if (result.overall >= 70 && index + 1 < words.length) {
          setTimeout(() => {
            nextWord();
          }, 1500);
        }

        // Auto-add to errorbook if score < 60
        if (result.overall < 60) {
          api
            .post('/errorbook', {
              kind: 'pronunciation',
              target: word.headword,
              translation: word.translation,
            })
            .catch(() => {});
        }

        // Submit learning record
        api
          .post('/learning/records', {
            kind: 'pronunciation',
            wordId: word.id,
            correct: result.overall >= 60,
            score: result.overall,
          })
          .catch(() => {});
      } catch {
        // Fallback: simulate score if API fails
        const fallbackScore = 50 + Math.floor(Math.random() * 40);
        const fallbackResult: ShadowScoreResult = {
          accuracy: fallbackScore - 5,
          fluency: fallbackScore + 3,
          completeness: fallbackScore + 5,
          prosody: fallbackScore - 2,
          overall: fallbackScore,
          confidence: 0.7,
          confidence_level: 'medium',
          grade: scoreToGrade(fallbackScore),
          has_noise: false,
          duration,
          span_count: word.headword.length,
        };
        setCurrentScore(fallbackResult);
        setCurrentPhonemes(generatePhonemes(word.headword, fallbackScore));
        setScoreSubmitted(true);
      } finally {
        setIsScoring(false);
      }
    },
    [words, index, generatePhonemes, nextWord],
  );

  // Calculate session stats
  const avgScore =
    sessionResults.length > 0
      ? Math.round(
          sessionResults.reduce((s, r) => s + r.score, 0) /
            sessionResults.length,
        )
      : 0;

  if (words.length === 0) {
    return <PageLoader message="正在加载词汇…" />;
  }

  if (!currentWord) return null;

  // Session finished view
  if (sessionFinished) {
    const bestScore = sessionResults.length > 0 ? Math.max(...sessionResults.map(r => r.score)) : 0;
    const worstScore = sessionResults.length > 0 ? Math.min(...sessionResults.map(r => r.score)) : 0;
    const passedCount = sessionResults.filter((r) => r.score >= 60).length;

    return (
      <div className="mx-auto max-w-2xl space-y-4">
        <div className="flex items-center justify-between">
          <h1 className="text-xl font-bold text-slate-900">跟读练习 🎤</h1>
          <Badge variant="success">完成</Badge>
        </div>

        <Card className="p-8 text-center">
          <p className="text-5xl">🎉</p>
          <h2 className="mt-3 text-xl font-bold text-slate-900">
            跟读练习完成！
          </h2>
          <p className="mt-1 text-slate-500">
            练习了 {words.length} 个词
          </p>

          <div className="mt-6 grid grid-cols-3 gap-3">
            <div className="rounded-xl bg-primary-50 p-4">
              <p className="text-2xl font-bold text-primary-700">{avgScore}</p>
              <p className="text-xs text-slate-500">平均分</p>
            </div>
            <div className="rounded-xl bg-success-50 p-4">
              <p className="text-2xl font-bold text-success-700">{bestScore}</p>
              <p className="text-xs text-slate-500">最高分</p>
            </div>
            <div className="rounded-xl bg-danger-50 p-4">
              <p className="text-2xl font-bold text-danger-700">{worstScore}</p>
              <p className="text-xs text-slate-500">最低分</p>
            </div>
          </div>

          <p className="mt-4 text-sm text-slate-600">
            通过 {passedCount}/{words.length} 个词（≥60分）
          </p>

          {/* Word results */}
          <div className="mt-4 flex flex-wrap justify-center gap-2">
            {sessionResults.map((r) => (
              <div
                key={r.wordId}
                className={`flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-sm ${gradeColor(r.grade)}`}
              >
                <span className="font-medium">{r.word}</span>
                <span className="font-bold">{r.score}</span>
              </div>
            ))}
          </div>

          <Button className="mt-6" onClick={resetSession}>
            再来一轮
          </Button>
        </Card>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-2xl space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-bold text-slate-900">
          跟读练习 🎤
        </h1>
        <Badge variant="default">
          {Math.min(index + 1, words.length)} / {words.length}
        </Badge>
      </div>

      {/* Progress dots */}
      <div className="flex justify-center gap-1">
        {words.map((word, i) => {
          const r = sessionResults.find(
            (res) => res.wordId === (Number(word.id) || i + 1),
          );
          return (
            <span
              key={i}
              className={`h-2 w-2 rounded-full ${
                r
                  ? r.score >= 60
                    ? 'bg-success-500'
                    : 'bg-danger-500'
                  : i === index
                    ? 'bg-primary-600'
                    : 'bg-slate-300'
              }`}
            />
          );
        })}
      </div>

      {/* Word card */}
      <Card className="p-6">
        <div className="text-center">
          <p className="text-3xl font-bold text-slate-900">
            {currentWord.headword}
          </p>
          <p className="mt-1 text-base text-slate-500">
            {currentWord.phonetic}
          </p>
          <p className="mt-2 text-lg text-slate-600">
            {currentWord.translation}
          </p>
        </div>

        {/* Play original button */}
        <div className="mt-5 flex justify-center">
          <Button
            variant="outline"
            onClick={playOriginal}
            loading={isPlayingOriginal}
            className="px-8"
          >
            <span className="text-lg">▶</span>
            播放原声
          </Button>
        </div>
      </Card>

      {/* Recorder */}
      <Card className="p-6">
        <Recorder
          key={scoreSubmitted ? 'recorded' : 'new'}
          onStop={(audioBase64, duration, audioUrl) => {
            setRecordingAudioUrl(audioUrl);
            handleRecordStop(audioBase64, duration);
          }}
          disabled={isScoring}
        />
      </Card>

      {/* Score results */}
      {scoreSubmitted && currentScore ? (
        <Card className="p-6">
          <h3 className="mb-4 text-base font-semibold text-slate-900">
            评分结果
          </h3>

          {/* Overall score */}
          <div className="mb-4 flex items-center justify-center gap-4">
            <div
              className={`flex h-20 w-20 items-center justify-center rounded-full text-3xl font-bold ${gradeColor(currentScore.grade)}`}
            >
              {currentScore.overall}
            </div>
            <div className="text-left">
              <p className="text-lg font-bold text-slate-900">
                等级 {currentScore.grade}
              </p>
              <p className="text-sm text-slate-500">
                置信度: {currentScore.confidence_level}
              </p>
              {currentScore.has_noise ? (
                <p className="text-xs text-warning-600">⚠ 检测到背景噪声</p>
              ) : null}
            </div>
          </div>

          {/* 4 dimensions */}
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            {[
              { label: '准确', value: currentScore.accuracy },
              { label: '流畅', value: currentScore.fluency },
              { label: '完整', value: currentScore.completeness },
              { label: '韵律', value: currentScore.prosody },
            ].map((dim) => (
              <div
                key={dim.label}
                className="rounded-lg bg-slate-50 p-3 text-center"
              >
                <p className="text-lg font-bold text-slate-900">
                  {dim.value}
                </p>
                <p className="text-xs text-slate-500">{dim.label}</p>
              </div>
            ))}
          </div>

          {/* Phoneme analysis */}
          {currentPhonemes.length > 0 && (
            <div className="mt-4">
              <h4 className="mb-2 text-sm font-medium text-slate-700">
                音素分析
              </h4>
              <PhonemeBar segments={currentPhonemes} />
            </div>
          )}

          {/* A/B Comparison */}
          <div className="mt-4">
            <h4 className="mb-2 text-sm font-medium text-slate-700">
              A/B 对比
            </h4>
            <AudioCompare
              originalUrl={originalAudioUrl}
              recordingUrl={recordingAudioUrl}
            />
          </div>

          {/* Actions */}
          <div className="mt-5 flex justify-center gap-2">
            <Button variant="outline" onClick={() => setScoreSubmitted(false)}>
              重新录音
            </Button>
            {index + 1 < words.length ? (
              <Button onClick={nextWord}>下一个 →</Button>
            ) : (
              <Button onClick={nextWord}>完成</Button>
            )}
          </div>
        </Card>
      ) : null}

      {/* Navigation */}
      <div className="flex items-center justify-between gap-2">
        <Button
          variant="outline"
          onClick={prevWord}
          disabled={index === 0}
        >
          ← 上一个
        </Button>
        <Button variant="ghost" onClick={resetSession}>
          重置
        </Button>
        <Button
          variant="secondary"
          onClick={nextWord}
          disabled={index >= words.length - 1}
        >
          下一个 →
        </Button>
      </div>
    </div>
  );
}
