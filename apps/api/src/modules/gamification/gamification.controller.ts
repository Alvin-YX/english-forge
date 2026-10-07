/**
 * 游戏化控制器 —— 03 文档 §4.2.10
 *
 * 🔴 所有路由都需要档案上下文（全局 ProfileGuard 已注册）。
 * 唯一例外：GET /games/:gameCode/leaderboard 是跨用户排行榜。
 */

import { GAME_CODES } from '@eng-forge/db/schema';
import {
  Body,
  Controller,
  Get,
  Inject,
  Param,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { z } from 'zod';

import { zodPipe } from '../../common/zod-validation.pipe.js';
import { CurrentUser } from '../../infra/profile/current-user.decorator.js';
import { type ProfileScope } from '../../infra/profile/profile-scope.js';

import {
  type AwardBadgeInput,
  type BadgeView,
  type CreateChallengeInput,
  type GameRecordView,
  type LeaderboardEntry,
  type ListChallengesQuery,
  type ListGamesQuery,
  type SubmitGameInput,
  type UpdateProgressInput,
  type WeeklyChallengeView,
  GamificationService,
  AWARD_BADGE_SCHEMA,
  CREATE_CHALLENGE_SCHEMA,
  LIST_CHALLENGES_QUERY_SCHEMA,
  LIST_GAMES_QUERY_SCHEMA,
  SUBMIT_GAME_SCHEMA,
  UPDATE_PROGRESS_SCHEMA,
} from './gamification.service.js';

const POSITIVE_INT = z.coerce.number().int().positive();
const GAME_CODE_PARAM = z.enum([...GAME_CODES]);

@Controller('gamification')
@ApiTags('gamification')
export class GamificationController {
  constructor(@Inject(GamificationService) private readonly service: GamificationService) {}

  // ═══════════════════════════════════════════════════════════
  // badge
  // ═══════════════════════════════════════════════════════════

  /** GET /gamification/badges —— 徽章列表 */
  @Get('badges')
  @ApiOperation({ summary: '获取当前用户的徽章列表' })
  async listBadges(@CurrentUser() scope: ProfileScope): Promise<BadgeView[]> {
    return this.service.listBadges(scope);
  }

  /** POST /gamification/badges —— 授予徽章 */
  @Post('badges')
  @ApiOperation({ summary: '授予徽章（upsert）' })
  async awardBadge(
    @CurrentUser() scope: ProfileScope,
    @Body(zodPipe(AWARD_BADGE_SCHEMA)) body: AwardBadgeInput,
  ): Promise<BadgeView> {
    return this.service.awardBadge(scope, body.code);
  }

  // ═══════════════════════════════════════════════════════════
  // weekly_challenge
  // ═══════════════════════════════════════════════════════════

  /** GET /gamification/challenges/weekly —— 本周挑战 */
  @Get('challenges/weekly')
  @ApiOperation({ summary: '获取当前用户的本周挑战' })
  async getWeeklyChallenge(@CurrentUser() scope: ProfileScope): Promise<WeeklyChallengeView | null> {
    return this.service.getWeeklyChallenge(scope);
  }

  /** POST /gamification/challenges —— 创建每周挑战 */
  @Post('challenges')
  @ApiOperation({ summary: '创建每周挑战' })
  async createChallenge(
    @CurrentUser() scope: ProfileScope,
    @Body(zodPipe(CREATE_CHALLENGE_SCHEMA)) body: CreateChallengeInput,
  ): Promise<WeeklyChallengeView> {
    return this.service.createChallenge(scope, body);
  }

  /** PATCH /gamification/challenges/:id/progress —— 更新挑战进度 */
  @Patch('challenges/:id/progress')
  @ApiOperation({ summary: '更新挑战进度（达标自动标记 done）' })
  async updateProgress(
    @CurrentUser() scope: ProfileScope,
    @Param('id', zodPipe(POSITIVE_INT)) id: number,
    @Body(zodPipe(UPDATE_PROGRESS_SCHEMA)) body: UpdateProgressInput,
  ): Promise<WeeklyChallengeView> {
    return this.service.updateChallengeProgress(scope, id, body.currentValue);
  }

  /** GET /gamification/challenges —— 挑战列表 */
  @Get('challenges')
  @ApiOperation({ summary: '挑战列表（分页、状态/指标/日期过滤）' })
  async listChallenges(
    @CurrentUser() scope: ProfileScope,
    @Query(zodPipe(LIST_CHALLENGES_QUERY_SCHEMA)) query: ListChallengesQuery,
  ): Promise<{ items: WeeklyChallengeView[]; total: number; page: number; pageSize: number; totalPages: number }> {
    return this.service.listChallenges(scope, query);
  }

  // ═══════════════════════════════════════════════════════════
  // game_record
  // ═══════════════════════════════════════════════════════════

  /** POST /gamification/games —— 提交游戏成绩 */
  @Post('games')
  @ApiOperation({ summary: '提交游戏成绩' })
  async submitGame(
    @CurrentUser() scope: ProfileScope,
    @Body(zodPipe(SUBMIT_GAME_SCHEMA)) body: SubmitGameInput,
  ): Promise<GameRecordView> {
    return this.service.submitGameResult(scope, body);
  }

  /** GET /gamification/games —— 游戏记录列表 */
  @Get('games')
  @ApiOperation({ summary: '游戏记录列表（分页、游戏类型/排序过滤）' })
  async listGames(
    @CurrentUser() scope: ProfileScope,
    @Query(zodPipe(LIST_GAMES_QUERY_SCHEMA)) query: ListGamesQuery,
  ): Promise<{ items: GameRecordView[]; total: number; page: number; pageSize: number; totalPages: number }> {
    return this.service.listGameRecords(scope, query);
  }

  /** GET /gamification/games/:gameCode/leaderboard —— 排行榜 */
  @Get('games/:gameCode/leaderboard')
  @ApiOperation({ summary: '排行榜（跨用户，按分数降序 TOP 50）' })
  async leaderboard(
    @CurrentUser() scope: ProfileScope,
    @Param('gameCode', zodPipe(GAME_CODE_PARAM)) gameCode: z.infer<typeof GAME_CODE_PARAM>,
  ): Promise<LeaderboardEntry[]> {
    return this.service.getGameLeaderboard(scope, gameCode);
  }
}
