/**
 * 认证控制器 —— register / login / refresh 三端点。
 *
 * 🔴 全部 `@Public()`：注册、登录、刷新均为白名单路由
 *    （`app.module.ts` 的默认全鉴权策略的豁免入口）。
 *
 * 🔴 路径穿越与越权防护：本模块不涉及任何 profile_id 过滤，
 *    因为这些端点发生在认证之前（无 scope 可注入）。
 */

import { Body, Controller, HttpCode, Inject, Post } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';

import { zodPipe } from '../../common/zod-validation.pipe.js';
import { Public } from '../../infra/profile/public.decorator.js';

import { type AuthTokens, type LoginInput, type RegisterInput, LOGIN_SCHEMA, REFRESH_SCHEMA, REGISTER_SCHEMA, AuthService } from './auth.service.js';

@Controller('auth')
@ApiTags('auth')
export class AuthController {
  constructor(
    @Inject(AuthService) private readonly service: AuthService,
  ) {}

  /**
   * POST /auth/register —— 注册新用户。
   *
   * 首注册用户默认为 `student` 角色；如需 admin/parent/teacher，
   * 需显式传入 `role` 字段（后续会改为仅限首注册或 super-admin 创建）。
   */
  @Public()
  @Post('register')
  @ApiOperation({ summary: '用户注册' })
  async register(
    @Body(zodPipe(REGISTER_SCHEMA)) body: RegisterInput,
  ): Promise<AuthTokens> {
    return this.service.register(body);
  }

  /**
   * POST /auth/login —— 登录获取双 token。
   *
   * 返回 `{ accessToken, refreshToken, tokenType: 'Bearer', expiresIn }`。
   * accessToken 15 分钟过期，refreshToken 30 天过期。
   */
  @Public()
  @Post('login')
  // 🔴 登录不创建资源，NestJS 的 POST 默认 201 是给「注册」用的；
  //    与同为凭证换取的 `refresh` 保持一致返回 200。
  @HttpCode(200)
  @ApiOperation({ summary: '用户登录' })
  async login(
    @Body(zodPipe(LOGIN_SCHEMA)) body: LoginInput,
  ): Promise<AuthTokens> {
    return this.service.login(body);
  }

  /**
   * POST /auth/refresh —— 用 refresh token 换取新的双 token。
   *
   * access token 过期后客户端调用此端点，不需要重新输入密码。
   * refresh token 无效或用户被禁用时返回 401/403。
   */
  @Public()
  @Post('refresh')
  @HttpCode(200)
  @ApiOperation({ summary: '刷新登录凭证' })
  async refresh(
    @Body(zodPipe(REFRESH_SCHEMA)) body: { refreshToken: string },
  ): Promise<AuthTokens> {
    return this.service.refresh(body.refreshToken);
  }
}
