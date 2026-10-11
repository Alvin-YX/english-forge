import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { AudioCompare } from '../../components/common/AudioCompare';
import { PageLoader } from '../../components/common/PageLoader';
import { Recorder } from '../../components/common/Recorder';
import { StateView } from '../../components/common/StateView';
import { Badge } from '../../components/ui/Badge';
import { Button } from '../../components/ui/Button';
import { Card } from '../../components/ui/Card';
import { useResource } from '../../hooks/useResource';
import { api } from '../../lib/api';
import type {
  PracticeSessionResult,
  ShadowScoreResult,
  WordCard,
} from '../../lib/types';

/**
 * 评分可靠性兜底（见开发文档 §5.6.1，标注为"不可协商"）。
 * 三条规则在这里集中落地，改这里就等于改产品的伦理底线。
 */

/** 规则②：异常录音（短于 0.5s）不给分 —— 太短的音频无法判断发音。 */
const MIN_SCORED_SECONDS = 0.5;

/** 低置信阈值的二次校验：既看后端给的等级，也看数值本身。 */
const LOW_CONFIDENCE_THRESHOLD = 0.4;

function isLowConfidence(result: ShadowScoreResult): boolean {
  return (
    result.confidence_level === 'low' ||
    result.confidence < LOW_CONFIDENCE_THRESHOLD
  );
}

