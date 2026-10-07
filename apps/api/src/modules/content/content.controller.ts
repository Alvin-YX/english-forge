/**
 * 词条与例句端点 —— 03 文档 §4.2.3
 *
 * 🔴 全部 `@Public()`：词条与例句是公共参考数据，
 *    前端**未登录**状态也要能浏览词库（与 taxonomy 一致）。
 *
 * 🔴 只读、无写入接口：词条由 ETL/seed 灌入，
 *    不允许任何客户端通过 API 修改词库（版权红线 + 数据完整性）。
 */

import { Controller, Get, Inject, Param, Query } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { z } from 'zod';

import { zodPipe } from '../../common/zod-validation.pipe.js';
import { Public } from '../../infra/profile/public.decorator.js';

import {
  type GetSentencesQuery,
  type ListWordsQuery,
  type SentenceView,
  type UnitWordView,
  type WordDetailView,
  type WordListView,
  ContentService,
  GET_SENTENCES_QUERY_SCHEMA,
  LIST_WORDS_QUERY_SCHEMA,
} from './content.service.js';

const POSITIVE_INT = z.coerce.number().int().positive();

@Controller('words')
@ApiTags('content')
export class ContentController {
  constructor(@Inject(ContentService) private readonly service: ContentService) {}

  /** 词条列表（公共），支持搜索/过滤/分页 */
  @Public()
  @Get()
  @ApiOperation({ summary: '词条列表（公共），支持搜索、词性/词频/CEFR 过滤' })
  listWords(@Query(zodPipe(LIST_WORDS_QUERY_SCHEMA)) query: ListWordsQuery): Promise<{ items: WordListView[]; total: number; page: number; pageSize: number; totalPages: number }> {
    return this.service.listWords(query);
  }

  // 🔴 静态路由必须声明在 `:id` 之前。Nest/Fastify 按声明顺序匹配，
  //    `sentences` / `units/:unitId` 若排在 `:id` 之后会被 `:id` 抢先命中，
  //    导致 GET /words/sentences 走词条详情分支、参数校验失败返回 400。

  /** 例句列表（公共），支持分页 */
  @Public()
  @Get('sentences')
  @ApiOperation({ summary: '例句列表（公共），支持分页' })
  listSentences(@Query(zodPipe(GET_SENTENCES_QUERY_SCHEMA)) query: GetSentencesQuery): Promise<{ items: SentenceView[]; total: number; page: number; pageSize: number; totalPages: number }> {
    return this.service.listSentences(query);
  }

  /** 单元内的词条列表（公共） */
  @Public()
  @Get('units/:unitId')
  @ApiOperation({ summary: '单元内的词条列表（公共）' })
  listWordsByUnit(@Param('unitId', zodPipe(POSITIVE_INT)) unitId: number): Promise<UnitWordView[]> {
    return this.service.listWordsByUnit(unitId);
  }

  /** 词条详情（公共）——🔴 通配 `:id` 必须排在上面所有静态路由之后 */
  @Public()
  @Get(':id')
  @ApiOperation({ summary: '词条详情（公共）' })
  getWord(@Param('id', zodPipe(POSITIVE_INT)) id: number): Promise<WordDetailView> {
    return this.service.getWordById(id);
  }

  /** 某词条的例句（公共） */
  @Public()
  @Get(':id/examples')
  @ApiOperation({ summary: '某词条的例句（公共）' })
  getExamples(@Param('id', zodPipe(POSITIVE_INT)) id: number): Promise<SentenceView[]> {
    return this.service.getWordExamples(id);
  }
}
