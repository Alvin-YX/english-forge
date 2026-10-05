/**
 * speech 服务内部 API 契约 —— 03 文档 §5.8
 *
 * 🔴 该服务在 `ef_core` internal 网络内，**不对外暴露**（仅 api 可调用）。
 *
 * 🔶 重要设计（见 CONTRIBUTING.md §7）：所有模型依赖通过 Protocol 注入，
 * 单元测试注入 Fake 实现 → 无模型环境也能完整验证逻辑。
 */

import type {
  ConfidenceLevel,
  PerfTier,
  ScoreAttribution,
  ScoreDegradeLevel,
} from '../enums/index.js';
import type {
  FourDimensionStars,
  PhonemeScoreDetail,
  ThreeDimensionScores,
} from '../types/domain.js';

// ═══════════════════════════════════════════════════════════
// 通用
// ═══════════════════════════════════════════════════════════

export interface SpeechHealth {
  status: 'ok' | 'degraded' | 'unavailable';
  perfTier: PerfTier;
  /** 模型是否已加载并预热 */
  modelsReady: boolean;
  /** 各组件可用性 */
  components: {
    asr: boolean;
    aligner: boolean;
    phonemizer: boolean;
    tts: boolean;
  };
  version: string;
}

// ═══════════════════════════════════════════════════════════
// POST /speech/v1/transcode —— 音频转码
// ═══════════════════════════════════════════════════════════

export interface TranscodeRequest {
  /** 录音文件路径（容器内共享卷） */
  filePath: string;
  mimeType: string;
}

export interface AudioMetrics {
  durationSec: number;
  /** 信噪比 dB */
  snrDb: number;
  /** 峰值 dBFS（检测过曝） */
  peakDb: number;
  /** 有效语音占比（VAD） */
  speechRatio: number;
  /** 质量判定 */
  quality: 'good' | 'noisy' | 'too_quiet' | 'clipped' | 'silent';
}

export interface TranscodeResponse {
  wavPath: string;
  sampleRate: number;
  channels: number;
  metrics: AudioMetrics;
  /** 🔶 若质量不达标，标记为异常录音（04 文档 §5.6.1 规则②：不给分） */
  isAbnormal: boolean;
  /** 异常原因（isAbnormal=true 时有值） */
  abnormalReason?: 'too_short' | 'too_long' | 'noise_abnormal' | 'silent' | 'clipped';
  elapsedMs: number;
}

// ═══════════════════════════════════════════════════════════
// POST /speech/v1/pronounce —— 核心评分
// ═══════════════════════════════════════════════════════════

export interface PronounceRequest {
  wavPath: string;
  /** 参考文本 */
  refText: string;
  /** 参考词条 id（若为教材词条） */
  wordId?: string;
  /** 是否计算韵律（v1.1，MVP 默认关闭） */
  withProsody?: boolean;
  /** 覆盖本次请求使用的档位（不传则用服务当前档位） */
  perfTier?: PerfTier;
  /** 环境底噪 dB（用于置信度校准） */
  noiseFloorDb?: number;
}

export interface PronounceResponse {
  recordId: string;
  /** 状态：complete / partial / degraded / failed */
  status: 'complete' | 'partial' | 'degraded' | 'failed';
  /** 🔶 各阶段耗时（性能基准数据源） */
  timings: {
    transcodeMs: number;
    asrMs: number;
    phonemizeMs: number;
    alignMs: number;
    scoreMs: number;
    prosodyMs: number;
    totalMs: number;
  };

  // ── 分数 ────────────────────────────────────────────────
  /** 🔴 低置信时为 null（规则③：宁可少给，不可给错） */
  totalScore: number | null;
  threeDimensions: ThreeDimensionScores;
  fourStars: FourDimensionStars;
  per: number;
  wer: number;
  acousticDistance: number;

  // ── 明细 ────────────────────────────────────────────────
  phonemeDetails: PhonemeScoreDetail[];
  transcript: string;
  /** ASR 词级时间戳（用于波形标注） */
  wordSpans: Array<{ word: string; start: number; end: number; confidence: number }>;

  // ── 🔴 可靠性兜底（04 文档 §5.6.1）──────────────────────
  confidence: number;
  confidenceLevel: ConfidenceLevel;
  scorable: boolean;
  degradeLevel: ScoreDegradeLevel;
  /** 🔴 只能归因环境，严禁归因孩子能力 */
  attribution: ScoreAttribution;
  formulaVersion: string;

  /** 若某阶段失败，800ms 内返回 partial（03 文档 §7.6） */
  partialReason?: string;
}

// ═══════════════════════════════════════════════════════════
// POST /speech/v1/transcribe —— 纯 ASR
// ═══════════════════════════════════════════════════════════

export interface TranscribeRequest {
  wavPath: string;
  /** 词级时间戳 */
  wordTimestamps: boolean;
}

export interface TranscribeResponse {
  text: string;
  language: string;
  wordSpans: Array<{ word: string; start: number; end: number; confidence: number }>;
  elapsedMs: number;
}

// ═══════════════════════════════════════════════════════════
// GET /speech/v1/phonemes —— 文本 → 预期音素
// ═══════════════════════════════════════════════════════════

export interface PhonemeResponse {
  text: string;
  /** espeak-ng 输出的 IPA 音素序列 */
  phones: string[];
  /** 逐词音素（含词边界标记） */
  words: Array<{ word: string; phones: string[] }>;
  elapsedMs: number;
}

// ═══════════════════════════════════════════════════════════
// POST /speech/v1/tts —— TTS 合成（Piper）
// ═══════════════════════════════════════════════════════════

export interface TtsRequest {
  text: string;
  /** 音色 id */
  voice: string;
  /** 语速倍率 0.5-2.0 */
  rate?: number;
  accent?: 'uk' | 'us';
}

export interface TtsResponse {
  /** 缓存文件路径（media/tts/{sha256}.mp3） */
  filePath: string;
  /** 是否命中缓存 */
  cached: boolean;
  durationSec: number;
}

// ═══════════════════════════════════════════════════════════
// GET /speech/v1/models —— 模型与档位
// ═══════════════════════════════════════════════════════════

export interface ModelStatus {
  perfTier: PerfTier;
  asrModel: string;
  asrQuantization: string;
  alignerModel: string;
  ttsVoices: string[];
  /** 模型体积 MB */
  sizeMb: number;
  /** 是否已预热 */
  warmedUp: boolean;
}

export interface SetTierRequest {
  perfTier: PerfTier;
  /** 是否预热 */
  warmup?: boolean;
}

// ═══════════════════════════════════════════════════════════
// 内部：模型 Protocol（供依赖注入，见 CONTRIBUTING.md §7）
// ═══════════════════════════════════════════════════════════

/** 强制对齐器 Protocol —— 真实实现用 wav2vec2，测试用 Fake */
export interface PhonemeAligner {
  align(
    wavPath: string,
    refText: string,
  ): Promise<{
    phones: Array<{ phone: string; confidence: number; start: number; end: number; word: string }>;
  }>;
}

/** ASR Protocol —— 真实实现用 faster-whisper，测试用 Fake */
export interface AsrEngine {
  transcribe(wavPath: string): Promise<{
    text: string;
    wordSpans: Array<{ word: string; start: number; end: number; confidence: number }>;
  }>;
}

/** 音素化 Protocol —— 真实实现用 espeak-ng，测试用 Fake */
export interface Phonemizer {
  toPhonemes(text: string): string[];
}

/** TTS Protocol —— 真实实现用 Piper，测试用 Fake */
export interface TtsEngine {
  synthesize(text: string, voice: string, rate: number): Promise<Buffer>;
}
