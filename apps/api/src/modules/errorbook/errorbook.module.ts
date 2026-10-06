/**
 * 错题本模块 —— 03 文档 §4.2.9
 *
 * 全部路由需要档案上下文。
 * ErrorBookService 导出给上层模块复用（如 learning 模块创建学习记录后自动写入错题本）。
 */

import { Module } from '@nestjs/common';

import { ErrorBookController } from './errorbook.controller.js';
import { ErrorBookService } from './errorbook.service.js';

@Module({
  controllers: [ErrorBookController],
  providers: [ErrorBookService],
  exports: [ErrorBookService],
})
export class ErrorBookModule {}
