import { useCallback, useEffect, useRef } from 'react';

import { useRecording } from '../../hooks/useRecording';

interface RecorderProps {
  onStop: (audioBase64: string, duration: number, audioUrl: string) => void;
  disabled?: boolean;
}

function formatTime(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

export function Recorder({ onStop, disabled = false }: RecorderProps) {
  const {
    isRecording,
    isPaused,
    audioUrl,
    audioBase64,
    audioDuration,
    error,
    start,
    pause,
    resume,
    stop,
    reset,
    analyser,
  } = useRecording();

  const barsRef = useRef<(HTMLDivElement | null)[]>([]);
  const animFrameRef = useRef<number | null>(null);

  // Audio level visualization
  useEffect(() => {
    if (!analyser || !isRecording) return;

    const buffer = new Uint8Array(analyser.frequencyBinCount);

    const update = () => {
      analyser.getByteFrequencyData(buffer);
      const bars = barsRef.current;
      for (let i = 0; i < bars.length; i++) {
        const bar = bars[i];
        if (!bar) continue;
        const start = Math.floor((buffer.length / bars.length) * i);
        const end = Math.floor((buffer.length / bars.length) * (i + 1));
        // subarray 返回视图；for...of 的 TypedArray 迭代产出 `number`（非
        // `number | undefined`），也避免 buffer[j] 的 unchecked index 访问。
        const slice = buffer.subarray(start, end);
        let sum = 0;
        for (const sample of slice) sum += sample;
        // slice 可能为空（bar 数多于采样点数），此时按静音处理，避免 0/0 = NaN
        const avg = slice.length > 0 ? sum / slice.length : 0;
        const height = Math.max(4, (avg / 255) * 100);
        bar.style.height = height + '%';
      }
      animFrameRef.current = requestAnimationFrame(update);
    };

    update();
    return () => {
      if (animFrameRef.current) {
        cancelAnimationFrame(animFrameRef.current);
        animFrameRef.current = null;
      }
      // Reset bars
      barsRef.current.forEach((b) => {
        if (b) b.style.height = '4%';
      });
    };
  }, [analyser, isRecording]);

  const handleStart = useCallback(async () => {
    if (disabled) return;
    await start();
  }, [start, disabled]);

  const handleStop = useCallback(async () => {
    if (isRecording || isPaused) {
      await stop();
    }
  }, [isRecording, isPaused, stop]);

  const handleSubmit = useCallback(() => {
    if (audioBase64 && audioUrl) {
      onStop(audioBase64, audioDuration, audioUrl);
    }
  }, [audioBase64, audioDuration, audioUrl, onStop]);

  const handleReset = useCallback(() => {
    reset();
  }, [reset]);

  return (
    <div className="flex flex-col items-center gap-3">
      {/* Error message */}
      {error ? (
        <div className="w-full rounded-lg bg-danger-50 px-4 py-2 text-sm text-danger-700">
          {error}
        </div>
      ) : null}

      {/* Timer */}
      <div className="font-mono text-lg font-semibold text-slate-700 tabular-nums">
        {formatTime(audioDuration)}
      </div>

      {/* Level indicator bars */}
      <div className="flex h-12 items-end gap-1">
        {[0, 1, 2, 3, 4].map((i) => (
          <div
            key={i}
            ref={(el) => {
              barsRef.current[i] = el;
            }}
            className={`w-2 rounded-sm transition-all duration-100 ${
              isRecording && !isPaused
                ? 'bg-primary-500'
                : 'bg-slate-200'
            }`}
            style={{ height: '4%' }}
          />
        ))}
      </div>

      {/* Button row */}
      <div className="flex items-center gap-3">
        {/* Pause/Resume */}
        {isRecording || isPaused ? (
          <button
            type="button"
            onClick={isPaused ? resume : pause}
            className="flex h-10 w-10 items-center justify-center rounded-full bg-warning-500 text-white shadow-md transition hover:bg-warning-600"
            aria-label={isPaused ? '继续录音' : '暂停录音'}
          >
            {isPaused ? '▶' : '⏸'}
          </button>
        ) : null}

        {/* Main record button */}
        <button
          type="button"
          onClick={isRecording || isPaused ? handleStop : handleStart}
          disabled={disabled && !isRecording && !isPaused}
          className={`flex items-center justify-center rounded-full shadow-lg transition-all duration-300 focus:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50 ${
            isRecording
              ? `h-14 w-14 bg-danger-500 text-white ring-4 ring-danger-200 ${
                  !isPaused
                    ? 'animate-pulse'
                    : 'ring-warning-200 bg-warning-500'
                }`
              : 'h-14 w-14 bg-primary-600 text-white hover:bg-primary-700'
          }`}
          aria-label={
            isRecording || isPaused ? '停止录音' : '开始录音'
          }
        >
          {isRecording || isPaused ? (
            <span className="block h-4 w-4 rounded-sm bg-white" />
          ) : (
            <span className="text-2xl">🎤</span>
          )}
        </button>

        {/* Reset button */}
        {audioUrl && !isRecording && !isPaused ? (
          <button
            type="button"
            onClick={handleReset}
            className="flex h-10 w-10 items-center justify-center rounded-full bg-slate-200 text-slate-600 transition hover:bg-slate-300"
            aria-label="重置录音"
          >
            <span className="text-lg">↺</span>
          </button>
        ) : null}
      </div>

      {/* Submit button */}
      {audioUrl && !isRecording && !isPaused ? (
        <button
          type="button"
          onClick={handleSubmit}
          className="mt-1 flex items-center gap-2 rounded-[var(--radius-btn)] bg-primary-600 px-5 py-2 text-sm font-medium text-white transition hover:bg-primary-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-500 focus-visible:ring-offset-2"
        >
          <span>✓</span>
          <span>提交评分</span>
        </button>
      ) : null}

      {/* Playback preview */}
      {audioUrl && !isRecording && !isPaused ? (
        <audio
          src={audioUrl}
          controls
          className="w-full max-w-xs"
          style={{ height: '36px' }}
        />
      ) : null}
    </div>
  );
}
