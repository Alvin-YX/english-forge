/**
 * 五级 schema 领域类型 —— 03 文档 §4.2.2 / 04 文档 附录 B
 *
 * Stage(学段) → TextbookVersion(教材版本) → Volume(册次) → Unit(单元) → Entry(词条)
 *
 * 🔴 版权红线（03 文档 §4.2.3 + 04 文档 §9.3）：
 * WordEntry **强制** license + source 字段，且 schema 中**无"课文"实体** ——
 * 从数据结构上杜绝教材课文分发。
 */

import type { Accent, ExerciseKind, FrequencyBand, Role } from '../enums/index.js';

// ═══════════════════════════════════════════════════════════
// 学段
// ═══════════════════════════════════════════════════════════

/**
 * 学段。
 * 🔶 小学 1-2 年级 MVP 不做（04 文档 §4.7 六条论证），仅在兴趣模块标注非学科同步。
 */
export const StageCode = {
  PRIMARY_LOW: 'primary_low',   // 小学 1-2（v1.2 才做，v1.0 仅兴趣模块）
  PRIMARY: 'primary',           // 小学 3-6
  JUNIOR: 'junior',             // 初中
  SENIOR: 'senior',             // 高中（v1.1）
  COLLEGE: 'college',           // 大学（v1.1）
  ADULT: 'adult',               // 成人（v1.1）
} as const;
export type StageCode = (typeof StageCode)[keyof typeof StageCode];

export interface Stage {
  id: string;
  code: StageCode;
  name: string;
  nameEn: string;
  /** 建议起始年龄（04 文档 §4.7 规则6：年龄下限 6 岁） */
  minAge: number;
  maxAge: number;
  sortOrder: number;
  /** 🔶 MVP 是否实现（04 文档 §8.2 负向清单） */
  enabledInMvp: boolean;
  /** v1.0 仅"听+跟读"兴趣模块时的强制提示文案 */
  disclaimer?: string;
}

// ═══════════════════════════════════════════════════════════
// 教材版本
// ═══════════════════════════════════════════════════════════

/** 教材版本标识 */
export const TextbookCode = {
  PEP: 'pep',            // 人教版 PEP（3-6 年级）— MVP 主线
  FLTRP: 'fltrp',        // 外研版
  BNU: 'bnu',            // 北师大版
  SUE: 'sue',            // 苏教版
} as const;
export type TextbookCode = (typeof TextbookCode)[keyof typeof TextbookCode];

export interface TextbookVersion {
  id: string;
  code: TextbookCode;
  name: string;
  nameEn: string;
  stage: StageCode;
  /** 🔴 许可与来源，版权追踪必填（03 文档 §4.2.3） */
  license: string;
  source: string;
  enabledInMvp: boolean;
}

// ═══════════════════════════════════════════════════════════
// 册次与单元
// ═══════════════════════════════════════════════════════════

/** 册次类型：上册/下册/全一册 */
export const VolumeType = {
  VOLUME_1: 'v1', // 上册
  VOLUME_2: 'v2', // 下册
  SINGLE: 'single', // 全一册
} as const;
export type VolumeType = (typeof VolumeType)[keyof typeof VolumeType];

export interface Volume {
  id: string;
  textbookVersionId: string;
  /** 册序号（1-8） */
  index: number;
  type: VolumeType;
  name: string;
  /** 如「三年级上册」 */
  fullName: string;
  enabledInMvp: boolean;
}

export interface Unit {
  id: string;
  volumeId: string;
  index: number;
  name: string;
  nameEn?: string;
  /** 单元内词条数（冗余字段，便于前端展示） */
  wordCount: number;
}

// ═══════════════════════════════════════════════════════════
// 词条（🔴 版权红线核心）
// ═══════════════════════════════════════════════════════════

/**
 * 词条音素标注 —— 评测用。
 * 对齐 03 文档 §6.8：ref_phones[] 是音素比对的预期序列。
 */
export interface PhonemeAnnotation {
  /** IPA 音素（来自 espeak-ng 归一化后） */
  phone: string;
  /** 在词中的音素序号 */
  position: number;
  /** 🔶 多音位歧义标记（如 read/lead），用于置信度降权（03 文档 §6.8 Step3 ×0.9） */
  ambiguous?: boolean;
  /** 词尾标记（用于词尾降权） */
  isWordFinal?: boolean;
}

export interface WordEntry {
  id: string;

  // ── 内容字段 ────────────────────────────────────────────
  word: string;
  /** 国际音标 */
  ipa: string;
  /** 词性 */
  pos: string;
  /** 中文释义 */
  translation: string;
  /** 例句（≥1，REQ-002） */
  example?: string;
  exampleTranslation?: string;
  /** 例句音素标注（供例句跟读评分） */
  examplePhonemes?: PhonemeAnnotation[];

