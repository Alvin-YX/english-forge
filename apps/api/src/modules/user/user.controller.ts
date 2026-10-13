/**
 * 用户域控制器 —— /me 系列端点
 *
 * 覆盖：
 *   - GET   /me               获取当前用户档案
 *   - PATCH /me/profile       更新当前用户档案
 *   - GET   /me/children      列出已绑定的孩子（家长角色）
 *   - POST  /me/children/bind    绑定孩子（家长角色，幂等）
 *   - POST  /me/children/unbind  解绑孩子（家长角色）
 *
 * 🔴 所有路由都需要档案上下文（全局 ProfileGuard 已注册），
 *    @CurrentUser() 是唯一获取 ProfileScope 的入口。
 */

import { Role } from '@eng-forge/contracts/enums';
import { Body, Controller, Get, HttpCode, Inject, Patch, Post } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';

import { zodPipe } from '../../common/zod-validation.pipe.js';
import { CurrentUser } from '../../infra/profile/current-user.decorator.js';
import { type ProfileScope } from '../../infra/profile/profile-scope.js';
import { Roles } from '../../infra/profile/rbac.guard.js';

import {
  type BindChildInput,
  type ChildView,
  type UpdateProfileInput,
  type UserProfileView,
  UserService,
  BIND_CHILD_SCHEMA,
  UNBIND_CHILD_SCHEMA,
  UPDATE_PROFILE_SCHEMA,
} from './user.service.js';

@Controller('me')
@ApiTags('user')
export class UserController {
  constructor(@Inject(UserService) private readonly service: UserService) {}

  /** GET /me —— 获取当前用户档案 */
  @Get()
  @ApiOperation({ summary: '获取当前用户档案' })
  async me(@CurrentUser() scope: ProfileScope): Promise<UserProfileView> {
    return this.service.getMe(scope);
  }

  /** PATCH /me/profile —— 更新当前用户档案 */
  @Patch('profile')
  @ApiOperation({ summary: '更新当前用户档案' })
  async updateProfile(
    @CurrentUser() scope: ProfileScope,
    @Body(zodPipe(UPDATE_PROFILE_SCHEMA)) body: UpdateProfileInput,
  ): Promise<UserProfileView> {
    return this.service.updateProfile(scope, body);
  }

  /** GET /me/children —— 列出已绑定的孩子（家长角色） */
  @Get('children')
  @Roles(Role.PARENT)
  @ApiOperation({ summary: '列出已绑定的孩子（家长角色）' })
  async children(@CurrentUser() scope: ProfileScope): Promise<ChildView[]> {
    return this.service.listChildren(scope);
  }

  /** POST /me/children/bind —— 绑定孩子（家长角色，幂等） */
  @Post('children/bind')
  @Roles(Role.PARENT)
  @HttpCode(200)
  @ApiOperation({
    summary: 'PARENT：绑定孩子（幂等，自动写入 consent_log）',
    description:
      'childId 与 username 二选一。家长侧传 username（如 "xiaoming"）即可，后端负责解析成 childId。',
  })
  async bindChild(
    @CurrentUser() scope: ProfileScope,
    @Body(zodPipe(BIND_CHILD_SCHEMA)) body: BindChildInput,
  ): Promise<void> {
    return this.service.bindChild(scope, body);
  }

  /** POST /me/children/unbind —— 解绑孩子（家长角色） */
  @Post('children/unbind')
  @Roles(Role.PARENT)
  @HttpCode(200)
  @ApiOperation({ summary: '解绑孩子（家长角色）' })
  async unbindChild(
    @CurrentUser() scope: ProfileScope,
    @Body(zodPipe(UNBIND_CHILD_SCHEMA)) body: { childId: number },
  ): Promise<void> {
    return this.service.unbindChild(scope, body.childId);
  }
}
