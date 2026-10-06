/**
 * 学习域模块 —— 覆盖 word_mastery / learning_record / daily_stat / streak / heatmap / lesson_block
 *
 * 🔴 全部路由需要档案上下文（全局 ProfileGuard 已注册）。
 * LearningService 导出给上层模块复用（如 errorbook 查询掌握度、gamification 查打卡数据等）。
 */

import { Module } from '@nestjs/common';

import { LearningController } from './learning.controller.js';
import { LearningService } from './learning.service.js';

@Module({
  controllers: [LearningController],
  providers: [LearningService],
  exports: [LearningService],
})
export class LearningModule {}
