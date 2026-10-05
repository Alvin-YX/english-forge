/**
 * 学段 / 教材 / 册次 / 单元 —— 03 文档 §5.2（五级内容骨架）
 *
 * 🔴 分类数据是**公共数据**（全 profile 共享），因此：
 *   - 四个列表方法**不做** profileId 过滤（`stage` / `textbook` / `volume` / `unit`
 *     表里没有归属列，加了也是无效条件）；
 *   - 唯一例外是 `getEnrollment()`：选课关系属于个人，必须经 `profileWhere()` 过滤。
 *
 * 版权红线：本模块只返回骨架结构（code / 名称 / 排序），
 *   不含任何教材原文；词条内容由独立 ETL 导入并携带 license + source。
 *
 * 🔴 算子必须从 `../../infra/db/query.js` 取用，禁止直连 `drizzle-orm`
 *    （depcruise 规则 `profile-scope-chokepoint`）。
 */

import { enrollment, stage, textbook, unit, volume } from '@eng-forge/db/schema';
import { Inject, Injectable } from '@nestjs/common';

import { DbConnection } from '../../infra/db/db.module.js';
import { asc, eq } from '../../infra/db/query.js';
import { profileWhere, type ProfileScope } from '../../infra/profile/profile-scope.js';

// ═══════════════════════════════════════════════════════════
// View 类型（API 边界形状，不含内部列 min_age / license 等）
// ═══════════════════════════════════════════════════════════

export interface StageView {
  id: number;
  code: string;
  nameZh: string;
  nameEn: string;
  sortOrder: number;
  enabledInMvp: boolean;
}

export interface TextbookView {
  id: number;
  stageId: number;
  code: string;
  nameZh: string;
  nameEn?: string;
  region: string;
  isOfficial: boolean;
  enabledInMvp: boolean;
}

export interface VolumeView {
  id: number;
  textbookId: number;
  code: string;
  nameZh: string;
  grade?: number;
  term?: number;
  sortOrder: number;
}

export interface UnitView {
  id: number;
  volumeId: number;
  code: string;
  nameZh: string;
  nameEn?: string;
  wordCount: number;
  sortOrder: number;
}

export interface EnrollmentView {
  id: number;
  userId: number;
  stageId: number;
  currentVolumeId?: number;
  currentUnitId?: number;
  status: string;
  startedAt: string;
}

@Injectable()
export class TaxonomyService {
  constructor(@Inject(DbConnection) private readonly conn: DbConnection) {}

  /** 学段列表（公共数据） */
  async listStages(): Promise<StageView[]> {
    const rows = await this.conn.db
      .select({
        id: stage.id,
        code: stage.code,
        nameZh: stage.nameZh,
        nameEn: stage.nameEn,
        sortOrder: stage.sortOrder,
        enabledInMvp: stage.enabledInMvp,
      })
      .from(stage)
      .orderBy(asc(stage.sortOrder));
    return rows;
  }

  /**
   * 教材列表（公共数据），可选按学段过滤。
   *
   * 🔶 `textbook` 表没有 `sort_order` 列（schema 事实，不擅自补列），
   *    故按 `stage_id, code` 排序 —— 同学段内按 code 字典序，跨学段按学段归类。
   */
  async listTextbooks(stageId?: number): Promise<TextbookView[]> {
    const rows = await this.conn.db
      .select()
      .from(textbook)
      .where(stageId === undefined ? undefined : eq(textbook.stageId, stageId))
      .orderBy(asc(textbook.stageId), asc(textbook.code));

    return rows.map((row) => ({
      id: row.id,
      stageId: row.stageId,
      code: row.code,
      nameZh: row.nameZh,
      nameEn: row.nameEn ?? undefined,
      region: row.region,
      isOfficial: row.isOfficial,
      enabledInMvp: row.enabledInMvp,
    }));
  }

  /** 册次列表（公共数据） */
  async listVolumes(textbookId: number): Promise<VolumeView[]> {
    const rows = await this.conn.db
      .select()
      .from(volume)
      .where(eq(volume.textbookId, textbookId))
      .orderBy(asc(volume.sortOrder));

    return rows.map((row) => ({
      id: row.id,
      textbookId: row.textbookId,
      code: row.code,
      nameZh: row.nameZh,
      grade: row.grade ?? undefined,
      term: row.term ?? undefined,
      sortOrder: row.sortOrder,
    }));
  }

  /** 单元列表（公共数据） */
  async listUnits(volumeId: number): Promise<UnitView[]> {
    const rows = await this.conn.db
      .select()
      .from(unit)
      .where(eq(unit.volumeId, volumeId))
      .orderBy(asc(unit.sortOrder));

    return rows.map((row) => ({
      id: row.id,
      volumeId: row.volumeId,
      code: row.code,
      nameZh: row.nameZh,
      nameEn: row.nameEn ?? undefined,
      wordCount: row.wordCount,
      sortOrder: row.sortOrder,
    }));
  }

  /**
   * 当前档案在某学段上的选课关系。
   *
   * 🔴 这是本模块唯一按档案隔离的查询：`enrollment.user_id` 列语义上装的是
   *    「档案 id」（schema 偏差，见 `profile-scope.ts` 顶部注释），
   *    故过滤值取 `scope.profileId`，且必须经 `profileWhere()` 进入 where。
   */
  async getEnrollment(scope: ProfileScope, stageId: number): Promise<EnrollmentView | null> {
    const rows = await this.conn.db
      .select()
      .from(enrollment)
      .where(profileWhere(scope, enrollment.userId, eq(enrollment.stageId, stageId)))
      .limit(1);

    const row = rows[0];
    if (row === undefined) return null;

    return {
      id: row.id,
      userId: row.userId,
      stageId: row.stageId,
      currentVolumeId: row.currentVolumeId ?? undefined,
      currentUnitId: row.currentUnitId ?? undefined,
      status: row.status,
      startedAt: row.startedAt.toISOString(),
    };
  }
}
