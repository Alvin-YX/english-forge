/**
 * 全仓共享枚举 —— 与 03 文档 §4 数据模型、§6.4 性能档位、§6.8 评分严格对齐
 *
 * 这些字面量是跨语言契约（NestJS / FastAPI / React 共享），
 * 任何改动必须同步 03 文档并 bump formula_version（若影响评分口径）。
 */

// ═══════════════════════════════════════════════════════════
// 性能档位（03 文档 §6.4 / 04 文档 §7.7）
// ═══════════════════════════════════════════════════════════

/**
 * 三档性能降级。
 * ⚠️ 注意：此处的「降级」指 ASR 模型与算法能力的降级（fluid/standard/power_saving），
 * 与 04 文档 §5.6.3 的「评分可靠性降级 A~F 级」是两个不同概念，勿混淆。
 */
export const PerfTier = {
  /** 流畅：small.en int8 + 逐音素 + 韵律 */
  FLUID: 'fluid',
  /** 标准：base.en int8 + 逐音素（韵律可选） */
  STANDARD: 'standard',
  /** 省电：tiny.en int8 + 词级二分 + 无韵律 */
  POWER_SAVING: 'power_saving',
} as const;
export type PerfTier = (typeof PerfTier)[keyof typeof PerfTier];

export const PERF_TIERS: readonly PerfTier[] = [
  PerfTier.FLUID,
  PerfTier.STANDARD,
  PerfTier.POWER_SAVING,
];

/** 各档位性能目标（04 文档 §7.6，邢工 i5-9500T 放宽至 3.5s） */
export const PERF_TIER_TARGET_MS: Record<PerfTier, number> = {
  [PerfTier.FLUID]: 3000, // P95 ≤ 3.0s
  [PerfTier.STANDARD]: 3500, // P95 ≤ 3.5s
  [PerfTier.POWER_SAVING]: 6000, // 总耗时 P95 ≤ 6.0s
};

/** 邢工硬件实测预期（04 文档 §7.6，single 句无韵律） */
export const PERF_BASELINE_9500T_MS = {
  min: 1510,
  max: 3130,
  /** 若实测 > 4000ms 必须自动降 power_saving（04 文档 §7.5 关键判断） */
  downgradeThreshold: 4000,
} as const;

// ═══════════════════════════════════════════════════════════
// 评分可靠性降级级别（04 文档 §5.6.3）
// ═══════════════════════════════════════════════════════════

/**
 * A~F 六级降级策略。
 * 🔴 硬性要求（04 文档 §5.6.3）：**绝不静默降级** ——
 * 顶栏显示引擎健康灯 + 降级状态持久化到每条记录。
 */
export const ScoreDegradeLevel = {
  /** A 正常：完整评分 */
  A_NORMAL: 'A',
  /** B 宽标准双尺度：显示正常分 + 宽标准分 */
  B_DUAL_SCALE: 'B',
  /** C 只给音素不给总分：隐藏总分，只给音素建议 */
  C_PHONEME_ONLY: 'C',
  /** D 流利度优先 + 内容不匹配引导 */
  D_FLUENCY_FIRST: 'D',
  /** E 模板驱动对话：走预置句型，不自由生成 */
  E_TEMPLATE_DIALOG: 'E',
  /** F 只读模式：不评分，录音 + 原文对照 + 人工自评 */
  F_READ_ONLY: 'F',
} as const;
export type ScoreDegradeLevel = (typeof ScoreDegradeLevel)[keyof typeof ScoreDegradeLevel];

/** 置信度等级（04 文档 §5.5 交互 #14「每条评分显示高/中/低」） */
export const ConfidenceLevel = {
  HIGH: 'high',
  MEDIUM: 'medium',
  LOW: 'low',
} as const;
export type ConfidenceLevel = (typeof ConfidenceLevel)[keyof typeof ConfidenceLevel];

/**
 * 置信度门限（03 文档 §6.8 Step4：累计置信度 ≥ 40% 的音素存在错误才上报）。
 * 低于此门限 → 不给总分，只给音素建议（04 文档 §5.6.1 规则③「宁可少给，不可给错」）
 */
