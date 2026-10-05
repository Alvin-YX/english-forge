/**
 * 学段种子数据 —— 6 个学段（04 文档 §4.7 / 附录 B）
 *
 * 🔶 MVP 只实现 **小学 3-6（primary）** 与 **初中（junior）**，
 *    其余 4 段 `enabledInMvp = false`（04 文档 §8.2 负向清单）。
 *    小学 1-2（primary_low）v1.0 仅在兴趣模块做「听+跟读」，不做学科同步。
 */

import { StageCode } from '@eng-forge/contracts/types';

export interface StageSeed {
  readonly code: StageCode;
  readonly nameZh: string;
  readonly nameEn: string;
  readonly sortOrder: number;
  readonly enabledInMvp: boolean;
  /** 建议起始年龄（04 文档 §4.7 规则6：年龄下限 6 岁） */
  readonly minAge: number;
  readonly maxAge: number;
  /**
   * v1.0 未实现学段的强制提示文案（前端必须展示，不能静默降级为「没有课程」）。
   * 参考 types/index.ts `Stage.disclaimer`。
   */
  readonly disclaimer?: string;
}

/**
 * 6 个学段。
 *
 * ⚠️ 与 03 文档 §4.2.2 的差异（已在 schema/taxonomy.ts 登记）：
 *    文档 CHECK 只有 5 个 code 且用 `university`；此处按 contracts 用
 *    6 个 code 且大学为 `college`。
 */
export const STAGES: readonly StageSeed[] = [
  {
    code: StageCode.PRIMARY_LOW,
    nameZh: '小学 1-2 年级',
    nameEn: 'Primary Lower (G1-G2)',
    sortOrder: 1,
    enabledInMvp: false,
    minAge: 6,
    maxAge: 8,
    disclaimer: '小学 1-2 年级暂未提供学科同步课程，仅含「听 + 跟读」兴趣模块。',
  },
  {
    code: StageCode.PRIMARY,
    nameZh: '小学 3-6 年级',
    nameEn: 'Primary (G3-G6)',
    sortOrder: 2,
    enabledInMvp: true,
    minAge: 8,
    maxAge: 12,
  },
  {
    code: StageCode.JUNIOR,
    nameZh: '初中',
    nameEn: 'Junior High',
    sortOrder: 3,
    enabledInMvp: true,
    minAge: 12,
    maxAge: 15,
  },
  {
    code: StageCode.SENIOR,
    nameZh: '高中',
    nameEn: 'Senior High',
    sortOrder: 4,
    enabledInMvp: false,
    minAge: 15,
    maxAge: 18,
    disclaimer: '高中内容计划 v1.1 开放，当前仅可预览小学与初中课程。',
  },
  {
    code: StageCode.COLLEGE,
    nameZh: '大学',
    nameEn: 'College',
    sortOrder: 5,
    enabledInMvp: false,
    minAge: 18,
    maxAge: 24,
    disclaimer: '大学内容计划 v1.1 开放（含四六级与雅思托福词库）。',
  },
  {
    code: StageCode.ADULT,
    nameZh: '成人',
    nameEn: 'Adult',
    sortOrder: 6,
    enabledInMvp: false,
    minAge: 18,
    maxAge: 120,
    disclaimer: '成人内容计划 v1.1 开放（含口语陪练与面试场景）。',
  },
] as const;

/** MVP 开放的学段 code（前端首页只展示这些） */
export const MVP_STAGE_CODES: readonly StageCode[] = STAGES.filter((s) => s.enabledInMvp).map(
  (s) => s.code,
);

export const isStageEnabledInMvp = (code: StageCode): boolean =>
  STAGES.find((s) => s.code === code)?.enabledInMvp ?? false;
