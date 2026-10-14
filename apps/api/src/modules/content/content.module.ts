/**
 * 词条与例句模块 —— 03 文档 §4.2.3
 *
 * 两个控制器的边界：
 *   - `ContentController`（`@Public()`，`@Controller('words')`）：只读公共数据
 *   - `ContentAdminController`（`@Roles(Role.ADMIN)`，`@Controller('words-admin')`）：
 *     唯一的词库写入口（停用/批量停用/CSV 导入）
 * `ContentService` 导出给上层模块复用（如 FSRS 查询词条信息、学习记录关联等）。
 */

import { Module } from '@nestjs/common';

import { AuditModule } from '../../infra/audit/audit.module.js';

import { ContentAdminController } from './content-admin.controller.js';
import { ContentAdminService } from './content-admin.service.js';
import { ContentController } from './content.controller.js';
import { ContentService } from './content.service.js';

@Module({
  imports: [AuditModule],
  controllers: [ContentController, ContentAdminController],
  providers: [ContentService, ContentAdminService],
  exports: [ContentService],
})
export class ContentModule {}