  // ── 发音 ───────────────────────────────────────────────
  audioUk?: string;
  audioUs?: string;
  /** 音素标注，评测用 */
  phonemes?: PhonemeAnnotation[];

  // ── 词频与标签 ─────────────────────────────────────────
  frequency?: number;
  frequencyBand: FrequencyBand;
  /** 考试 tag（中考/高考/四六级/考研/雅思托福…，对齐 ECDICT tag 字段） */
  tags: string[];

  // ── 🔴 版权追踪必填（03 文档 §4.2.3 + 04 文档 §9.3）──
  license: string;
  source: string;

  // ── 教材归属（可为空 = 来自社区词库而非教材）────────────
  unitId?: string;
  volumeId?: string;
  textbookVersionId?: string;
  stage?: StageCode;

  // ── 语境例句所属剧本（对话练习用）──────────────────────
  /** 教材对话角色：Man / Woman（对齐精华特性 #20 双人对话 TTS） */
  speaker?: 'Man' | 'Woman' | 'Narrator';
  /** 该句所属的情景对话剧本 id */
  dialogueScriptId?: string;

  // ── 审计 ───────────────────────────────────────────────
  createdAt: string;
  updatedAt: string;
}

// ═══════════════════════════════════════════════════════════
// 词条掌握度（四维）+ FSRS 状态
// ═══════════════════════════════════════════════════════════

/**
 * 词条掌握度四维 —— 03 文档 §3.1 wordmastery 模块。
 * 与 04 文档 §5.4 的三维评分权重矩阵区分：这里是「长期掌握状态」，
 * 那里是「单次评分的维度权重」。
 */
export interface WordMastery {
  userProfileId: string;
  wordId: string;

  // ── 四维掌握度（0-100）─────────────────────────────────
  /** 听力掌握度 */
  listening: number;
  /** 拼写掌握度 */
  spelling: number;
  /** 口语（跟读）掌握度 */
  speaking: number;
  /** 词义/用法掌握度 */
  meaning: number;

  // ── 错误统计 ───────────────────────────────────────────
  spellingErrorCount: number;
  pronounceErrorCount: number;
  /** 音素错误率（word_weakness 物化视图的数据源） */
  phonemeErrorRate: number;

  // ── 优先级排序（精华特性 #9 频率科学分级）──────────────
  /** 综合优先级得分，越高越该先练 */
  priorityScore: number;

  updatedAt: string;
}

/** FSRS 记忆状态（FSRS-5，见 CONTRIBUTING.md D-09） */
export const FsrsState = {
  NEW: 0,
  LEARNING: 1,
  REVIEW: 2,
  RELEARNING: 3,
} as const;
export type FsrsState = (typeof FsrsState)[keyof typeof FsrsState];

/**
 * FSRS 调度状态 —— 03 文档 §3.1 fsrs 模块。
 * 对齐 FSRS-5：memory_stability / difficulty / retrievability。
 */
export interface FsrsCard {
  userProfileId: string;
  wordId: string;
  state: FsrsState;
  /** 记忆稳定性（天） */
  stability: number;
  /** 难度（1-10） */
  difficulty: number;
  /** 可提取性（0-1） */
  retrievability: number;
  /** 上次复习时间 */
  lastReviewAt: string | null;
  /** 下次复习时间 */
  dueAt: string;
  /** 复习次数 */
  reps: number;
  /** lapses（遗忘次数） */
  lapses: number;
  /** 是否为 leech（需人工干预的顽固词） */
  isLeech: boolean;
  /** leech 触发阈值（默认 8） */
  leechThreshold: number;
}

// ═══════════════════════════════════════════════════════════
// 学习记录（统一大表）
// ═══════════════════════════════════════════════════════════

import type {
  ConfidenceLevel,
  DictationColor,
  ErrorCategory,
  RecordKind,
  ScoreDegradeLevel,
} from '../enums/index.js';

/** 拼写/听写四色 diff 明细（REQ-007） */
export interface DiffToken {
  word: string;
  color: DictationColor;
  /** 参考文本中的位置（-1 = 多出的词） */
  refIndex: number;
  /** 用户文本中的位置（-1 = 漏掉的词） */
  hypIndex: number;
}

/** 逐音素明细（REQ-005，03 文档 §4.2.8） */
export interface PhonemeScoreDetail {
  /** 预期音素（espeak-ng 输出） */
  expected: string;
  /** 实际音素（wav2vec2 输出），缺失时 undefined */
  actual?: string;
  /** 比对结果 */
  op: 'match' | 'substitution' | 'deletion' | 'insertion';
  /** 置信度 0-1 */
  confidence: number;
  /** 权重（词尾降权 + 歧义降权后） */
  weight: number;
  /** 着色（五色）
   */
  color: 'correct' | 'near' | 'missing' | 'word_final';
  /** 时间定位（秒），用于波形标注 */
  startSec?: number;
  endSec?: number;
  /** 所属词 */
  word: string;
}

