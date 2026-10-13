/**
 * 用户域 —— /me 系列端点
 *
 * 覆盖：
 *   - GET   /me               获取当前用户档案
 *   - PATCH /me/profile       更新当前用户档案
 *   - GET   /me/children      列出已绑定的孩子（家长角色）
 *   - POST  /me/children/bind    绑定孩子（家长角色，幂等；childId 或 username 二选一）
 *   - POST  /me/children/unbind  解绑孩子（家长角色）
 *   - GET   /users/search     按用户名/昵称模糊搜索可绑定的学生（家长角色，见 user-search.controller）
 *
 * 🔴 所有公开方法第一个参数都是 scope（@CurrentUser() 注入）。
 *    业务查询必须经 scope 过滤，禁止采信外部传入的 userId 直接查表。
 */

import { createHash } from 'node:crypto';


import { ErrorCode } from '@eng-forge/contracts/api';
import { Role } from '@eng-forge/contracts/enums';
import { consentLog, parentChildren, user, userProfile } from '@eng-forge/db/schema';
import { Inject, Injectable } from '@nestjs/common';
import { z } from 'zod';

import { BusinessError, notFoundError, rbacDeniedError } from '../../common/errors.business.js';
import { DbConnection } from '../../infra/db/db.module.js';
import { and, asc, eq, ilike, isNull, ne, or } from '../../infra/db/query.js';
import { profileWhere, type ProfileScope } from '../../infra/profile/profile-scope.js';

// ═══════════════════════════════════════════════════════════
// 视图定义
// ═══════════════════════════════════════════════════════════

/** 当前用户档案视图 */
export interface UserProfileView {
  userId: number;
  username: string;
  displayName: string;
  role: Role;
  email?: string;
  phone?: string;
  status: string;
  profile: {
    locale: string;
    accent: string;
    speechRate: string;
    perfTier: string;
    asrModel: string;
    dailyGoalMin: number;
    reportFrequency: string;
    stageCode?: string;
    stageId?: number;
    calibrationDone: boolean;
    noiseFloorDb?: string;
  };
}

/** 家长可见孩子视图 */
export interface ChildView {
  childId: number;
  /** 被绑定学生的登录用户名 —— 解绑需要 childId，展示/对账需要 username */
  username: string;
  displayName: string;
  stageCode?: string;
  stageId?: number;
  createdAt: string;
}

/** 可绑定学生候选视图（`GET /users/search`） */
export interface SearchStudentView {
  userId: number;
  username: string;
  displayName: string | null;
}

// ═══════════════════════════════════════════════════════════
// Zod schemas
// ═══════════════════════════════════════════════════════════

export const UPDATE_PROFILE_SCHEMA = z.object({
  locale: z.string().max(16).optional(),
  accent: z.enum(['us', 'uk']).optional(),
  speechRate: z.string().regex(/^\d\.\d\d$/).optional(),
  perfTier: z.enum(['auto', 'smooth', 'standard', 'power_saving']).optional(),
  asrModel: z.enum(['tiny', 'base', 'small', 'medium', 'large-v2']).optional(),
  dailyGoalMin: z.number().int().min(1).max(1440).optional(),
  reportFrequency: z.enum(['off', 'daily', 'weekly', 'monthly']).optional(),
  stageId: z.number().int().positive().optional(),
  stageStartYear: z.number().int().optional(),
  stageCode: z.string().max(16).optional(),
  displayName: z.string().min(1).max(64).optional(),
  email: z.string().email().optional(),
  phone: z.string().max(32).optional(),
});

/**
 * 绑定孩子：`childId` 与 `username` 二选一。
 *
 * 家长不知道（也不该知道）孩子的内部自增 id，所以主路径是 username；
 * childId 保留给已知 id 的调用方（测试、内部工具）。
 */
