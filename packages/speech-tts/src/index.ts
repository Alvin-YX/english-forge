/**
 * @eng-forge/speech-tts — 共享语音/TTS 类型定义包
 *
 * 为 speech 服务（Python）、API（NestJS）和前端（React）
 * 提供共享的语音评分、TTS 请求/响应类型定义。
 */

// ── 语音评分结果 ──────────────────────────────────────────
export interface ScoreResult {
  /** 综合得分 0-100 */
  overallScore: number;
  /** 准确度 0-100 */
  accuracy: number;
  /** 流畅度 0-100 */
  fluency: number;
  /** 完整度 0-100 */
  completeness: number;
  /** 韵律 0-100 */
  prosody: number;
  /** 置信度等级 */
  confidenceLevel: 'high' | 'medium' | 'low';
  /** 降级等级 A-F */
  degradeLevel: 'A' | 'B' | 'C' | 'D' | 'E' | 'F';
  /** 分数归因 */
  scoreAttribution: string;
  /** 公式版本 */
  formulaVersion: string;
}

// ── TTS 请求 ──────────────────────────────────────────────
export interface TtsRequest {
  /** 要朗读的文本 */
  text: string;
  /** 语速 0.5-2.0 */
  rate?: number;
  /** 音量 0-100 */
  volume?: number;
  /** 音色 ID */
  voiceId?: string;
  /** 音频格式 */
  format?: 'mp3' | 'wav' | 'ogg';
  /** 采样率 Hz */
  sampleRate?: number;
}

// ── TTS 响应 ──────────────────────────────────────────────
export interface TtsResponse {
  /** 音频文件路径或 URL */
  audioPath?: string;
  /** 音频 Base64（仅小文件） */
  audioBase64?: string;
  /** 音频时长 ms */
  durationMs: number;
  /** 音频大小 bytes */
  sizeBytes: number;
  /** 使用的 provider */
  provider: string;
}

// ── 音素信息 ──────────────────────────────────────────────
export interface Phoneme {
  /** IPA 音标 */
  ipa: string;
  /** 对应的音标符号 */
  symbol: string;
  /** 起始时间 ms */
  startMs: number;
  /** 结束时间 ms */
  endMs: number;
  /** 发音准确度 0-100 */
  score?: number;
}

// ── 语音输入类型 ──────────────────────────────────────────
export const SPEECH_INPUT_TYPES = ['voice', 'text'] as const;
export type SpeechInputType = (typeof SPEECH_INPUT_TYPES)[number];

// ── 性能档位 ──────────────────────────────────────────────
export const PERF_TIERS = ['high', 'medium', 'low', 'minimal'] as const;
export type PerfTier = (typeof PERF_TIERS)[number];
