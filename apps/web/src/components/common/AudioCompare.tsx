import { useCallback, useEffect, useRef, useState } from 'react';

interface AudioCompareProps {
  originalUrl: string | null;
  recordingUrl: string | null;
  originalLabel?: string;
  recordingLabel?: string;
}

const SPEED_OPTIONS = [0.5, 0.75, 1, 1.25, 1.5, 2];

function drawWaveform(
  canvas: HTMLCanvasElement,
  peaks: number[],
  color: string,
  progress: number,
) {
  const ctx = canvas.getContext('2d');
  if (!ctx) return;

  const w = canvas.width;
  const h = canvas.height;
  const mid = h / 2;
  const barWidth = w / peaks.length;

  ctx.clearRect(0, 0, w, h);

  for (let i = 0; i < peaks.length; i++) {
    const x = i * barWidth;
    // 缺失的采样点按静音（0）处理，避免 NaN 高度污染整条波形
    const peak = peaks[i] ?? 0;
    const barHeight = Math.max(2, peak * (h - 4));
    const y = mid - barHeight / 2;

    ctx.fillStyle = i / peaks.length <= progress ? color : color + '40';
    ctx.fillRect(x, y, barWidth - 1, barHeight);
  }
}

interface AudioPlayerProps {
  src: string | null;
  label: string;
  accentColor: string;
}

function AudioPlayer({ src, label, accentColor }: AudioPlayerProps) {
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [progress, setProgress] = useState(0);
  const [speed, setSpeed] = useState(1);
  const [peaks, setPeaks] = useState<number[]>([]);
  const animRef = useRef<number | null>(null);

  // Decode and generate peaks
  useEffect(() => {
    if (!src) {
      setPeaks([]);
      return;
    }

    let cancelled = false;
    const audio = new Audio(src);
    audio.crossOrigin = 'anonymous';

    audio.onloadedmetadata = async () => {
      if (cancelled) return;
      try {
        const arrayBuffer = await fetch(src).then((r) => r.arrayBuffer());
        const audioCtx = new AudioContext();
        const audioBuffer = await audioCtx.decodeAudioData(arrayBuffer);
        const data = audioBuffer.getChannelData(0);

        const numPeaks = 64;
        const samplesPerPeak = Math.floor(data.length / numPeaks);
        const p: number[] = [];
        for (let i = 0; i < numPeaks; i++) {
          const start = i * samplesPerPeak;
          const end = start + samplesPerPeak;
          let max = 0;
          // TypedArray 迭代产出 `number`；subarray 同时处理了
          // 音频短于 numPeaks 时 end 越界的情况（此时 slice 为空 → max 保持 0）
          for (const sample of data.subarray(start, end)) {
            const val = Math.abs(sample);
            if (val > max) max = val;
          }
          p.push(Math.min(1, max));
        }
        setPeaks(p);
        audioCtx.close();
      } catch {
        // Fallback: random peaks
        setPeaks(
          Array.from({ length: 64 }, () => 0.2 + Math.random() * 0.6),
        );
      }
    };

    return () => {
      cancelled = true;
    };
  }, [src]);

  // Animation loop for progress
  useEffect(() => {
    if (!isPlaying || !audioRef.current) return;

    const animate = () => {
      const audio = audioRef.current;
      if (!audio || audio.paused) return;
      const dur = audio.duration || 1;
      setProgress(audio.currentTime / dur);
      animRef.current = requestAnimationFrame(animate);
    };
    animate();

    return () => {
      if (animRef.current) {
        cancelAnimationFrame(animRef.current);
        animRef.current = null;
      }
    };
  }, [isPlaying]);

  useEffect(() => {
    if (canvasRef.current && peaks.length > 0) {
      drawWaveform(canvasRef.current, peaks, accentColor, progress);
    }
  }, [peaks, progress, accentColor]);

  useEffect(() => {
    if (audioRef.current) {
      audioRef.current.playbackRate = speed;
    }
  }, [speed]);

  const togglePlay = useCallback(() => {
    const audio = audioRef.current;
    if (!audio) return;

    if (audio.paused) {
      audio.play();
      setIsPlaying(true);
    } else {
      audio.pause();
      setIsPlaying(false);
    }
  }, []);

  return (
    <div className="flex-1 space-y-2">
      <div className="flex items-center justify-between">
        <span className="text-xs font-medium text-slate-500">
          {label}
        </span>
        <button
          type="button"
          onClick={togglePlay}
          disabled={!src}
          className={`flex h-8 w-8 items-center justify-center rounded-full text-white shadow-md transition hover:opacity-90 disabled:opacity-40 ${accentColor}`}
          aria-label={isPlaying ? '暂停' : '播放'}
        >
          {isPlaying ? '⏸' : '▶'}
        </button>
      </div>

      {/* Waveform canvas */}
      <canvas
        ref={canvasRef}
        width={400}
        height={40}
        className="w-full rounded-md bg-slate-100"
        style={{ height: '40px' }}
      />

      {/* Native audio for fallback */}
      {src && (
        <audio
          ref={audioRef}
          src={src}
          onEnded={() => {
            setIsPlaying(false);
            setProgress(0);
          }}
          onPause={() => setIsPlaying(false)}
          onPlay={() => setIsPlaying(true)}
          className="sr-only"
        />
      )}

      {/* Speed controls */}
      <div className="flex flex-wrap gap-1">
        {SPEED_OPTIONS.map((s) => (
          <button
            key={s}
            type="button"
            onClick={() => setSpeed(s)}
            className={`rounded px-2 py-0.5 text-xs font-medium transition ${
              speed === s
                ? 'bg-primary-600 text-white'
                : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
            }`}
          >
            {s}x
          </button>
        ))}
      </div>
    </div>
  );
}

export function AudioCompare({
  originalUrl,
  recordingUrl,
  originalLabel = '原声',
  recordingLabel = '我的录音',
}: AudioCompareProps) {
  return (
    <div className="flex flex-col gap-4 sm:flex-row">
      <AudioPlayer
        src={originalUrl}
        label={originalLabel}
        accentColor="bg-primary-600"
      />
      <div className="hidden w-px bg-slate-200 sm:block" />
      <AudioPlayer
        src={recordingUrl}
        label={recordingLabel}
        accentColor="bg-success-600"
      />
    </div>
  );
}