export const BIND_CHILD_SCHEMA = z
  .object({
    childId: z.number().int().positive().optional(),
    username: z
      .string()
      .trim()
      .min(1)
      .max(64)
      .regex(/^\S+$/, 'username 不能包含空白')
      .optional(),
    relation: z
      .enum(['father', 'mother', 'grandfather', 'grandmother', 'other_guardian'])
      .optional(),
    agreed: z.boolean().optional(),
  })
  .refine(
    (v) => (v.childId === undefined) !== (v.username === undefined),
    'childId 与 username 必须提供且只能提供一个',
  );

export const UNBIND_CHILD_SCHEMA = z.object({
  childId: z.number().int().positive(),
});

export const SEARCH_USERS_SCHEMA = z.object({
  q: z
    .string()
    .trim()
    .max(64)
    .optional(),
  // query 参数到达时是字符串，需 coerce 成数字
  limit: z.coerce.number().int().min(1).max(50).optional(),
});

export type UpdateProfileInput = z.infer<typeof UPDATE_PROFILE_SCHEMA>;
export type BindChildInput = z.infer<typeof BIND_CHILD_SCHEMA>;
export type UnbindChildInput = z.infer<typeof UNBIND_CHILD_SCHEMA>;
export type SearchUsersInput = z.infer<typeof SEARCH_USERS_SCHEMA>;

// ═══════════════════════════════════════════════════════════
// 协议常量
// ═══════════════════════════════════════════════════════════

const AGREEMENT_VERSION = '1.0.0';
const AGREEMENT_HASH = createHash('sha256').update(`v${AGREEMENT_VERSION}`).digest('hex');

@Injectable()
export class UserService {
  constructor(@Inject(DbConnection) private readonly conn: DbConnection) {}

  // ═══════════════════════════════════════════════════════════
  // Public API
  // ═══════════════════════════════════════════════════════════

  /** GET /me —— 获取当前用户档案 */
  async getMe(scope: ProfileScope): Promise<UserProfileView> {
    return this.getUserView(scope.userId);
  }

  /** PATCH /me/profile —— 更新当前用户档案（仅更新提供的字段） */
  async updateProfile(scope: ProfileScope, input: UpdateProfileInput): Promise<UserProfileView> {
    // 1. 验证档案存在
    const [existing] = await this.conn.db
      .select({ id: userProfile.userId })
      .from(userProfile)
      .where(profileWhere(scope, userProfile.userId))
      .limit(1);

    if (existing === undefined) {
      throw notFoundError(ErrorCode.RESOURCE_NOT_FOUND, '用户档案不存在');
    }

    // 2. 更新 userProfile 字段（仅更新非 undefined 字段）
    const profileUpdates: Record<string, unknown> = { updatedAt: new Date() };
    if (input.locale !== undefined) profileUpdates.locale = input.locale;
    if (input.accent !== undefined) profileUpdates.accent = input.accent;
    if (input.speechRate !== undefined) profileUpdates.speechRate = input.speechRate;
    if (input.perfTier !== undefined) profileUpdates.perfTier = input.perfTier;
    if (input.asrModel !== undefined) profileUpdates.asrModel = input.asrModel;
    if (input.dailyGoalMin !== undefined) profileUpdates.dailyGoalMin = input.dailyGoalMin;
    if (input.reportFrequency !== undefined) profileUpdates.reportFrequency = input.reportFrequency;
    if (input.stageId !== undefined) profileUpdates.stageId = input.stageId;
    if (input.stageStartYear !== undefined) profileUpdates.stageStartYear = input.stageStartYear;
    if (input.stageCode !== undefined) profileUpdates.stageCode = input.stageCode;

    await this.conn.db
      .update(userProfile)
      .set(profileUpdates as unknown as typeof userProfile.$inferInsert)
      .where(profileWhere(scope, userProfile.userId));

    // 3. 更新 user 字段（displayName / email / phone）
    if (input.displayName !== undefined || input.email !== undefined || input.phone !== undefined) {
      const userUpdates: Record<string, unknown> = { updatedAt: new Date() };
      if (input.displayName !== undefined) userUpdates.displayName = input.displayName;
      if (input.email !== undefined) userUpdates.email = input.email;
      if (input.phone !== undefined) userUpdates.phone = input.phone;

      await this.conn.db
        .update(user)
        .set(userUpdates as unknown as typeof user.$inferInsert)
        .where(eq(user.id, scope.userId));
    }

    return this.getUserView(scope.userId);
  }

