/**
 * 统一响应体 —— 03 文档 §5 全 API 共用
 *
 * 约定见 CONTRIBUTING.md §3：API 响应包装 `{ code, message, data }`
 * HTTP 状态码仍按语义返回（200/201/202/4xx/5xx），code 用于前端精细分支。
 */

/** 业务错误码分段规则（CONTRIBUTING.md §3） */
export const ErrorCode = {
  // ── 0xxx 通用 ────────────────────────────────────────────
  OK: 0,
  UNKNOWN_ERROR: 1,
  VALIDATION_FAILED: 1001,
  RESOURCE_NOT_FOUND: 1002,
  DUPLICATE_RESOURCE: 1003,
  OPERATION_NOT_ALLOWED: 1004,
  RATE_LIMITED: 1005,
  IDEMPOTENCY_CONFLICT: 1006,

  // ── 1xxx 认证与授权 ──────────────────────────────────────
  UNAUTHENTICATED: 1101,
  TOKEN_EXPIRED: 1102,
  TOKEN_INVALID: 1103,
  FORBIDDEN: 1104,
  CREDENTIALS_INVALID: 1105,
  RBAC_DENIED: 1106,
  PROFILE_FORBIDDEN: 1107, // 跨 profile 访问（架构级隔离，03 文档 REQ-011）
  USERNAME_TAKEN: 1108, // 注册时用户名已被占用
  ACCOUNT_DISABLED: 1109, // 账号已被禁用

  // ── 2xxx 词库与教材 ──────────────────────────────────────
  STAGE_NOT_FOUND: 2001,
  TEXTBOOK_NOT_FOUND: 2002,
  VOLUME_NOT_FOUND: 2003,
  UNIT_NOT_FOUND: 2004,
  WORD_NOT_FOUND: 2005,
  IMPORT_FAILED: 2006,
  IMPORT_JOB_NOT_FOUND: 2007,
  DSL_INVALID: 2008,
  DSL_CYCLE_DETECTED: 2009,
  LICENSE_FIELD_MISSING: 2010, // 版权红线：license/source 必填（03 文档 §4.2.3）

  // ── 3xxx 练习与评分 ──────────────────────────────────────
  RECORDING_NOT_FOUND: 3001,
  RECORDING_TOO_LARGE: 3002,
  AUDIO_INVALID: 3003,
  SPEECH_TOO_LONG: 3004, // > 15s 硬门禁（03 文档 §7.8 优化 6）
  AUDIO_TOO_SHORT: 3005, // < 0.5s 不给分（04 文档 §5.6.1 规则②）
  NOISE_ABNORMAL: 3006,
  SCORING_FAILED: 3007,
  SCORE_CONFIDENCE_TOO_LOW: 3008, // 低置信不给总分（规则③）
  SCORING_DEGRADED: 3009, // 已降级返回（C-F 级，03 文档 §5.6.3）
  SCORING_PARTIAL: 3010, // 800ms partial 结果
  SPELL_NOT_GRADED: 3011,
  BLOCK_NOT_GENERATED: 3012,
  NO_BLOCK_AVAILABLE: 3013,

  // ── 4xxx AI 对话 ─────────────────────────────────────────
  CONVERSATION_NOT_FOUND: 4001,
  LLM_UNAVAILABLE: 4002, // 三级降级到规则兜底仍失败
  LLM_TIMEOUT: 4003,
  LLM_QUOTA_EXCEEDED: 4004,
  LLM_NOT_CONFIGURED: 4005, // 未配置 API Key
  LLM_PARSE_FAILED: 4006,
  CONVERSATION_MODE_INVALID: 4007,

  // ── 5xxx 统计与报告 ──────────────────────────────────────
  STATS_NOT_READY: 5001,
  REPORT_GENERATION_FAILED: 5002,
  EXPORT_FAILED: 5003,
  CANVAS_RENDER_FAILED: 5004, // PNG 长图渲染失败

  // ── 6xxx 媒体与系统 ──────────────────────────────────────
  MEDIA_NOT_FOUND: 6001,
  MEDIA_PATH_INVALID: 6002, // 路径穿越防护（03 文档 §8.5 安全测试②）
  TTS_FAILED: 6003,
  GC_FAILED: 6004,
  PERF_TIER_UNAVAILABLE: 6005,
  SYSTEM_NOT_INITIALIZED: 6006,
  MIGRATION_FAILED: 6007,
} as const;

export type ErrorCodeValue = (typeof ErrorCode)[keyof typeof ErrorCode];

/** 统一响应体 */
export interface ApiResponse<T> {
  code: ErrorCodeValue;
  message: string;
  data: T;
  /** 仅错误时返回：便于前端定位与日志追踪 */
  traceId?: string;
}

/** 分页请求参数（03 文档 §5 各列表接口统一） */
export interface PageQuery {
  page?: number; // 1-based
  pageSize?: number; // 默认 20，上限 100
}

/** 分页响应 */
export interface PageResult<T> {
  items: T[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
}

/** SSE 事件包络（跟读评分进度、对话流式） */
export interface SseEvent<T> {
  /** 事件类型：transcode/align/scoring/complete/error */
  event: string;
  /** 事件 ID，用于断线续传（Last-Event-ID） */
  id?: string;
  data: T;
}
