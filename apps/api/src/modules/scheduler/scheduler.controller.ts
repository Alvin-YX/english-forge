/**
 * 调度器控制器 —— 作业审计 + 系统通知
 */

import { Controller, Get, Inject, Param, Patch, Query } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { z } from 'zod';

import { zodPipe } from '../../common/zod-validation.pipe.js';
import { CurrentUser } from '../../infra/profile/current-user.decorator.js';
import { type ProfileScope } from '../../infra/profile/profile-scope.js';

import {
  type JobAuditView,
  type ListJobsQuery,
  type ListNoticesQuery,
  type NoticeView,
  LIST_JOBS_QUERY_SCHEMA,
  LIST_NOTICES_QUERY_SCHEMA,
  SchedulerService,
} from './scheduler.service.js';

const POSITIVE_INT = z.coerce.number().int().positive();

@Controller('scheduler')
@ApiTags('scheduler')
export class SchedulerController {
  constructor(@Inject(SchedulerService) private readonly service: SchedulerService) {}

  @Get('jobs')
  @ApiOperation({ summary: '作业审计列表' })
  async jobs(
    @CurrentUser() scope: ProfileScope,
    @Query(zodPipe(LIST_JOBS_QUERY_SCHEMA)) query: ListJobsQuery,
  ): Promise<{ items: JobAuditView[]; total: number; page: number; pageSize: number; totalPages: number }> {
    return this.service.listJobs(scope, query);
  }

  @Get('notices')
  @ApiOperation({ summary: '系统通知列表' })
  async notices(
    @CurrentUser() scope: ProfileScope,
    @Query(zodPipe(LIST_NOTICES_QUERY_SCHEMA)) query: ListNoticesQuery,
  ): Promise<{ items: NoticeView[]; total: number; page: number; pageSize: number; totalPages: number }> {
    return this.service.listNotices(scope, query);
  }

  @Patch('notices/:id/read')
  @ApiOperation({ summary: '标记通知已读' })
  async markNoticeRead(
    @CurrentUser() scope: ProfileScope,
    @Param('id', zodPipe(POSITIVE_INT)) id: number,
  ): Promise<void> {
    return this.service.markNoticeRead(scope, id);
  }

  @Patch('notices/read-all')
  @ApiOperation({ summary: '标记所有通知已读' })
  async markAllNoticesRead(
    @CurrentUser() scope: ProfileScope,
  ): Promise<void> {
    return this.service.markAllNoticesRead(scope);
  }
}
