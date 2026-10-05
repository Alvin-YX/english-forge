/**
 * system 模块（基础层）—— 03 文档 §5.7
 *
 * 只做进程/依赖存活探测与全局运行参数读写。
 * 🔴 本模块是基础层（见 CONTRIBUTING.md §4 分层表），
 *    不得被任何业务层模块当作反向依赖使用。
 */

import { Module } from '@nestjs/common';

import { SystemController } from './system.controller.js';
import { SystemService } from './system.service.js';

@Module({
  controllers: [SystemController],
  providers: [SystemService],
  exports: [SystemService],
})
export class SystemModule {}
