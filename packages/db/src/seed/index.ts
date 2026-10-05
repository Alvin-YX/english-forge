/**
 * 种子数据统一入口 —— `pnpm --filter @eng-forge/db seed`
 *
 * 🔴 幂等：全部使用 `ON CONFLICT DO UPDATE/NOTHING`，重复执行结果一致
 *    （03 文档 §8.5 集成测试⑦「迁移幂等」对 seed 的同款要求）。
 *
 * 🔴 不写教材内容：本入口只写学段、教材骨架、权限矩阵（见 textbooks.ts 顶部说明）。
 */

import { StageCode, TextbookCode } from '@eng-forge/contracts/types';

import { PERMISSION_MATRIX, PERMISSION_FEATURES } from './permissions.js';
import { STAGES, MVP_STAGE_CODES, isStageEnabledInMvp } from './stages.js';
import {
  PLACEHOLDER_UNITS_PER_VOLUME,
  TEXTBOOKS,
  TOTAL_VOLUMES,
  VOLUMES,
  buildPlaceholderUnits,
  textbookUniqueCode,
} from './textbooks.js';

export * from './permissions.js';
export * from './stages.js';
export * from './textbooks.js';

export { StageCode, TextbookCode };

/** 种子数据统计（供 CLI 输出与测试断言） */
export interface SeedSummary {
  readonly stages: number;
  readonly textbooks: number;
  readonly volumes: number;
  readonly units: number;
  readonly permissions: number;
}

export const SEED_SUMMARY: SeedSummary = {
  stages: STAGES.length,
  textbooks: TEXTBOOKS.length,
  volumes: TOTAL_VOLUMES,
  units: TOTAL_VOLUMES * PLACEHOLDER_UNITS_PER_VOLUME,
  permissions: PERMISSION_MATRIX.length,
};

/** 教材骨架扁平化后的册次（32 条），供 CLI 批量插入 */
export const buildVolumeSeeds = (): ReadonlyArray<{
  textbookCode: string;
  code: string;
  nameZh: string;
  index: number;
  grade: number;
  term: 1 | 2;
}> =>
  TEXTBOOKS.flatMap((tb) => {
    const tbCode = textbookUniqueCode(tb);
    return VOLUMES.map((v) => ({
      textbookCode: tbCode,
      code: v.code,
      nameZh: v.nameZh,
      index: v.index,
      grade: v.grade,
      term: v.term,
    }));
  });

/** 教材骨架扁平化后的单元（32 册 × 6 = 192 条占位） */
export const buildUnitSeeds = (): ReadonlyArray<{
  textbookCode: string;
  volumeCode: string;
  code: string;
  nameZh: string;
  sortOrder: number;
}> =>
  TEXTBOOKS.flatMap((tb) => {
    const tbCode = textbookUniqueCode(tb);
    return VOLUMES.flatMap((v) =>
      buildPlaceholderUnits(v.code).map((u) => ({
        textbookCode: tbCode,
        volumeCode: v.code,
        code: u.code,
        nameZh: u.nameZh,
        sortOrder: u.sortOrder,
      })),
    );
  });

export { MVP_STAGE_CODES, isStageEnabledInMvp, PERMISSION_FEATURES };