/** 四维星级（03 文档 §6.8，对齐 word-teacher 的 1~5 星） */
export interface FourDimensionStars {
  /** 语音语调（韵律） */
  prosody: number;
  /** 流利连贯 */
  fluency: number;
  /** 准确完整 */
  accuracyCompleteness: number;
  /** 情感表现力（儿童向简化版） */
  expression: number;
}

/** 三维分数（0-100） */
export interface ThreeDimensionScores {
  accuracy: number;
  fluency: number;
  completeness: number;
}

/** 发音评分结果（03 文档 §4.2.8） */
export interface PronounceScore {
  id: string;
  recordId: string;
  userProfileId: string;
  wordId: string;

  // ── 分数 ───────────────────────────────────────────────
  /** 总分 0-100（🔴 低置信时为 null，规则③） */
  totalScore: number | null;
  threeDimensions: ThreeDimensionScores;
  fourStars: FourDimensionStars;
  /** 宽标准分（降级级别 B 时同时给出） */
  wideScaleScore?: number;

  // ── 错误统计 ───────────────────────────────────────────
  /** 音素错误率 PER */
  per: number;
  /** 词错误率 WER */
  wer: number;
  /** 声学距离 0-100（越大越差） */
  acousticDistance: number;

  // ── 明细 ───────────────────────────────────────────────
  phonemeDetails: PhonemeScoreDetail[];

  // ── 🔴 可靠性兜底四规则（04 文档 §5.6.1）───────────────
  /** 整体置信度 0-1 */
  confidence: number;
  /** 置信度等级 */
  confidenceLevel: ConfidenceLevel;
  /** 是否可给出总分（false 时只有音素建议） */
  scorable: boolean;
  /** 降级级别 A~F */
  degradeLevel: ScoreDegradeLevel;
  /**
   * 🔴 低分归因（规则④，不可协商）：**只能归因环境，严禁归因孩子能力**。
   * 详见 ScoreAttribution。
   */
  attribution: string;
  /** 评分口径版本（变更须 bump + 更新 golden） */
  formulaVersion: string;

  // ── 音频质量 ───────────────────────────────────────────
  audioDurationSec: number;
  /** 信噪比 dB */
  snrDb?: number;

  // ── 审计 ───────────────────────────────────────────────
  createdAt: string;
}

/** 学习记录（统一大表，03 文档 §4.2.6） */
export interface LearningRecord {
  id: string;
  userProfileId: string;
  kind: RecordKind;
  /** 关联词条（可空，如对话练习） */
  wordId?: string;
  /** 关联录音 */
  recordId?: string;
  /** 关联评分 */
  scoreId?: string;
  /** 是否正确 */
  correct: boolean;
  /** 本次得分 */
  score?: number;
  /** 耗时（秒） */
  durationSec: number;
  /** 🔶 置信度等级（对齐 04 文档 §5.6「绝不静默降级」，见 CONTRIBUTING.md） */
  confidenceLevel?: ConfidenceLevel;
  /** 🔶 降级级别持久化到每条记录（04 文档 §5.6.3） */
  degradeLevel?: ScoreDegradeLevel;
  /** 扩展数据（如 dictation 的四色 diff） */
  detail?: Record<string, unknown>;
  createdAt: string;
}

// ═══════════════════════════════════════════════════════════
// 录音
// ═══════════════════════════════════════════════════════════

export const RecordingStatus = {
  PENDING: 'pending',
  TRANSCODING: 'transcoding',
  TRANSCRIBING: 'transcribing',
  ALIGNING: 'aligning',
  SCORING: 'scoring',
  COMPLETED: 'completed',
  FAILED: 'failed',
} as const;
export type RecordingStatus = (typeof RecordingStatus)[keyof typeof RecordingStatus];

export interface Recording {
  id: string;
  userProfileId: string;
  /** 原始录音（.webm 存档 30 天） */
  filePath: string;
  /** 临时 wav（评分期间存在，任务结束即删） */
  wavPath?: string;
  durationSec: number;
  mimeType: string;
  sizeBytes: number;
  status: RecordingStatus;
  /** 参考文本 */
  refText?: string;
  /** ASR 转写结果 */
  transcript?: string;
  /** 保留到期时间（按 kind 决定 7/30/90 天） */
  retainUntil: string;
  /** 是否为错误样本（错误样本 7 天） */
  isErrorSample: boolean;
  createdAt: string;
}

