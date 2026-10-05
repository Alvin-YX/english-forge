/**
 * 媒体模块 —— M2 仅 service，无 controller
 *
 * 🔴 本模块**刻意不注册任何 controller**：
 *    媒体文件不经 HTTP 流式回传（fnOS 部署时由 nginx/Samba 直接挂 `/vol1` 数据卷），
 *    API 只暴露「路径计算」与「路径穿越校验」两个能力，
 *    供 recording / tts / export 等上层模块复用。
 *
 * `MediaService` 导出，供其他业务模块 `@Inject(MediaService)` 注入。
 */

import { Module } from '@nestjs/common';

import { MediaService } from './media.service.js';

@Module({
  providers: [MediaService],
  exports: [MediaService],
})
export class MediaModule {}
