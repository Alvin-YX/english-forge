/**
 * 权限矩阵种子 —— 11 项功能 × 4 角色（03 文档 §4.2.12 `permission_matrix`）
 *
 * 11 项功能对齐 word-teacher：dashboard / student_manage / class_manage /
 * shadowing_record / scenario_manage / wordpack_manage / game_record /
 * error_track / progress_track / report_export / settings
 *
 * ⚠️ 04 文档 §9.4 裁决 REQ-011：账号隔离改为**架构保证**（`profile_id` 中间件
 *    强制注入），权限层划到 v2.0。因此本矩阵是**功能级开关**，
 *    **不是**数据级隔离依据 —— 数据可见性由 `parent_children` + 中间件保证。
 */

import { Role } from '@eng-forge/contracts/enums';

/** 11 项功能（顺序即后台展示顺序） */
export const PERMISSION_FEATURES = [
  'dashboard',
  'student_manage',
  'class_manage',
  'shadowing_record',
  'scenario_manage',
  'wordpack_manage',
  'game_record',
  'error_track',
  'progress_track',
  'report_export',
  'settings',
] as const;

export type PermissionFeature = (typeof PERMISSION_FEATURES)[number];

export interface PermissionSeed {
  readonly role: Role;
  readonly feature: PermissionFeature;
  readonly canRead: boolean;
  readonly canWrite: boolean;
}

/** 按角色分组声明，比 44 条平铺更可读，且能保证 11 项一项不漏 */
const ADMIN_FEATURES: readonly PermissionFeature[] = PERMISSION_FEATURES;
const TEACHER_FEATURES: readonly PermissionFeature[] = PERMISSION_FEATURES;
const PARENT_FEATURES: readonly PermissionFeature[] = [
  'dashboard',
  'shadowing_record',
  'error_track',
  'progress_track',
  'report_export',
];
const STUDENT_FEATURES: readonly PermissionFeature[] = [
  'dashboard',
  'shadowing_record',
  'game_record',
  'error_track',
  'progress_track',
];

const toRows = (
  role: Role,
  readable: readonly PermissionFeature[],
  writable: readonly PermissionFeature[],
): readonly PermissionSeed[] =>
  PERMISSION_FEATURES.map((feature) => ({
    role,
    feature,
    canRead: readable.includes(feature),
    canWrite: writable.includes(feature),
  }));

/**
 * 完整矩阵 = 4 角色 × 11 功能 = 44 行。
 *
 * 角色能力边界（对齐 03 文档 §3.1 auth 的三角色 + admin）：
 * - `admin`：全读写（首注册自动获得，§5.1）
 * - `teacher`：全读写（家长后台之外的教学侧；`settings` 只读，避免改全局配置）
 * - `parent`：**只读**孩子的学习数据 + 可导出报告；
 *   绝不能有 `student_manage` / `class_manage` / `wordpack_manage` 写权限
 *   —— 家长改教材词表属越权（04 文档 §9.2 未成年人数据边界）
 * - `student`：只看自己的学习数据，可跟读/玩游戏/看错题本
 */
export const PERMISSION_MATRIX: readonly PermissionSeed[] = [
  ...toRows(Role.ADMIN, ADMIN_FEATURES, ADMIN_FEATURES),
  ...toRows(Role.TEACHER, TEACHER_FEATURES, [
    ...TEACHER_FEATURES.filter((f) => f !== 'settings'),
  ]),
  ...toRows(Role.PARENT, PARENT_FEATURES, ['report_export']),
  ...toRows(Role.STUDENT, STUDENT_FEATURES, [
    'shadowing_record',
    'game_record',
    'error_track',
    'progress_track',
  ]),
] as const;

/** 权限查询：某角色是否有某功能的读/写权限（默认 false —— 拒绝优先） */
export const can = (role: Role, feature: PermissionFeature, write = false): boolean => {
  const row = PERMISSION_MATRIX.find((r) => r.role === role && r.feature === feature);
  return write ? (row?.canWrite ?? false) : (row?.canRead ?? false);
};
