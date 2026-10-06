/**
 * 词条与例句模块 —— 03 文档 §4.2.3
 *
 * 只读公共数据：全部路由 `@Public()`，无写入接口。
 * `ContentService` 导出给上层模块复用（如 FSRS 查询词条信息、学习记录关联等）。
 */

import { Module } from '@nestjs/common';

import { ContentController } from './content.controller.js';
import { ContentService } from './content.service.js';

@Module({
  controllers: [ContentController],
  providers: [ContentService],
  exports: [ContentService],
})
export class ContentModule {}
