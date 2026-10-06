import { useCallback, useRef, useState } from 'react';

const MediaRecorderCtor: typeof MediaRecorder =
  window.MediaRecorder ??
  (window as unknown as { WebkitMediaRecorder: typeof MediaRecorder }).WebkitMediaRecorder;

const MIME_TYPE = MediaRecorderCtor.isTypeSupported('audio/webm')
  ? 'audio/webm'
  : 'audio/ogg';

export interface UseRecordingReturn {
  isRecording: boolean;
  isPaused: boolean;
  audioUrl: string | null;
  audioBase64: string | null;
  audioDuration: number;
  error: string | null;
  start: () => Promise<void>;
  pause: () => void;
  resume: () => void;
  stop: () => Promise<void>;
  reset: () => void;
  analyser: AnalyserNode | null;
}

export function useRecording(): UseRecordingReturn {
  const [isRecording, setIsRecording] = useState(false);
  const [isPaused, setIsPaused] = useState(false);
  const [audioUrl, setAudioUrl] = useState<string | null>(null);
  const [audioBase64, setAudioBase64] = useState<string | null>(null);
  const [audioDuration, setAudioDuration] = useState(0);
  const [error, setError] = useState<string | null>(null);

  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const sourceRef = useRef<MediaStreamAudioSourceNode | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const durationRef = useRef(0);
  const [analyser, setAnalyser] = useState<AnalyserNode | null>(null);

  const clearTimer = useCallback(() => {
    if (timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }
  }, []);

  const cleanupAudioContext = useCallback(() => {
    if (audioContextRef.current) {
      try {
        audioContextRef.current.close();
      } catch {
        // ignore
      }
      audioContextRef.current = null;
      analyserRef.current = null;
      sourceRef.current = null;
      setAnalyser(null);
    }
  }, []);

  const stopStream = useCallback(() => {
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((track) => track.stop());
      streamRef.current = null;
    }
  }, []);

  const blobToBase64 = (blob: Blob): Promise<string> => {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onloadend = () => resolve(reader.result as string);
      reader.onerror = () => reject(new Error('Base64 转换失败'));
      reader.readAsDataURL(blob);
    });
  };

  const start = useCallback(async () => {
    if (!MediaRecorderCtor) {
      setError('当前浏览器不支持录音功能');
      return;
    }

    setError(null);
    setAudioUrl(null);
    setAudioBase64(null);
    setAudioDuration(0);
    durationRef.current = 0;
    chunksRef.current = [];

    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;

      // Create AudioContext + Analyser for volume visualization
      const AudioCtx =
        window.AudioContext ??
        (window as unknown as { webkitAudioContext: typeof AudioContext })
          .webkitAudioContext;
      audioContextRef.current = new AudioCtx();
      sourceRef.current = audioContextRef.current.createMediaStreamSource(
        stream,
      );
      analyserRef.current = audioContextRef.current.createAnalyser();
      analyserRef.current.fftSize = 256;
      analyserRef.current.smoothingTimeConstant = 0.6;
      sourceRef.current.connect(analyserRef.current);
      setAnalyser(analyserRef.current);

      const recorder = new MediaRecorderCtor(stream, { mimeType: MIME_TYPE });
      mediaRecorderRef.current = recorder;

      recorder.ondataavailable = (event) => {
        if (event.data.size > 0) {
          chunksRef.current.push(event.data);
        }
      };

      recorder.onstop = async () => {
        const blob = new Blob(chunksRef.current, { type: MIME_TYPE });
        const url = URL.createObjectURL(blob);
        const base64 = await blobToBase64(blob);

        // Get duration
        const audio = new Audio(url);
        audio.onloadedmetadata = () => {
          const dur = audio.duration;
          setAudioDuration(dur);
          durationRef.current = dur;
        };
        audio.onerror = () => {
          setAudioDuration(durationRef.current);
        };

        setAudioUrl(url);
        setAudioBase64(base64);
        setIsRecording(false);
        setIsPaused(false);
      };

      recorder.start(100);
      setIsRecording(true);
      setIsPaused(false);

      // Timer
      timerRef.current = setInterval(() => {
        durationRef.current += 0.1;
        setAudioDuration(durationRef.current);
      }, 100);
    } catch (err) {
      const e = err as DOMException;
      if (e.name === 'NotAllowedError' || e.name === 'PermissionDeniedError') {
        setError('麦克风权限被拒绝，请在浏览器设置中允许访问麦克风');
      } else if (
        e.name === 'NotFoundError' ||
        e.name === 'DevicesNotFoundError'
      ) {
        setError('未找到可用的麦克风设备');
      } else {
        setError('录音启动失败: ' + (e.message || e.name));
      }
      setIsRecording(false);
      setIsPaused(false);
    }
  }, []);

  const pause = useCallback(() => {
    if (
      mediaRecorderRef.current &&
      mediaRecorderRef.current.state === 'recording'
    ) {
      mediaRecorderRef.current.pause();
      setIsPaused(true);
      clearTimer();
    }
  }, [clearTimer]);

  const resume = useCallback(() => {
    if (
      mediaRecorderRef.current &&
      mediaRecorderRef.current.state === 'paused'
    ) {
      mediaRecorderRef.current.resume();
      setIsPaused(false);
      // Resume timer
      timerRef.current = setInterval(() => {
        durationRef.current += 0.1;
        setAudioDuration(durationRef.current);
      }, 100);
    }
  }, []);

  const stop = useCallback(async () => {
    clearTimer();
    if (
      mediaRecorderRef.current &&
      mediaRecorderRef.current.state !== 'inactive'
    ) {
      mediaRecorderRef.current.stop();
    }
    stopStream();
    cleanupAudioContext();
  }, [clearTimer, stopStream, cleanupAudioContext]);

  const reset = useCallback(() => {
    if (audioUrl) {
      URL.revokeObjectURL(audioUrl);
    }
    setAudioUrl(null);
    setAudioBase64(null);
    setAudioDuration(0);
    durationRef.current = 0;
    setIsRecording(false);
    setIsPaused(false);
    setError(null);
  }, [audioUrl]);

  return {
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
  };
}
