/**
 * 游戏化模块 —— 03 文档 §4.2.10
 *
 * 全部路由需要档案上下文。
 * GamificationService 导出给上层模块复用。
 */

import { Module } from '@nestjs/common';

import { GamificationController } from './gamification.controller.js';
import { GamificationService } from './gamification.service.js';

@Module({
  controllers: [GamificationController],
  providers: [GamificationService],
  exports: [GamificationService],
})
export class GamificationModule {}