export const CONFIDENCE_THRESHOLD = {
  /** 单音素上报错误所需的最低置信度累计比例 */
  REPORT_ERROR_MIN_CONFIDENCE: 0.4,
  /** 判定"可给出总分"的整体最低置信度 */
  SCORABLE_MIN_CONFIDENCE: 0.5,
  /** 参考音本身多音位歧义时的权重折扣（03 文档 §6.8 Step3） */
  AMBIGUOUS_PHONE_WEIGHT: 0.9,
} as const;

/**
 * 低分文案归因（04 文档 §5.6.1 规则④，🔴 不可协商的伦理底线）。
 * **严禁归因孩子能力**，只能归因环境。
 */
export const ScoreAttribution = {
  ENVIRONMENT_NOISE: 'environment_noise',
  ENVIRONMENT_DEVICE: 'environment_device',
  ENVIRONMENT_TOO_SHORT: 'environment_too_short',
  ENVIRONMENT_RECORDING_QUALITY: 'environment_recording_quality',
  /** 无有效归因时不给分，禁止编造能力归因 */
  UNKNOWN_SAFE: 'unknown_safe',
} as const;
export type ScoreAttribution = (typeof ScoreAttribution)[keyof typeof ScoreAttribution];

/** 星级评语档位（03 文档 §6.8：学生端只显示鼓励性反馈） */
export const ScorePraiseTier = {
  /** round(85..100) / 5 星 */
  EXCELLENT: 'excellent', // 很棒
  /** round(60..84) / 5 星 */
  GOOD: 'good', // 不错
  /** round(0..59) / 5 星 */
  KEEP_PRACTICING: 'keep_practicing', // 再练一次
} as const;
export type ScorePraiseTier = (typeof ScorePraiseTier)[keyof typeof ScorePraiseTier];

// ═══════════════════════════════════════════════════════════
// 评分公式版本（03 文档 §8.4 质量门禁：变更须 bump + 更新 golden）
// ═══════════════════════════════════════════════════════════

/**
 * 评分口径版本。**任何影响分数的改动都必须 bump 此值并同步更新
 * `test_scoring_golden.py` 的 golden fixture**，否则 CI 失败。
 * 目的：防止评分口径被无意改动（03 文档 §8.4）。
 */
export const SCORE_FORMULA_VERSION = '1.0.0';

/** 总分权重（03 文档 §6.8 Step7，经环境变量可覆盖） */
export const SCORE_WEIGHTS = {
  ACOUSTIC: 0.3,
  PER: 0.4,
  WER: 0.3,
} as const;

/** 音素编辑距离代价（03 文档 §6.8 Step2） */
export const PHONE_SUBSTITUTION_COST = {
  /** 完全相同 */
  IDENTICAL: 0.0,
  /** 同一大类（元音间/塞擦同类） */
  NEAR: 0.5,
  /** 其他 */
  FAR: 1.0,
  /** 删除/插入 */
  DEL_INS: 0.6,
} as const;

/**
 * 中国学习者常见音素容错对（03 文档 §6.8「音素大类容错」）。
 * 这些配对代价取 0.5 而非 1.0，**不视为"完全错"**。
 * 🔴 这是 04 文档 §9.1 风险 2「儿童/中式口音假阳性」的核心对策。
 */
export const CHINESE_LEARNER_PHONE_TOLERANCE: ReadonlyArray<readonly [string, string]> = [
  ['θ', 's'], ['ð', 'z'],
  ['θ', 'z'], ['ð', 's'],
  ['v', 'w'],
  ['l', 'r'],
  ['i', 'ɪ'],
  ['æ', 'e'],
  ['ʃ', 'ʒ'],
] as const;

// ═══════════════════════════════════════════════════════════
// 词频分级（03 文档 精华特性 #9：超高/高/中/低）
// ═══════════════════════════════════════════════════════════

export const FrequencyBand = {
  SUPER_HIGH: '超高',
  HIGH: '高',
  MEDIUM: '中',
  LOW: '低',
} as const;
export type FrequencyBand = (typeof FrequencyBand)[keyof typeof FrequencyBand];

export const FREQUENCY_BANDS: readonly FrequencyBand[] = [
  FrequencyBand.SUPER_HIGH,
  FrequencyBand.HIGH,
  FrequencyBand.MEDIUM,
  FrequencyBand.LOW,
];

// ═══════════════════════════════════════════════════════════
// 音标口音（REQ-004：全局切换，立即生效）
// ═══════════════════════════════════════════════════════════

