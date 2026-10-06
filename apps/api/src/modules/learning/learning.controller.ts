/**
 * 学习域控制器 —— 覆盖 word_mastery / learning_record / daily_stat / streak / heatmap / lesson_block
 *
 * 🔴 所有路由都需要档案上下文（全局 ProfileGuard 已注册），
 *    @CurrentUser() 是唯一获取 ProfileScope 的入口。
 */

import {
  Body,
  Controller,
  Get,
  Inject,
  Param,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { z } from 'zod';

import { zodPipe } from '../../common/zod-validation.pipe.js';
import { CurrentUser } from '../../infra/profile/current-user.decorator.js';
import { type ProfileScope } from '../../infra/profile/profile-scope.js';

import {
  type CreateLearningRecordInput,
  type GetHeatmapQuery,
  type GetMasteryQuery,
  type GetRecordsQuery,
  type HeatmapEntry,
  type LessonBlockView,
  type LearningRecordView,
  type StreakView,
  type TodayOverview,
  type UpdateMasteryInput,
  type WordMasteryView,
  LearningService,
  CREATE_LEARNING_RECORD_SCHEMA,
  GET_HEATMAP_QUERY_SCHEMA,
  GET_MASTERY_QUERY_SCHEMA,
  GET_RECORDS_QUERY_SCHEMA,
  UPDATE_MASTERY_SCHEMA,
} from './learning.service.js';

const POSITIVE_INT = z.coerce.number().int().positive();

@Controller('learning')
@ApiTags('learning')
export class LearningController {
  constructor(@Inject(LearningService) private readonly service: LearningService) {}

  // ═══════════════════════════════════════════════════════════
  // word_mastery
  // ═══════════════════════════════════════════════════════════

  /** GET /learning/mastery —— 词条掌握度列表 */
  @Get('mastery')
  @ApiOperation({ summary: '词条掌握度列表（分页、排序、过滤）' })
  async mastery(
    @CurrentUser() scope: ProfileScope,
    @Query(zodPipe(GET_MASTERY_QUERY_SCHEMA)) query: GetMasteryQuery,
  ): Promise<{ items: WordMasteryView[]; total: number; page: number; pageSize: number; totalPages: number }> {
    return this.service.getMasteryList(scope, query);
  }

  /** GET /learning/mastery/:wordId —— 单词条掌握度 */
  @Get('mastery/:wordId')
  @ApiOperation({ summary: '单词条掌握度' })
  async getMastery(
    @CurrentUser() scope: ProfileScope,
    @Param('wordId', zodPipe(POSITIVE_INT)) wordId: number,
  ): Promise<WordMasteryView | null> {
    return this.service.getMasteryByWordId(scope, wordId);
  }

  /** PATCH /learning/mastery —— 创建或更新词条掌握度 */
  @Patch('mastery')
  @ApiOperation({ summary: '创建或更新词条掌握度（upsert）' })
  async upsertMastery(
    @CurrentUser() scope: ProfileScope,
    @Body(zodPipe(UPDATE_MASTERY_SCHEMA)) body: UpdateMasteryInput,
  ): Promise<WordMasteryView> {
    return this.service.upsertMastery(scope, body);
  }

  // ═══════════════════════════════════════════════════════════
  // learning_record
  // ═══════════════════════════════════════════════════════════

  /** POST /learning/record —— 创建学习记录 */
  @Post('record')
  @ApiOperation({ summary: '创建学习记录（每次练习后调用）' })
  async createRecord(
    @CurrentUser() scope: ProfileScope,
    @Body(zodPipe(CREATE_LEARNING_RECORD_SCHEMA)) body: CreateLearningRecordInput,
  ): Promise<LearningRecordView> {
    return this.service.createLearningRecord(scope, body);
  }

  /** GET /learning/records —— 学习记录列表 */
  @Get('records')
  @ApiOperation({ summary: '学习记录列表（分页、按类型过滤）' })
  async records(
    @CurrentUser() scope: ProfileScope,
    @Query(zodPipe(GET_RECORDS_QUERY_SCHEMA)) query: GetRecordsQuery,
  ): Promise<{ items: LearningRecordView[]; total: number; page: number; pageSize: number; totalPages: number }> {
    return this.service.listLearningRecords(scope, query);
  }

  // ═══════════════════════════════════════════════════════════
  // today / streak / heatmap
  // ═══════════════════════════════════════════════════════════

  /** GET /learning/today —— 今日概览 */
  @Get('today')
  @ApiOperation({ summary: '今日概览（今日统计 + 待复习数）' })
  async today(@CurrentUser() scope: ProfileScope): Promise<TodayOverview> {
    return this.service.getTodayOverview(scope);
  }

  /** GET /learning/streak —— 连续打卡 */
  @Get('streak')
  @ApiOperation({ summary: '连续打卡信息' })
  async streak(@CurrentUser() scope: ProfileScope): Promise<StreakView> {
    return this.service.getStreak(scope);
  }

  /** GET /learning/heatmap —— 热力图 */
  @Get('heatmap')
  @ApiOperation({ summary: '热力图（12 周，跨月不清零）' })
  async heatmap(
    @CurrentUser() scope: ProfileScope,
    @Query(zodPipe(GET_HEATMAP_QUERY_SCHEMA)) query: GetHeatmapQuery,
  ): Promise<HeatmapEntry[]> {
    return this.service.getHeatmap(scope, query);
  }

  // ═══════════════════════════════════════════════════════════
  // lesson_block
  // ═══════════════════════════════════════════════════════════

  /** GET /learning/lessons/:courseId/next-block —— 下一个待消费的 5 词循环块 */
  @Get('lessons/:courseId/next-block')
  @ApiOperation({ summary: '获取下一个待消费的 5 词循环块' })
  async nextBlock(
    @CurrentUser() scope: ProfileScope,
    @Param('courseId', zodPipe(POSITIVE_INT)) courseId: number,
  ): Promise<LessonBlockView | null> {
    return this.service.getNextBlock(scope, courseId);
  }

  /** POST /learning/lessons/:blockId/consume —— 标记 5 词循环块已消费 */
  @Post('lessons/:blockId/consume')
  @ApiOperation({ summary: '标记 5 词循环块已消费' })
  async consumeBlock(
    @CurrentUser() scope: ProfileScope,
    @Param('blockId', zodPipe(POSITIVE_INT)) blockId: number,
  ): Promise<void> {
    return this.service.consumeBlock(scope, blockId);
  }
}
