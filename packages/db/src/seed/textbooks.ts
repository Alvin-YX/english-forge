/**
 * 教材骨架种子 —— 4 版本 × 8 册 = 32 册（04 文档 第 10 章 Q3 邢工确认「全涵盖」）
 *
 * 🔴 版权红线：本文件**只建骨架结构**（学段/版本/册次/单元占位），
 *    **不含任何教材原文、词条、例句**。词条是独立 ETL 任务，且每条必须携带
 *    license + source（04 文档 §9.3）。教材内容默认 `is_official = true`
 *    → 标记为「需授权」，用户在后台自行导入。
 *
 * 册次构成：小学 3~6 年级 × 上/下册 = 8 册（g3a g3b g4a g4b g5a g5b g6a g6b）
 */

import { StageCode, TextbookCode } from '@eng-forge/contracts/types';

/** 教材版本骨架 */
export interface TextbookSeed {
  readonly code: TextbookCode;
  readonly nameZh: string;
  readonly nameEn: string;
  readonly publisher: string;
  /** 仅小学 3-6 有 8 册；初中/高中另按学段规划（本次只建小学段） */
  readonly stage: StageCode;
  readonly enabledInMvp: boolean;
  /** 册数（本次统一 8） */
  readonly volumeCount: number;
}

export const TEXTBOOKS: readonly TextbookSeed[] = [
  {
    code: TextbookCode.PEP,
    nameZh: '人教版 PEP',
    nameEn: 'PEP (People’s Education Press)',
    publisher: '人民教育出版社',
    stage: StageCode.PRIMARY,
    enabledInMvp: true,
    volumeCount: 8,
  },
  {
    code: TextbookCode.FLTRP,
    nameZh: '外研版',
    nameEn: 'FLTRP (Foreign Language Teaching and Research Press)',
    publisher: '外语教学与研究出版社',
    stage: StageCode.PRIMARY,
    enabledInMvp: true,
    volumeCount: 8,
  },
  {
    code: TextbookCode.BNU,
    nameZh: '北师大版',
    nameEn: 'BNU (Beijing Normal University Press)',
    publisher: '北京师范大学出版社',
    stage: StageCode.PRIMARY,
    enabledInMvp: true,
    volumeCount: 8,
  },
  {
    code: TextbookCode.SUE,
    nameZh: '苏教版',
    nameEn: 'SUE (Jiangsu Education Press)',
    publisher: '江苏凤凰教育出版社',
    stage: StageCode.PRIMARY,
    enabledInMvp: true,
    volumeCount: 8,
  },
] as const;

/** 册次定义（3~6 年级 × 上/下册） */
export interface VolumeSeed {
  /** 全局唯一 code：`g3a` / `g3b` …（§4.2.2 volume.code） */
  readonly code: string;
  readonly nameZh: string;
  /** 册序号 1~8 */
  readonly index: number;
  readonly grade: number;
  /** 上册 = 1，下册 = 2 */
  readonly term: 1 | 2;
}

export const VOLUMES: readonly VolumeSeed[] = [
  { code: 'g3a', nameZh: '三年级上册', index: 1, grade: 3, term: 1 },
  { code: 'g3b', nameZh: '三年级下册', index: 2, grade: 3, term: 2 },
  { code: 'g4a', nameZh: '四年级上册', index: 3, grade: 4, term: 1 },
  { code: 'g4b', nameZh: '四年级下册', index: 4, grade: 4, term: 2 },
  { code: 'g5a', nameZh: '五年级上册', index: 5, grade: 5, term: 1 },
  { code: 'g5b', nameZh: '五年级下册', index: 6, grade: 5, term: 2 },
  { code: 'g6a', nameZh: '六年级上册', index: 7, grade: 6, term: 1 },
  { code: 'g6b', nameZh: '六年级下册', index: 8, grade: 6, term: 2 },
] as const;

/**
 * 🔶 单元占位数量。
 *
 * 取舍说明：03 文档没有给出各教材的真实单元数（且真实单元结构属教材内容，
 * 与版权红线相邻）。这里对每册**先建 6 个占位单元**（`Unit 1`~`Unit 6` +
 * 小学 PEP 常见的 `Welcome Unit` 计入其中），保证：
 *   - 五级 schema 链路（stage→textbook→volume→unit）可端到端跑通
 *   - 单元词表接口（`GET /volumes/:id/units`）有数据可返回
 *   - 词条 ETL 导入时有稳定的父节点可挂载（按 `code` upsert，不依赖名称）
 *
 * 🔴 真实单元划分与单元名**必须**由用户导入教材词表时一并提供，
 *    或由独立 ETL 任务按授权数据填充 —— 不得在此处臆造教材真实目录。
 */
export const PLACEHOLDER_UNITS_PER_VOLUME = 6;

/** 生成某册的占位单元 */
export const buildPlaceholderUnits = (
  volumeCode: string,
  count: number = PLACEHOLDER_UNITS_PER_VOLUME,
): ReadonlyArray<{ code: string; nameZh: string; sortOrder: number }> =>
  Array.from({ length: count }, (_, i) => ({
    // 册内唯一 code：`<volumeCode>-u1`，避免跨册重名
    code: `${volumeCode}-u${i + 1}`,
    nameZh: `Unit ${i + 1}`,
    sortOrder: i + 1,
  }));

/** 教材骨架总量（测试用：4 × 8 = 32） */
export const TOTAL_VOLUMES: number = TEXTBOOKS.reduce(
  (sum, tb) => sum + tb.volumeCount,
  0,
);

/** 教材 code 的全局唯一形式（`textbook.code` 全库唯一，需带学段前缀） */
export const textbookUniqueCode = (tb: TextbookSeed): string => `${tb.stage}-${tb.code}`;

/** 教材的默认许可标记（🔴 提醒：正式教材内容需用户自行取得授权） */
export const TEXTBOOK_LICENSE_PLACEHOLDER = 'pending-user-authorization';
/** 教材词表来源标记 */
export const TEXTBOOK_SOURCE_PLACEHOLDER = 'skeleton-no-content';
