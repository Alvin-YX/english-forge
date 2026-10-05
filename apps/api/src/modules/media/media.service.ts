/**
 * 媒体路径解析 —— 03 文档 §7.2 卷路径约定 + §8.5 安全测试②
 *
 * 🔴 本模块**只有 service，没有 controller**（M2 约定）：
 *    媒体文件不通过 HTTP 直读（fnOS 上由 nginx/Samba 直接挂 `/vol1`），
 *    API 只负责「算路径」与「校验路径不越界」。
 *
 * 🔴 路径穿越是本模块唯一的安全边界（03 文档 §8.5 安全测试②）：
 *    任何来自客户端的相对路径都必须经 `resolveMediaPath()` 收口。
 *    攻击路径：`GET /recordings/1/../../etc/passwd` ——
 *    若直接拼 `MEDIA_ROOT + relativePath`，就能读到系统文件。
 *
 * 防御三道：
 *   1. 拒绝空字节（`path.resolve` 在 Node 里对 `\0` 的行为不稳定）；
 *   2. 先 `path.resolve()` 归一化，抹掉 `..` / `.` / 重复分隔符；
 *   3. 用 `mediaRoot + path.sep` 做前缀比较 —— 必须带分隔符，
 *      否则 `MEDIA_ROOT=/data/media` 时 `/data/media-evil/x` 会通过。
 */

import { createHash } from 'node:crypto';
import path from 'node:path';

import { ErrorCode } from '@eng-forge/contracts/api';
import { Inject, Injectable } from '@nestjs/common';

import { BusinessError } from '../../common/errors.business.js';
import type { Env } from '../../infra/config/env.js';
import { ENV_CONFIG } from '../../infra/config/tokens.js';

@Injectable()
export class MediaService {
  constructor(@Inject(ENV_CONFIG) private readonly env: Env) {}

  /** 媒体根目录（已归一化，进程内只求一次） */
  private get mediaRoot(): string {
    return path.resolve(this.env.MEDIA_ROOT);
  }

  /**
   * 把相对媒体路径解析为绝对路径，并拦截路径穿越。
   *
   * @throws BusinessError(MEDIA_PATH_INVALID: 6002, 400)
   */
  resolveMediaPath(relativePath: string): string {
    if (!relativePath || typeof relativePath !== 'string') {
      throw new BusinessError(ErrorCode.MEDIA_PATH_INVALID, '媒体路径无效', 400);
    }
    if (relativePath.includes('\0')) {
      throw new BusinessError(ErrorCode.MEDIA_PATH_INVALID, '媒体路径无效', 400);
    }

    const mediaRoot = this.mediaRoot;
    const resolved = path.resolve(mediaRoot, relativePath);

    // 🔴 前缀比较必须带 `path.sep`：
    //    `MEDIA_ROOT=/data/media` 时 `/data/media-evil/x` 不以 `/data/media/` 开头，会被正确拦截；
    //    若只比较 `startsWith('/data/media')` 就会误放行。
    const isInside = resolved.startsWith(mediaRoot + path.sep) || resolved === mediaRoot;
    if (!isInside) {
      throw new BusinessError(ErrorCode.MEDIA_PATH_INVALID, '媒体路径无效', 400);
    }
    return resolved;
  }

  /** 录音：`recordings/{profileId}/{timestampMs}.wav` */
  buildRecordingPath(profileId: number, timestampMs: number): string {
    return `recordings/${profileId}/${timestampMs}.wav`;
  }

  /** 图片：`images/{profileId}/{filename}` */
  buildImagePath(profileId: number, filename: string): string {
    return `images/${profileId}/${filename}`;
  }

  /** 导出文件：`exports/{profileId}/{filename}` */
  buildExportPath(profileId: number, filename: string): string {
    return `exports/${profileId}/${filename}`;
  }

  /**
   * TTS 缓存：`tts-cache/{voice}/{sha256(text)[:16]}.mp3`
   *
   * 🔴 用哈希而非原文做文件名：原文可能含 `/`、空格、换行等文件系统非法字符，
   *    直接当文件名会在 Linux ext4 上写入失败或产生难以清理的目录。
   *    截 16 位（64 bit）已足够：同一 voice 下碰撞概率可忽略。
   */
  ttsCachePath(voice: string, text: string): string {
    const hash = createHash('sha256').update(text).digest('hex').slice(0, 16);
    return `tts-cache/${voice}/${hash}.mp3`;
  }
}