export const Accent = {
  UK: 'uk',
  US: 'us',
} as const;
export type Accent = (typeof Accent)[keyof typeof Accent];

// ═══════════════════════════════════════════════════════════
// 听写四色（REQ-007 / 03 文档 §5.5 交互 #9）
// ═══════════════════════════════════════════════════════════

export const DictationColor = {
  GREEN: 'correct',   // 绿 = 对
  RED: 'wrong',       // 红 = 错
  YELLOW: 'missing',  // 黄 = 漏
  BLUE: 'extra',      // 蓝 = 多
} as const;
export type DictationColor = (typeof DictationColor)[keyof typeof DictationColor];

// ═══════════════════════════════════════════════════════════
// 音素五色着色（03 文档 §5.5 交互 #4）
// ═══════════════════════════════════════════════════════════

export const PhonemeColor = {
  RED: 'wrong',        // 红 = 错
  ORANGE: 'near',      // 橙 = 近似
  YELLOW: 'missing',   // 黄 = 缺
  GREEN: 'correct',    // 绿 = 对
  BLUE: 'word_final',  // 蓝 = 词尾降权
} as const;
export type PhonemeColor = (typeof PhonemeColor)[keyof typeof PhonemeColor];

/** 音素比对操作类型（03 文档 §6.8 Step2-3） */
export const PhoneOp = {
  MATCH: 'match',           // 完全相同
  SUBSTITUTION: 'substitution', // 替换
  DELETION: 'deletion',     // 缺失
  INSERTION: 'insertion',   // 多出
} as const;
export type PhoneOp = (typeof PhoneOp)[keyof typeof PhoneOp];

// ═══════════════════════════════════════════════════════════
// 角色（03 文档 §3.1 auth 模块：三角色）
// ═══════════════════════════════════════════════════════════

export const Role = {
  STUDENT: 'student',
  PARENT: 'parent',
  TEACHER: 'teacher',
  /** 首注册自动成为 admin（03 文档 §5.1 /auth/register） */
  ADMIN: 'admin',
} as const;
export type Role = (typeof Role)[keyof typeof Role];

export const ROLES: readonly Role[] = [Role.STUDENT, Role.PARENT, Role.TEACHER, Role.ADMIN];

// ═══════════════════════════════════════════════════════════
// 语音能力等级（04 文档 §5.1：L1~L5）
// ═══════════════════════════════════════════════════════════

export const SpeechLevel = {
  L1_WORD: 'L1',        // 单词跟读
  L2_SENTENCE: 'L2',    // 句子跟读
  L3_DIALOGUE: 'L3',    // 情景对话
  L4_FREE: 'L4',        // 自由对话
  L5_SPEECH: 'L5',      // 演讲/答辩
} as const;
export type SpeechLevel = (typeof SpeechLevel)[keyof typeof SpeechLevel];

/** 升级规则（04 文档 §5.1）：连续 3 次 ≥4 星 + 样本 ≥10 条 */
export const SPEECH_LEVEL_UP = {
  MIN_CONSECUTIVE_4STAR: 3,
  MIN_SAMPLES: 10,
  /** 跳跃限制：L1→L4 禁止直接跳 */
  ALLOW_SKIP: false,
} as const;

// ═══════════════════════════════════════════════════════════
// 错误样本生命周期（03 文档 §1.10 职责 2 / 精华特性 #8）
// ═══════════════════════════════════════════════════════════

export const ERROR_SAMPLE_RETENTION_DAYS = {
  /** 发音错误样本（录音）→ 7 天 */
  SPEAK: 7,
  /** 拼写错误样本 → 90 天 */
  SPELL: 90,
  /** 普通跟读录音 → 30 天（04 文档 §7.9） */
  RECORDING: 30,
  /** 到期前 1 天生成回放提醒 */
  REMIND_BEFORE_DAYS: 1,
  /** 单日错误 > 20 提升为高优先级并纳入 leech 干预 */
  HIGH_PRIORITY_THRESHOLD: 20,
} as const;

// ═══════════════════════════════════════════════════════════
// 学习记录类型（03 文档 §4.2.6 统一大表）
// ═══════════════════════════════════════════════════════════

