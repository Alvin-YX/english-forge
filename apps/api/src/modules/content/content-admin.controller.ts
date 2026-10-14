/**
 * 词库管理端点（admin）—— P-42 词库管理页
 *
 * 🔴 全部 `@Roles(Role.ADMIN)`：词库是公共数据，但改它会立刻影响所有学生的
 *    练习出题、默写判分与跟读。`RolesGuard` 没有通配符旁路，必须显式声明。
 *
 * 🔴 与 `content.controller.ts`（`@Public()` + 只读）严格分开：
 *    公开 API 永远走 `@Controller('words')`，写操作只存在于本文件的 `words-admin`。
 *    这样「谁能改词库」在路由层就是一目了然的，不需要读代码判断。
 *
 * 🔴 不提供单条新建/编辑（见 `content-admin.service.ts` 头注释）：
 *    修词的正确流程是 停用 → 改 CSV → 重新导入（`(lemma, pos)` 幂等）。
 *
 * 🔴 所有写操作写 `audit_log`（停用 → `system_config_change`，导入 → `import_words`）。
 */

import { Role } from '@eng-forge/contracts/enums';
import {
  Body,
  Controller,
  Get,
  HttpCode,
  Inject,
  Param,
  Patch,
  Post,
  Query,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
// 🔴 Nest 11 把文件上传拦截器从 `@nestjs/common` 挪到了平台包
// （`@nestjs/common` 里已无 `FileInterceptor` 导出），只能从 multer 适配层取。
import { FileInterceptor } from '@nestjs/platform-express/multer';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { z } from 'zod';

import { validationError } from '../../common/errors.business.js';
import { zodPipe } from '../../common/zod-validation.pipe.js';
import { type AuditMeta, CurrentAuditMeta } from '../../infra/audit/audit-meta.decorator.js';
import { Roles } from '../../infra/profile/rbac.guard.js';

import {
  type ListWordsAdminQuery,
  type WordActiveResult,
  type WordImportFields,
  type WordImportResult,
  BATCH_ACTIVE_SCHEMA,
  ContentAdminService,
  LIST_WORDS_ADMIN_QUERY_SCHEMA,
  SET_ACTIVE_SCHEMA,
  WORD_IMPORT_FIELDS_SCHEMA,
} from './content-admin.service.js';
import type { WordListView } from './content.service.js';

const POSITIVE_INT = z.coerce.number().int().positive();

/** CSV 上传体积上限：20 MB 足够容纳数万行 ECDICT 片段 */
const IMPORT_FILE_LIMIT_BYTES = 20 * 1024 * 1024;

/**
 * `@UploadedFile()` 的文件形状（只取本端点用到的两个字段）。
 *
 * NestJS 11 已不再全局声明 `Express.Multer.File`（`@types/multer` 也未安装），
 * 定义一个最小结构体比引依赖更省事，且 `@UploadedFile()` 不校验参数类型。
 */
interface UploadedCsvFile {
  originalname?: string;
  buffer?: Buffer;
}

@Controller('words-admin')
@ApiTags('content')
export class ContentAdminController {
  constructor(@Inject(ContentAdminService) private readonly service: ContentAdminService) {}

  /** 词条列表（可含停用项，`sortDir` 生效） */
  @Roles(Role.ADMIN)
  @Get()
  @ApiOperation({ summary: '词条列表（admin，可含停用项）' })
  async list(
    @Query(zodPipe(LIST_WORDS_ADMIN_QUERY_SCHEMA)) query: ListWordsAdminQuery,
  ): Promise<{ items: WordListView[]; total: number; page: number; pageSize: number; totalPages: number }> {
    return this.service.listWords(query);
  }

  /** 停用 / 恢复单条词条 */
  @Roles(Role.ADMIN)
  @Patch(':id/active')
  @ApiOperation({ summary: '停用或恢复单条词条（admin）' })
  async setActive(
    @CurrentAuditMeta() meta: AuditMeta,
    @Param('id', zodPipe(POSITIVE_INT)) id: number,
    @Body(zodPipe(SET_ACTIVE_SCHEMA)) body: { isActive: boolean },
  ): Promise<WordActiveResult> {
    const result = await this.service.setActive([id], body.isActive);
    await this.service.auditSetActive([id], body.isActive, meta, result.updated);
    return result;
  }

  /** 批量停用 / 恢复 */
  @Roles(Role.ADMIN)
  @Post('batch-active')
  @HttpCode(200)
  @ApiOperation({ summary: '批量停用或恢复词条（admin，上限 500 条）' })
  async batchSetActive(
    @CurrentAuditMeta() meta: AuditMeta,
    @Body(zodPipe(BATCH_ACTIVE_SCHEMA)) body: { ids: number[]; isActive: boolean },
  ): Promise<WordActiveResult> {
    const ids = [...new Set(body.ids)];
    const result = await this.service.setActive(ids, body.isActive);
    await this.service.auditSetActive(ids, body.isActive, meta, result.updated);
    return result;
  }

  /**
   * CSV 批量导入（ECDICT 格式）。
   *
   * 🔴 表单字段：`file`（CSV）、`license`（必填）、`source`（可选，默认 `import`）、
   *    `sourceUrl`（可选）。`license` 缺失直接 400 —— `word.license` 是 NOT NULL 版权红线。
   */
  @Roles(Role.ADMIN)
  @Post('import')
  @HttpCode(200)
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: IMPORT_FILE_LIMIT_BYTES } }))
  @ApiOperation({ summary: 'CSV 批量导入词条（admin，ECDICT 格式，幂等）' })
  async importCsv(
    @CurrentAuditMeta() meta: AuditMeta,
    @UploadedFile() file: UploadedCsvFile | undefined,
    @Body(zodPipe(WORD_IMPORT_FIELDS_SCHEMA)) fields: WordImportFields,
  ): Promise<WordImportResult> {
    if (!file || !file.buffer) {
      throw validationError('请上传 CSV 文件（字段名 file）');
    }

    const csvText = file.buffer.toString('utf8');
    const result = await this.service.importCsv(csvText, fields);
    await this.service.auditImport(result, file.originalname ?? 'upload.csv', meta);
    return result;
  }
}
