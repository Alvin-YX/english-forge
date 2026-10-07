/**
 * 错题本控制器 —— 03 文档 §4.2.9
 *
 * 🔴 所有路由都需要档案上下文（全局 ProfileGuard 已注册）。
 */

import {
  Body,
  Controller,
  Delete,
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
  type ErrorBookView,
  type ErrorSampleView,
  type ListErrorBookQuery,
  type ListErrorSamplesQuery,
  ErrorBookService,
  LIST_ERRORBOOK_QUERY_SCHEMA,
  LIST_ERRORSAMPLES_QUERY_SCHEMA,
} from './errorbook.service.js';

const POSITIVE_INT = z.coerce.number().int().positive();

@Controller('errorbook')
@ApiTags('errorbook')
export class ErrorBookController {
  constructor(@Inject(ErrorBookService) private readonly service: ErrorBookService) {}

  // ═══════════════════════════════════════════════════════════
  // error_book 聚合视图
  // ═══════════════════════════════════════════════════════════

  /** GET /errorbook —— 错题本列表 */
  @Get()
  @ApiOperation({ summary: '错题本列表（分页、分类/解决状态/收藏过滤）' })
  async list(
    @CurrentUser() scope: ProfileScope,
    @Query(zodPipe(LIST_ERRORBOOK_QUERY_SCHEMA)) query: ListErrorBookQuery,
  ): Promise<{ items: ErrorBookView[]; total: number; page: number; pageSize: number; totalPages: number }> {
    return this.service.listErrorBook(scope, query);
  }

  // ═══════════════════════════════════════════════════════════
  // error_sample 原始样本
  // 🔴 `samples*` 静态路由必须声明在 `:id` 通配之前，否则 GET /errorbook/samples
  //    会被 `@Get(':id')` 抢先命中 → 参数校验失败返回 400。
  // ═══════════════════════════════════════════════════════════

  /** GET /errorbook/samples —— 错误样本列表 */
  @Get('samples')
  @ApiOperation({ summary: '错误样本列表（分页、分类/优先级/词条过滤）' })
  async samples(
    @CurrentUser() scope: ProfileScope,
    @Query(zodPipe(LIST_ERRORSAMPLES_QUERY_SCHEMA)) query: ListErrorSamplesQuery,
  ): Promise<{ items: ErrorSampleView[]; total: number; page: number; pageSize: number; totalPages: number }> {
    return this.service.listErrorSamples(scope, query);
  }

  /** GET /errorbook/samples/:id —— 错误样本详情 */
  @Get('samples/:id')
  @ApiOperation({ summary: '错误样本详情' })
  async sampleDetail(
    @CurrentUser() scope: ProfileScope,
    @Param('id', zodPipe(POSITIVE_INT)) id: number,
  ): Promise<ErrorSampleView> {
    return this.service.getErrorSampleById(scope, id);
  }

  /** POST /errorbook/samples/:id/replay —— 回放错误样本 */
  @Post('samples/:id/replay')
  @ApiOperation({ summary: '回放错误样本（更新 replay_count）' })
  async replay(
    @CurrentUser() scope: ProfileScope,
    @Param('id', zodPipe(POSITIVE_INT)) id: number,
  ): Promise<ErrorSampleView> {
    return this.service.replayErrorSample(scope, id);
  }

  // ── 以下为通配 `:id` 路由，必须排在全部静态路由之后 ──────────

  /** GET /errorbook/:id —— 错题详情 */
  @Get(':id')
  @ApiOperation({ summary: '错题详情' })
  async get(
    @CurrentUser() scope: ProfileScope,
    @Param('id', zodPipe(POSITIVE_INT)) id: number,
  ): Promise<ErrorBookView> {
    return this.service.getErrorBookById(scope, id);
  }

  /** POST /errorbook/:id/resolve —— 标记已解决（right_streak ≥ 3 自动出清） */
  @Post(':id/resolve')
  @ApiOperation({ summary: '标记已解决（right_streak ≥ 3 自动出清）' })
  async resolve(
    @CurrentUser() scope: ProfileScope,
    @Param('id', zodPipe(POSITIVE_INT)) id: number,
  ): Promise<ErrorBookView> {
    return this.service.resolveErrorBook(scope, id);
  }

  /** POST /errorbook/:id/favorite —— 切换收藏 */
  @Post(':id/favorite')
  @ApiOperation({ summary: '切换收藏' })
  async toggleFavorite(
    @CurrentUser() scope: ProfileScope,
    @Param('id', zodPipe(POSITIVE_INT)) id: number,
  ): Promise<ErrorBookView> {
    return this.service.toggleFavorite(scope, id);
  }

  /** DELETE /errorbook/:id —— 删除错题 */
  @Delete(':id')
  @ApiOperation({ summary: '删除错题' })
  async delete(
    @CurrentUser() scope: ProfileScope,
    @Param('id', zodPipe(POSITIVE_INT)) id: number,
  ): Promise<void> {
    return this.service.deleteErrorBook(scope, id);
  }

  /** DELETE /errorbook/samples/:id —— 删除错误样本 */
  @Delete('samples/:id')
  @ApiOperation({ summary: '删除错误样本' })
  async deleteSample(
    @CurrentUser() scope: ProfileScope,
    @Param('id', zodPipe(POSITIVE_INT)) id: number,
  ): Promise<void> {
    return this.service.deleteErrorSample(scope, id);
  }
}