export const RecordKind = {
  /** 5 词循环 */
  WORD_CARD: 'word_card',
  /** 拼写默写 */
  SPELL: 'spell',
  /** 听写 */
  DICTATION: 'dictation',
  /** 跟读 */
  SHADOWING: 'shadowing',
  /** 单词跟读（L1） */
  PRONOUNCE: 'pronounce',
  /** 句子跟读（L2） */
  SENTENCE: 'sentence',
  /** AI 对话 */
  CONVERSATION: 'conversation',
  /** 听音辨词 */
  LISTEN_IDENTIFY: 'listen_identify',
} as const;
export type RecordKind = (typeof RecordKind)[keyof typeof RecordKind];

/** 错题类型（03 文档 §3.1 errorbook：语音/拼写/语法三类） */
export const ErrorCategory = {
  SPEAK: 'speak',
  SPELL: 'spell',
  GRAMMAR: 'grammar',
} as const;
export type ErrorCategory = (typeof ErrorCategory)[keyof typeof ErrorCategory];

/** 5 词循环题型（02 文档 REQ-007） */
export const ExerciseKind = {
  /** W 单词卡 */
  WORD_CARD: 'W',
  /** S 拼写默写 */
  SPELL: 'S',
  /** P 听写 */
  DICTATION: 'P',
  /** M 首字母填空/完形填空 —— 🔶 MVP 不实现（P2，见 CONTRIBUTING.md D-11） */
  CLOZE: 'M',
} as const;
export type ExerciseKind = (typeof ExerciseKind)[keyof typeof ExerciseKind];

// ═══════════════════════════════════════════════════════════
// 音频硬门禁（04 文档 §5.6.1 规则② + 03 文档 §7.8 优化 6）
// ═══════════════════════════════════════════════════════════

export const AUDIO_LIMITS = {
  /** < 0.5s 不给分 */
  MIN_DURATION_SEC: 0.5,
  /** > 15s 直接拒绝（422 speech_too_long） */
  MAX_DURATION_SEC: 15,
  /** 上传大小上限 64MB（03 文档 §8.5 安全测试③） */
  MAX_UPLOAD_BYTES: 64 * 1024 * 1024,
  /** Whisper/wav2vec2 唯一可靠输入格式 */
  SAMPLE_RATE: 16000,
  CHANNELS: 1,
  SAMPLE_FORMAT: 'pcm_s16le',
} as const;

// ═══════════════════════════════════════════════════════════
// 变速档位（REQ-006：0.5-2× 8 档连续可调，变速不变调）
// ═══════════════════════════════════════════════════════════

export const PLAYBACK_RATES = [0.5, 0.75, 0.9, 1.0, 1.25, 1.5, 1.75, 2.0] as const;
export type PlaybackRate = (typeof PLAYBACK_RATES)[number];

/** 影子跟练配置（REQ-006 / 03 文档 §5.5 交互 #8：5 步渐进） */
export const SHADOWING_DEFAULTS = {
  RATE: 1.0,
  /** 间隔 3s→1s 渐进 */
  INTERVAL_SEC: 3,
  MIN_INTERVAL_SEC: 1,
  /** 遍数 1→3 渐进 */
  LOOPS: 1,
  MAX_LOOPS: 3,
} as const;

// ═══════════════════════════════════════════════════════════
// 报告导出（REQ-013：PNG 长图 + CSV，04 文档 Q2 已确认）
// ═══════════════════════════════════════════════════════════

export const ReportFormat = {
  /** 🔶 邢工 2026-10-05 确认：PNG 长图（Canvas 渲染） */
  PNG: 'png',
  /** 恒定保留，UTF-8 with BOM */
  CSV: 'csv',
  /** 🔶 文档差异点，见 CONTRIBUTING.md D-12：03 文档写 Excel/PDF，04 文档 REQ-013 确认 PNG */
} as const;
export type ReportFormat = (typeof ReportFormat)[keyof typeof ReportFormat];

/** CSV 必须带 BOM，保证 Excel 打开中文不乱码（04 文档 Q2） */
export const CSV_BOM = '﻿';
export const CSV_ENCODING = 'utf-8';

/** 热力图周数（REQ-010：12 周热力图，跨月不清零） */
export const HEATMAP_WEEKS = 12;

/** 错词 Top N（REQ-012 家长后台） */
export const PARENT_WEEKLY_REPORT = {
  TOP_ERROR_WORDS: 10,
  TOP_PHONE_WEAKNESS: 10, // 音素 Top-N 弱项
} as const;
