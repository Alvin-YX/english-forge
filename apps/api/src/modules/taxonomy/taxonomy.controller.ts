/**
 * 学段 / 教材 / 册次 / 单元 端点 —— 03 文档 §5.2
 *
 * 🔴 全部 `@Public()`：分类数据是全 profile 共享的公共数据，
 *    且前端**未登录**状态就要能展示教材选择页（03 文档 §5.1 白名单），
 *    否则新用户注册前看到的是空白页。
 *
 * 🔴 只读、无写入接口：骨架结构由 ETL/seed 灌入，
 *    不允许任何客户端通过 API 修改分类树（改分类会连带影响所有用户的进度游标）。
 *
 * 🔶 本模块**不**暴露 `getEnrollment()`：选课关系属于个人数据，
 *    需经 `@CurrentUser()` 取档案作用域，按 03 文档 §5 归入 `/me/*` 路由族。
 */

import { Controller, Get, Inject, Param, Query } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { z } from 'zod';

import { zodPipe } from '../../common/zod-validation.pipe.js';
import { Public } from '../../infra/profile/public.decorator.js';

import {
  type StageView,
  type TextbookView,
  type UnitView,
  type VolumeView,
  TaxonomyService,
} from './taxonomy.service.js';

/**
 * 路径/查询里的 id —— 必须收窄为正整数。
 *
 * 🔴 不能只靠 `Number()`：`Number('1.5')` 是 1.5、`Number('')` 是 0、
 *    `Number('abc')` 是 NaN，三者都不会报错，会静默生成一条永不匹配的 SQL。
 */
const POSITIVE_INT = z.coerce.number().int().positive();

/** `?stageId=` 可选：缺省/空串 = 不过滤 */
const OPTIONAL_STAGE_ID = POSITIVE_INT.optional().or(z.literal('')).transform((v) => (v === '' ? undefined : v));

@Controller('taxonomy')
@ApiTags('taxonomy')
export class TaxonomyController {
  constructor(@Inject(TaxonomyService) private readonly service: TaxonomyService) {}

  /** 学段列表（小学低段 / 小学 / 初中 / 高中 / 大学 / 成人） */
  @Public()
  @Get('stages')
  @ApiOperation({ summary: '学段列表（公共）' })
  stages(): Promise<StageView[]> {
    return this.service.listStages();
  }

  /** 教材列表，可选 `?stageId=` 按学段过滤 */
  @Public()
  @Get('textbooks')
  @ApiOperation({ summary: '教材列表（公共），可选 stageId 过滤' })
  textbooks(@Query('stageId', zodPipe(OPTIONAL_STAGE_ID)) stageId?: number): Promise<TextbookView[]> {
    return this.service.listTextbooks(stageId);
  }

  /** 册次列表（三上 / 三下 / 七下 / 必修一 …） */
  @Public()
  @Get('volumes/:textbookId')
  @ApiOperation({ summary: '册次列表（公共）' })
  volumes(@Param('textbookId', zodPipe(POSITIVE_INT)) textbookId: number): Promise<VolumeView[]> {
    return this.service.listVolumes(textbookId);
  }

  /** 单元列表（Unit 1 / Welcome Unit / Chapter 2 …） */
  @Public()
  @Get('units/:volumeId')
  @ApiOperation({ summary: '单元列表（公共）' })
  units(@Param('volumeId', zodPipe(POSITIVE_INT)) volumeId: number): Promise<UnitView[]> {
    return this.service.listUnits(volumeId);
  }
}