// ═══════════════════════════════════════════════════════════
// 错题本
// ═══════════════════════════════════════════════════════════

export interface ErrorBookItem {
  id: string;
  userProfileId: string;
  wordId: string;
  category: ErrorCategory;
  /** 错误次数 */
  errorCount: number;
  /** 最近错误时间 */
  lastErrorAt: string;
  /** 是否已掌握 */
  resolved: boolean;
  /** 是否收藏 */
  starred: boolean;
  /** 错误明细（如错音素列表） */
  detail?: Record<string, unknown>;
}

/** 错误样本（可回放，7 天） */
export interface ErrorSample {
  id: string;
  userProfileId: string;
  /** 🔶 关联词条（见 CONTRIBUTING.md D-05：03 文档缺此字段已补） */
  wordId: string;
  category: ErrorCategory;
  recordId: string;
  /** 保留到期（7 天后物理删除文件，保留评分元数据） */
  retainUntil: string;
  /** 是否高优先级（单日 > 20 触发） */
  highPriority: boolean;
  /** 是否已回放过 */
  replayed: boolean;
  createdAt: string;
}

// ═══════════════════════════════════════════════════════════
// 5 词循环块
// ═══════════════════════════════════════════════════════════

/** 5 词循环中的一个词卡 */
export interface WordCardItem {
  wordId: string;
  word: string;
  ipa: string;
  translation: string;
  audioUk?: string;
  audioUs?: string;
  frequencyBand: FrequencyBand;
  /** 出现题型序列（循环内轮换） */
  exerciseKinds: ExerciseKind[];
}

export interface LessonBlock {
  id: string;
  courseId: string;
  userProfileId: string;
  /** 5 个词卡 */
  items: WordCardItem[];
  /** 目标完成时间（FSRS 驱动） */
  dueAt: string;
  /** 是否已完成 */
  completed: boolean;
  completedAt?: string;
  /** 生成来源 */
  generatedBy: 'rule' | 'llm';
  createdAt: string;
}

// ═══════════════════════════════════════════════════════════
// 用户与档案
// ═══════════════════════════════════════════════════════════

export interface User {
  id: string;
  username: string;
  displayName: string;
  role: Role;
  createdAt: string;
}

/**
 * 学习者档案（Profile）—— 03 文档 §4.2.1。
 * 🔴 REQ-011 架构级隔离：所有业务表的 `profile_id` 由中间件强制注入，
 * 不接受来自请求体的 profileId。
 */
export interface UserProfile {
  id: string;
  userId: string;
  displayName: string;
  avatar?: string;

  // ── 学段绑定 ───────────────────────────────────────────
  stage?: StageCode;
  textbookVersionId?: string;
  volumeId?: string;
  unitId?: string;

  // ── 偏好（REQ-004 / PATCH /me/profile）──────────────────
  accent: Accent;
  playbackRate: number;
  dailyGoalMinutes: number;
  perfTier?: string;

  // ── 🔶 首次使用校准（04 文档 §5.6.1 规则①，见 CONTRIBUTING.md）──
  /** 是否已完成首次使用前 1 句校准 */
  calibrationDone: boolean;
  /** 环境底噪 dB（校准测得） */
  noiseFloorDb?: number;

  createdAt: string;
  updatedAt: string;
}

// ═══════════════════════════════════════════════════════════
// 统计
// ═══════════════════════════════════════════════════════════

/** 日统计（热力图数据源，03 文档 §1.10 职责 3） */
export interface DailyStat {
  userProfileId: string;
  /** 日期 YYYY-MM-DD */
  date: string;
  studyMinutes: number;
  wordCount: number;
  /** 口语均分 */
  avgSpokenScore: number | null;
  /** 有效练习次数（WEEL 口径：跟读产生评分 或 ≥10 轮单词循环） */
  effectiveCount: number;
  /** 是否为打卡日（用于热力图金色描边） */
  checkedIn: boolean;
}

/**
 * 周报（REQ-012 / REQ-013）。
 * 🔶 导出格式：PNG 长图 + CSV（04 文档 Q2 已确认，见 CONTRIBUTING.md D-12）
 */
export interface WeeklyReport {
  userProfileId: string;
  /** 周起始日（周一）YYYY-MM-DD */
  weekStart: string;
  weekEnd: string;
  studyDays: number;
  totalMinutes: number;
  wordCount: number;
  avgSpokenScore: number | null;
  /** 音素 Top-N 弱项（REQ-012） */
  topPhoneWeakness: Array<{ phone: string; errorRate: number }>;
  /** 错词 Top10（REQ-012） */
  topErrorWords: Array<{ word: string; wordId: string; errorCount: number }>;
  /** 是否达成 WEEL 口径 */
  meetsWeel: boolean;
  createdAt: string;
}