  /** GET /me/children —— 列出已绑定的孩子（家长角色） */
  async listChildren(scope: ProfileScope): Promise<ChildView[]> {
    if (scope.role !== Role.PARENT) {
      throw rbacDeniedError();
    }

    const rows = await this.conn.db
      .select({
        childId: parentChildren.childId,
        username: user.username,
        displayName: user.displayName,
        stageCode: userProfile.stageCode,
        stageId: userProfile.stageId,
        createdAt: parentChildren.createdAt,
      })
      .from(parentChildren)
      .leftJoin(user, eq(parentChildren.childId, user.id))
      .leftJoin(userProfile, eq(parentChildren.childId, userProfile.userId))
      .where(profileWhere(scope, parentChildren.parentId))
      .orderBy(asc(parentChildren.createdAt));

    return rows.map((row) => ({
      childId: row.childId,
      username: row.username ?? '',
      displayName: row.displayName ?? '未知用户',
      stageCode: row.stageCode ?? undefined,
      stageId: row.stageId ?? undefined,
      createdAt: new Date(row.createdAt).toISOString(),
    }));
  }

  /** POST /me/children/bind —— 绑定孩子（家长角色，幂等） */
  async bindChild(scope: ProfileScope, input: BindChildInput): Promise<void> {
    if (scope.role !== Role.PARENT) {
      throw rbacDeniedError();
    }

    let childId: number;

    if (input.childId !== undefined) {
      childId = input.childId;
    } else {
      const username = input.username;
      // zod 的 .refine() 不能收窄类型，编译器仍认为 username 可能是 undefined
      if (username === undefined) {
        throw new BusinessError(
          ErrorCode.VALIDATION_FAILED,
          'childId 与 username 必须提供且只能提供一个',
          400,
        );
      }

      // 家长只知道孩子注册时的用户名，不知道内部自增 id。
      const [byUsername] = await this.conn.db
        .select({ id: user.id })
        .from(user)
        .where(and(eq(user.username, username), isNull(user.deletedAt)))
        .limit(1);

      if (byUsername === undefined) {
        throw notFoundError(ErrorCode.RESOURCE_NOT_FOUND, '孩子账号不存在');
      }
      childId = byUsername.id;
    }

    // 校验孩子账号存在
    const [child] = await this.conn.db
      .select({ id: user.id, role: user.role })
      .from(user)
      .where(and(eq(user.id, childId), isNull(user.deletedAt)))
      .limit(1);

    if (child === undefined) {
      throw notFoundError(ErrorCode.RESOURCE_NOT_FOUND, '孩子账号不存在');
    }

    // 只能绑定学生账号，不能把家长/教师绑成"孩子"
    if (child.role !== Role.STUDENT) {
      throw new BusinessError(
        ErrorCode.OPERATION_NOT_ALLOWED,
        '只能绑定学生账号',
        400,
      );
    }

    // 不能将自己绑定为孩子
    if (childId === scope.userId) {
      throw new BusinessError(
        ErrorCode.OPERATION_NOT_ALLOWED,
        '不能将自己绑定为孩子',
        400,
      );
    }

    // 幂等：已绑定则直接返回
    const [existing] = await this.conn.db
      .select({ id: parentChildren.id })
      .from(parentChildren)
      .where(profileWhere(scope, parentChildren.parentId, eq(parentChildren.childId, childId)))
      .limit(1);

    if (existing !== undefined) {
      return;
    }

    // 插入绑定关系
    await this.conn.db.insert(parentChildren).values({
      parentId: scope.userId,
      childId,
      relation: input.relation,
    });

    // 记录知情同意日志
    await this.conn.db.insert(consentLog).values({
      childId,
      guardianId: scope.userId,
      agreementVersion: AGREEMENT_VERSION,
      agreementHash: AGREEMENT_HASH,
      granted: ((input.agreed ?? true) ? 1 : 0) as unknown as boolean,
      source: 'settings',
    });
  }

