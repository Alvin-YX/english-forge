/**
 * 用户搜索控制器 —— PARENT 绑定孩子前的候选查询
 *
 * 覆盖：
 *   - GET /users/search?q=<关键词>   按用户名 / 昵称模糊搜索可绑定的学生账号
 *
 * 为什么单独一个 controller：/me/children/* 的语义是"我已绑定的关系"，
 * 而搜索是"还没绑定的候选人"，两者生命周期不同，混在 /me 下会让路由语义混乱。
 *
 * 🔴 只返回 userId / username / displayName 三个字段，
 *    绝不回显 phone / email / status 等家长无权看的字段。
 */

import { Role } from '@eng-forge/contracts/enums';
import { Controller, Get, Inject, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';

import { zodPipe } from '../../common/zod-validation.pipe.js';
import { CurrentUser } from '../../infra/profile/current-user.decorator.js';
import { type ProfileScope } from '../../infra/profile/profile-scope.js';
import { Roles } from '../../infra/profile/rbac.guard.js';

import { SEARCH_USERS_SCHEMA, UserService } from './user.service.js';
import type { SearchStudentView, SearchUsersInput } from './user.service.js';

@Controller('users')
@Roles(Role.PARENT)
@ApiBearerAuth('jwt')
@ApiTags('user')
export class UserSearchController {
  constructor(@Inject(UserService) private readonly users: UserService) {}

  /** GET /users/search —— 搜索可绑定的学生账号 */
  @Get('search')
  @ApiOperation({
    summary: 'PARENT：按用户名/昵称模糊搜索可绑定的学生账号',
    description:
      '仅返回学生账号，且不返回调用者自己。q 为空时返回空列表。' +
      '返回体由 EnvelopeInterceptor 统一包成 { code: 0, message: "ok", data: { list, total } }。',
  })
  @ApiOkResponse({
    description: 'data = { list: [{ userId, username, displayName }], total }',
  })
  async search(
    @CurrentUser() scope: ProfileScope,
    @Query(zodPipe(SEARCH_USERS_SCHEMA)) input: SearchUsersInput,
  ): Promise<{ list: SearchStudentView[]; total: number }> {
    const list = await this.users.searchStudents(scope, input);
    // 不再自己包 envelope —— EnvelopeInterceptor 会统一加上 { code, message, data }
    return { list, total: list.length };
  }
}
