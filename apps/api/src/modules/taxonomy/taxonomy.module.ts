/**
 * 分类树模块 —— 03 文档 §5.2（学段 → 教材 → 册次 → 单元）
 *
 * 只读公共数据：全部路由 `@Public()`，无写入接口。
 * `TaxonomyService` 导出给上层模块复用 `getEnrollment()`
 * （选课关系属个人数据，经 `/me/*` 路由族以档案作用域查询）。
 */

import { Module } from '@nestjs/common';

import { TaxonomyController } from './taxonomy.controller.js';
import { TaxonomyService } from './taxonomy.service.js';

@Module({
  controllers: [TaxonomyController],
  providers: [TaxonomyService],
  exports: [TaxonomyService],
})
export class TaxonomyModule {}