  /** POST /me/children/unbind —— 解绑孩子（家长角色） */
  async unbindChild(scope: ProfileScope, childId: number): Promise<void> {
    if (scope.role !== Role.PARENT) {
      throw rbacDeniedError();
    }

    const result = await this.conn.db
      .delete(parentChildren)
      .where(profileWhere(scope, parentChildren.parentId, eq(parentChildren.childId, childId)))
      .returning({ id: parentChildren.id });

    if (result.length === 0) {
      throw notFoundError(ErrorCode.RESOURCE_NOT_FOUND, '该孩子未绑定或不属于当前账号');
    }
  }

  /** GET /users/search —— 按用户名/昵称模糊搜索可绑定的学生（家长角色） */
  async searchStudents(scope: ProfileScope, input: SearchUsersInput): Promise<SearchStudentView[]> {
    if (scope.role !== Role.PARENT) {
      throw rbacDeniedError();
    }

    const keyword = input.q?.trim() ?? '';
    const limit = input.limit ?? 20;
    if (!keyword) return [];

    // 只出学生账号：家长/教师不能出现在绑定候选里，且绝不返回自己
    const pattern = `%${keyword}%`;
    const rows = await this.conn.db
      .select({
        userId: user.id,
        username: user.username,
        displayName: user.displayName,
      })
      .from(user)
      .where(
        and(
          eq(user.role, Role.STUDENT),
          isNull(user.deletedAt),
          ne(user.id, scope.userId),
          or(ilike(user.username, pattern), ilike(user.displayName, pattern)),
        ),
      )
      .orderBy(asc(user.username))
      .limit(limit);

    return rows.map((row) => ({
      userId: row.userId,
      username: row.username,
      displayName: row.displayName ?? null,
    }));
  }

  // ═══════════════════════════════════════════════════════════
  // Private helpers
  // ═══════════════════════════════════════════════════════════

  /** 获取用户档案视图（内部使用，调用方需自行验证访问权限） */
  private async getUserView(userId: number): Promise<UserProfileView> {
    const rows = await this.conn.db
      .select({
        userId: user.id,
        username: user.username,
        displayName: user.displayName,
        role: user.role,
        email: user.email,
        phone: user.phone,
        status: user.status,
        locale: userProfile.locale,
        accent: userProfile.accent,
        speechRate: userProfile.speechRate,
        perfTier: userProfile.perfTier,
        asrModel: userProfile.asrModel,
        dailyGoalMin: userProfile.dailyGoalMin,
        reportFrequency: userProfile.reportFrequency,
        stageCode: userProfile.stageCode,
        stageId: userProfile.stageId,
        calibrationDone: userProfile.calibrationDone,
        noiseFloorDb: userProfile.noiseFloorDb,
      })
      .from(userProfile)
      .leftJoin(user, eq(userProfile.userId, user.id))
      .where(eq(user.id, userId))
      .limit(1);

    const row = rows[0];
    if (row === undefined || row.userId === null || row.role === null) {
      throw notFoundError(ErrorCode.RESOURCE_NOT_FOUND, '用户档案不存在');
    }

    return {
      userId: row.userId,
      username: row.username ?? '',
      displayName: row.displayName ?? '',
      role: row.role,
      email: row.email ?? undefined,
      phone: row.phone ?? undefined,
      status: row.status ?? 'active',
      profile: {
        locale: row.locale ?? 'zh-CN',
        accent: row.accent ?? 'us',
        speechRate: row.speechRate ?? '1.00',
        perfTier: row.perfTier ?? 'auto',
        asrModel: row.asrModel ?? 'base',
        dailyGoalMin: row.dailyGoalMin ?? 15,
        reportFrequency: row.reportFrequency ?? 'weekly',
        stageCode: row.stageCode ?? undefined,
        stageId: row.stageId ?? undefined,
        calibrationDone: row.calibrationDone ?? false,
        noiseFloorDb: row.noiseFloorDb ?? undefined,
      },
    };
  }
}
