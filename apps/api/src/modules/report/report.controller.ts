/**
 * 报告域控制器 —— 周/月报告 + CSV 导出
 */

import { Controller, Get, Inject, Query } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { z } from 'zod';

import { zodPipe } from '../../common/zod-validation.pipe.js';
import { CurrentUser } from '../../infra/profile/current-user.decorator.js';
import { type ProfileScope } from '../../infra/profile/profile-scope.js';

import {
  type CsvExportView,
  type GetMonthlyReportInput,
  type GetWeeklyReportInput,
  type MonthlyReportView,
  type WeeklyReportView,
  EXPORT_CSV_SCHEMA,
  GET_MONTHLY_REPORT_SCHEMA,
  GET_WEEKLY_REPORT_SCHEMA,
  ReportService,
} from './report.service.js';

@Controller('report')
@ApiTags('report')
export class ReportController {
  constructor(@Inject(ReportService) private readonly service: ReportService) {}

  @Get('weekly')
  @ApiOperation({ summary: '周报告' })
  async weekly(
    @CurrentUser() scope: ProfileScope,
    @Query(zodPipe(GET_WEEKLY_REPORT_SCHEMA)) query: GetWeeklyReportInput,
  ): Promise<WeeklyReportView> {
    return this.service.getWeeklyReport(scope, query);
  }

  @Get('monthly')
  @ApiOperation({ summary: '月报告' })
  async monthly(
    @CurrentUser() scope: ProfileScope,
    @Query(zodPipe(GET_MONTHLY_REPORT_SCHEMA)) query: GetMonthlyReportInput,
  ): Promise<MonthlyReportView> {
    return this.service.getMonthlyReport(scope, query);
  }

  @Get('export/csv')
  @ApiOperation({ summary: 'CSV 导出' })
  async exportCsv(
    @CurrentUser() scope: ProfileScope,
    @Query(zodPipe(EXPORT_CSV_SCHEMA)) query: GetWeeklyReportInput,
  ): Promise<CsvExportView> {
    return this.service.exportCsv(scope, query);
  }
}