/** word.id 是字符串，后端可能给纯数字也可能是业务 key —— 统一转成会话内稳定的 number。 */
function wordIdOf(word: WordCard, index: number): number {
  const n = Number.parseInt(word.id, 10);
  return Number.isFinite(n) && n > 0 ? n : index + 1;
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
  const { data, loading, error, reload } = useResource<WordCard[]>(
    async () => api.get<WordCard[]>('/words'),
  );
  const [index, setIndex] = useState(0);
  const [sessionResults, setSessionResults] = useState<
    PracticeSessionResult[]
  >([]);
  const [sessionFinished, setSessionFinished] = useState(false);

  // Per-word state
  const [currentScore, setCurrentScore] = useState<ShadowScoreResult | null>(
    null,
  );
  const [scoreSubmitError, setScoreSubmitError] = useState<string | null>(null);
  const [recordError, setRecordError] = useState<string | null>(null);
  const [tooShort, setTooShort] = useState(false);
  const [isScoring, setIsScoring] = useState(false);
  const [recordingAudioUrl, setRecordingAudioUrl] = useState<string | null>(
    null,
  );
  const [isPlayingOriginal, setIsPlayingOriginal] = useState(false);
  const [take, setTake] = useState(0);

  const speechSynthRef = useRef<SpeechSynthesisUtterance | null>(null);
  // 保留最近一次评分提交的音频，供"重新提交刚才的录音"使用
  const lastAttemptRef = useRef<{ audioBase64: string; duration: number } | null>(
    null,
  );

  // 一轮只取前 10 张词卡，避免单轮过长（memo 化以稳定数组引用）
  const practiceWords = useMemo(() => data?.slice(0, 10) ?? [], [data]);

  // Cleanup speech synthesis on unmount
  useEffect(() => {
    return () => {
      window.speechSynthesis.cancel();
    };
  }, []);

  // Play original pronunciation using Web Speech API
  const playOriginal = useCallback(() => {
    const word = practiceWords[index];
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
  }, [practiceWords, index]);

  const nextWord = useCallback(() => {
    if (index + 1 >= practiceWords.length) {
      setSessionFinished(true);
      return;
    }
    setIndex((i) => i + 1);
    setCurrentScore(null);
    setScoreSubmitError(null);
    setRecordError(null);
    setTooShort(false);
    setRecordingAudioUrl(null);
  }, [index, practiceWords.length]);

  const prevWord = useCallback(() => {
    if (index > 0) {
      setIndex((i) => i - 1);
      setCurrentScore(null);
      setScoreSubmitError(null);
      setRecordError(null);
      setTooShort(false);
      setRecordingAudioUrl(null);
    }
  }, [index]);

  const resetSession = useCallback(() => {
    setIndex(0);
    setSessionResults([]);
    setSessionFinished(false);
    setCurrentScore(null);
    setScoreSubmitError(null);
    setRecordError(null);
    setTooShort(false);
    setRecordingAudioUrl(null);
    lastAttemptRef.current = null;
  }, []);

  /**
   * 提交录音评分。刻意从 handleRecordStop 里抽出来，
   * 这样"重试"按钮能复用同一段逻辑而不用重读文件。
   */
  const submitForScoring = useCallback(
    async (audioBase64: string, duration: number) => {
      const word = practiceWords[index];
      if (!word) return;

      // 规则②：异常录音不给分
      if (duration < MIN_SCORED_SECONDS) {
        setCurrentScore(null);
        setScoreSubmitError(null);
        setTooShort(true);
        setRecordingAudioUrl(null);
        return;
      }

      setIsScoring(true);
      setTooShort(false);
      setScoreSubmitError(null);
      setCurrentScore(null);

      try {
        const result = await api.post<ShadowScoreResult>(
          '/speech/score/shadow',
          {
            audio_base64: audioBase64,
            target_text: word.headword,
          },
        );

        setCurrentScore(result);

        // 规则③：低置信度不给总分 —— 因此不计入会话统计，避免污染均分
        if (!isLowConfidence(result)) {
          const practiceResult: PracticeSessionResult = {
            wordId: wordIdOf(word, index),
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

          // Auto-advance only when we actually produced a trustworthy score
          if (result.overall >= 70 && index + 1 < practiceWords.length) {
            setTimeout(() => {
              nextWord();
            }, 1500);
          }

          // Auto-add to errorbook if score < 60
          if (result.overall < 60) {
            try {
              await api.post('/errorbook', {
                kind: 'pronunciation',
                target: word.headword,
                translation: word.translation,
              });
            } catch (err) {
              setRecordError(
                `错题本写入失败：${err instanceof Error ? err.message : '未知错误'}`,
              );
            }
          }
        }

        // Submit learning record（端点是 /learning/record，不是 /learning/records）
        try {
          await api.post('/learning/record', {
            kind: 'pronunciation',
            wordId: word.id,
            correct: result.overall >= 60,
            score: result.overall,
          });
        } catch (err) {
          setRecordError(
            `学习记录上报失败：${err instanceof Error ? err.message : '未知错误'}`,
          );
        }
      } catch (err) {
        // 不再伪造分数。评分失败就明说，录音还在，可以重提。
        setScoreSubmitError(
          err instanceof Error ? err.message : '评分服务暂时不可用',
        );
      } finally {
        setIsScoring(false);
      }
    },
    [practiceWords, index, nextWord],
  );

  const handleRecordStop = useCallback(
    (audioBase64: string, duration: number, audioUrl: string) => {
      lastAttemptRef.current = { audioBase64, duration };
      setRecordingAudioUrl(audioUrl);
      void submitForScoring(audioBase64, duration);
    },
    [submitForScoring],
  );

  const retryScore = useCallback(() => {
    const attempt = lastAttemptRef.current;
    if (!attempt) return;
    setTake((t) => t + 1);
    setRecordingAudioUrl(null);
    void submitForScoring(attempt.audioBase64, attempt.duration);
  }, [submitForScoring]);

  const retakeRecording = useCallback(() => {
    setCurrentScore(null);
    setScoreSubmitError(null);
    setTooShort(false);
    setRecordingAudioUrl(null);
    lastAttemptRef.current = null;
    setTake((t) => t + 1);
  }, []);

  // Calculate session stats
  const avgScore =
    sessionResults.length > 0
      ? Math.round(
          sessionResults.reduce((s, r) => s + r.score, 0) /
            sessionResults.length,
        )
      : 0;

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

  if (practiceWords.length === 0) {
    return (
      <Card>
        <StateView
          icon="📭"
          tone="muted"
          title="词库还是空的"
          message="请先导入词库数据（例如运行 scripts/import-ecdict.mjs），否则没有词可跟读。"
          onRetry={reload}
          retryLabel="重新检查"
        />
      </Card>
    );
  }

  const currentWord = practiceWords[index];
  if (!currentWord) return null;

  // Session finished view
  if (sessionFinished) {
    const bestScore =
      sessionResults.length > 0 ? Math.max(...sessionResults.map((r) => r.score)) : 0;
    const worstScore =
      sessionResults.length > 0 ? Math.min(...sessionResults.map((r) => r.score)) : 0;
    const skippedCount = practiceWords.length - sessionResults.length;

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
            练习了 {practiceWords.length} 个词
          </p>

          {sessionResults.length === 0 ? (
            <p className="mt-4 rounded-lg bg-slate-50 p-3 text-sm text-slate-500">
              本轮没有得到有效评分（录音过短或评分置信度过低），因此不给出平均分。
            </p>
          ) : (
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
          )}

          <p className="mt-4 text-sm text-slate-600">
            有效评分 {sessionResults.length}/{practiceWords.length} 个词（≥60分视为通过）
            {skippedCount > 0 ? `，${skippedCount} 个词未得到有效评分` : ''}
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

  const showOverall = currentScore !== null && !isLowConfidence(currentScore);

  return (
    <div className="mx-auto max-w-2xl space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-bold text-slate-900">
          跟读练习 🎤
        </h1>
        <Badge variant="default">
          {Math.min(index + 1, practiceWords.length)} / {practiceWords.length}
        </Badge>
      </div>

      {/* Progress dots */}
      <div className="flex justify-center gap-1">
        {practiceWords.map((word, i) => {
          const r = sessionResults.find(
            (res) => res.wordId === wordIdOf(word, i),
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
          key={take}
          onStop={handleRecordStop}
          disabled={isScoring}
        />
        <p className="mt-3 text-center text-xs text-slate-400">
          录音短于 {MIN_SCORED_SECONDS} 秒不会计分
        </p>
      </Card>

      {/* Too-short notice */}
      {tooShort ? (
        <Card>
          <StateView
            icon="⏱️"
            tone="muted"
            compact
            title="录音太短，不给评分"
            message={`短于 ${MIN_SCORED_SECONDS} 秒的录音无法判断发音，请完整跟读这个词后再试一次。`}
            onRetry={retakeRecording}
            retryLabel="重新录音"
          />
        </Card>
      ) : null}

      {/* Score submission failure —— 不伪造分数，允许重提 */}
      {scoreSubmitError ? (
        <Card>
          <StateView
            title="评分服务暂时不可用"
            message={scoreSubmitError}
            onRetry={retryScore}
            retryLabel="重新提交刚才的录音"
          />
        </Card>
      ) : null}

      {/* Score results */}
      {currentScore ? (
        <Card className="p-6">
          <h3 className="mb-4 text-base font-semibold text-slate-900">
            评分结果
          </h3>

          {/* Overall score —— 规则③：低置信度不给总分 */}
          {isLowConfidence(currentScore) ? (
            <div className="rounded-xl border border-dashed border-slate-200 bg-slate-50 p-5 text-center">
              <p className="text-2xl">🔍</p>
              <p className="mt-2 text-sm font-medium text-slate-900">
                置信度过低，暂不给总分
              </p>
              <p className="mt-1 text-xs leading-5 text-slate-500">
                本次录音的置信度为 {Math.round(currentScore.confidence * 100)}%（{currentScore.confidence_level}），
                不足以支撑一个可信的分数。换个安静的环境重新录音通常能解决。
              </p>
            </div>
          ) : (
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
          )}

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

          {/* 规则④：低分只能归因环境，不能归因孩子能力 */}
          {showOverall && currentScore.overall < 60 ? (
            <div className="mt-4 rounded-lg border border-warning-200 bg-warning-50 p-3 text-sm text-warning-700">
              <p className="font-semibold">
                {currentScore.has_noise ? '🔇 环境噪声偏大' : '🎯 这个词可以再练一次'}
              </p>
              <p className="mt-1 text-xs leading-5">
                {currentScore.has_noise
                  ? '背景声较大时评分会偏低，这是环境因素，不代表发音能力。'
                  : '换个姿势或放慢语速重读一次，通常能明显改善。'}
              </p>
            </div>
          ) : null}

          {/* 音素级明细 —— 后端尚未提供该字段，如实说明而不是伪造 */}
          <div className="mt-4">
            <StateView
              icon="🔤"
              tone="muted"
              compact
              title="音素级明细暂不可用"
              message="评分服务尚未返回逐音素的准确率数据（/speech/align/phoneme），因此这里不展示逐音素柱状图。"
            />
          </div>

          {/* A/B Comparison */}
          <div className="mt-4">
            <h4 className="mb-2 text-sm font-medium text-slate-700">
              A/B 对比
            </h4>
            <AudioCompare
              originalUrl={null}
              recordingUrl={recordingAudioUrl}
            />
            <p className="mt-2 text-xs text-slate-400">
              原声侧需要 TTS 服务（/speech/tts）提供可下载的音频，当前尚未接入，因此只有你的录音可回放。
            </p>
          </div>

          {/* Side-effect failures */}
          {recordError ? (
            <div className="mt-4 rounded-lg border border-warning-200 bg-warning-50 p-3 text-sm text-warning-700">
              <span className="font-semibold">⚠️ {recordError}</span>
              —— 评分已给出，但这一步没有写进服务端。
            </div>
          ) : null}

          {/* Actions */}
          <div className="mt-5 flex justify-center gap-2">
            <Button variant="outline" onClick={retakeRecording}>
              重新录音
            </Button>
            {index + 1 < practiceWords.length ? (
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
          disabled={index >= practiceWords.length - 1}
        >
          下一个 →
        </Button>
      </div>
    </div>
  );
}
