/**
 * 种子数据执行器 —— `pnpm --filter @eng-forge/db seed`
 *
 * 🔴 幂等：全部 `ON CONFLICT DO UPDATE`，重复执行结果一致。
 * 🔴 只写骨架：学段 / 教材骨架 / 权限矩阵。**不写任何教材原文与词条**
 *    （04 文档 §9.3 版权红线；词条是独立 ETL 任务，且每条必须带 license + source）。
 */

import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

/* eslint-disable no-console -- 本文件是 CLI 入口，输出 seed 结果到 stdout 是其职责 */
import { and, eq, sql } from 'drizzle-orm';

import type { PgDb } from '../client-pg.js';
import { createDb } from '../client.js';
import { permissionMatrix, stage, textbook, unit, volume } from '../schema/index.js';
import { PERMISSION_MATRIX, STAGES, TEXTBOOKS, VOLUMES } from '../seed/index.js';
import {
  PLACEHOLDER_UNITS_PER_VOLUME,
  TEXTBOOK_LICENSE_PLACEHOLDER,
  TEXTBOOK_SOURCE_PLACEHOLDER,
  buildPlaceholderUnits,
  textbookUniqueCode,
} from '../seed/textbooks.js';

/** 判断本模块是否作为入口被直接执行 */
function isMainModule(importMetaUrl: string): boolean {
  if (process.argv[1] === undefined) return false;
  return resolve(fileURLToPath(importMetaUrl)) === resolve(process.argv[1]);
}


/**
 * seed 用的 drizzle 实例类型。
 *
 * 说明：schema 全部用 `pgTable` 声明（双方言共用同一份定义），
 * better-sqlite3 的 drizzle 实例在运行时可正常消费 pg-core 表配置，
 * 但两者的 `insert()` / `from()` 是**重载签名**，TS 无法在
 * `PgDb | SqliteDb` 联合类型上调用。故此处取 pg-core 的 `PgDb` 作为
 * 规范类型，SQLite 档在 `main()` 里做**一次**显式转换（见该处注释）。
 * 这样业务逻辑内部保持完全类型安全，无需满处 cast。
 */
type SeedDb = PgDb;



/**
 * 🔴 better-sqlite3 **不接受 JS boolean**（只接受 number/string/bigint/buffer/null），
 *    而 PG 的 `pg` 驱动接受 boolean。schema 里 `enabled_in_mvp` / `is_official` /
 *    `can_read` / `can_write` 都是布尔列，直接插 `true` 在 SQLite 档会报
 *    「can only bind numbers, strings, bigints, buffers, and null」。
 *
 *    解法：这里返回 `boolean | number`，并在插入处用 `as never` 之外的
 *    显式收窄——但更干净的做法是让 `bool()` 返回值直接满足 drizzle 的
 *    `boolean` 类型（运行时值仍是 0/1）。见 `asSqliteBool` 的实现。
 */
const bool = (dialect: 'postgres' | 'sqlite', value: boolean): boolean => {
  if (dialect !== 'sqlite') return value;
  // SQLite 存 0/1；TS 侧仍声明为 boolean，由 drizzle 以参数化查询下发 0/1
  return (value ? 1 : 0) as unknown as boolean;
};


/** 教材骨架写入统计 */
export interface SeedStats {
  stages: number;
  textbooks: number;
  volumes: number;
  units: number;
  permissions: number;
}

export async function runSeed(db: SeedDb, dialect: 'postgres' | 'sqlite'): Promise<SeedStats> {
  // ── 1. 学段 ────────────────────────────────────────────
  for (const s of STAGES) {
    await db
      .insert(stage)
      .values({
        code: s.code,
        nameZh: s.nameZh,
        nameEn: s.nameEn,
        sortOrder: s.sortOrder,
        enabledInMvp: bool(dialect, s.enabledInMvp),
        minAge: s.minAge,
        maxAge: s.maxAge,
      })
      .onConflictDoUpdate({
        target: stage.code,
        set: {
          nameZh: sql`excluded.name_zh`,
          nameEn: sql`excluded.name_en`,
          sortOrder: sql`excluded.sort_order`,
          enabledInMvp: sql`excluded.enabled_in_mvp`,
        },
      });
  }

  const stageIds = new Map<string, number>();
  for (const row of await db.select({ code: stage.code, id: stage.id }).from(stage)) {
    stageIds.set(row.code, row.id);
  }

  // ── 2. 教材 / 册次 / 单元骨架 ─────────────────────────
  let volumeCount = 0;
  let unitCount = 0;

  for (const tb of TEXTBOOKS) {
    const stageId = stageIds.get(tb.stage);
    if (stageId === undefined) {
      throw new Error(`学段不存在：${tb.stage}（stage seed 未成功）`);
    }
    const tbCode = textbookUniqueCode(tb);

    await db
      .insert(textbook)
      .values({
        stageId,
        code: tbCode,
        nameZh: tb.nameZh,
        nameEn: tb.nameEn,
        publisher: tb.publisher,
        region: 'CN',
        // 🔴 教材内容需授权 → 标记 official，用户自行导入词表
        isOfficial: bool(dialect, true),
        license: TEXTBOOK_LICENSE_PLACEHOLDER,
        source: TEXTBOOK_SOURCE_PLACEHOLDER,
        enabledInMvp: bool(dialect, tb.enabledInMvp),
      })
      .onConflictDoUpdate({
        target: textbook.code,
        set: {
          nameZh: sql`excluded.name_zh`,
          nameEn: sql`excluded.name_en`,
          publisher: sql`excluded.publisher`,
          enabledInMvp: sql`excluded.enabled_in_mvp`,
        },
      });

    const [tbRow] = await db
      .select({ id: textbook.id })
      .from(textbook)
      .where(eq(textbook.code, tbCode));
    if (tbRow === undefined) throw new Error(`教材写入失败：${tbCode}`);

    for (const v of VOLUMES.slice(0, tb.volumeCount)) {
      await db
        .insert(volume)
        .values({
          textbookId: tbRow.id,
          code: v.code,
          nameZh: v.nameZh,
          grade: v.grade,
          term: v.term,
          sortOrder: v.index,
          enabledInMvp: bool(dialect, tb.enabledInMvp),
        })
        .onConflictDoUpdate({
          target: [volume.textbookId, volume.code],
          set: {
            nameZh: sql`excluded.name_zh`,
            grade: sql`excluded.grade`,
            term: sql`excluded.term`,
            sortOrder: sql`excluded.sort_order`,
          },
        });
      volumeCount += 1;

      // 🔴 必须同时按 textbook_id 过滤：4 套教材的册次 code 完全相同
      //    （都是 g3a/g3b/…），只按 code 查会命中第一套教材的册次，
      //    导致后续单元全部挂到同一个 volume 上（32×6 → 只剩 48 行）。
      const [volRow] = await db
        .select({ id: volume.id })
        .from(volume)
        .where(and(eq(volume.textbookId, tbRow.id), eq(volume.code, v.code)));
      if (volRow === undefined) throw new Error(`册次写入失败：${tbCode}/${v.code}`);

      for (const u of buildPlaceholderUnits(v.code, PLACEHOLDER_UNITS_PER_VOLUME)) {
        await db
          .insert(unit)
          .values({ volumeId: volRow.id, code: u.code, nameZh: u.nameZh, sortOrder: u.sortOrder })
          .onConflictDoUpdate({
            target: [unit.volumeId, unit.code],
            set: { nameZh: sql`excluded.name_zh`, sortOrder: sql`excluded.sort_order` },
          });
        unitCount += 1;
      }
    }
  }

  // ── 3. 权限矩阵（4 角色 × 11 功能 = 44 行）────────────
  for (const p of PERMISSION_MATRIX) {
    await db
      .insert(permissionMatrix)
      .values({
        role: p.role,
        feature: p.feature,
        canRead: bool(dialect, p.canRead),
        canWrite: bool(dialect, p.canWrite),
      })
      .onConflictDoUpdate({
        target: [permissionMatrix.role, permissionMatrix.feature],
        set: { canRead: sql`excluded.can_read`, canWrite: sql`excluded.can_write` },
      });
  }

  return {
    stages: STAGES.length,
    textbooks: TEXTBOOKS.length,
    volumes: volumeCount,
    units: unitCount,
    permissions: PERMISSION_MATRIX.length,
  };
}

export async function main(): Promise<void> {
  // 🔴 与 migrate.ts 保持一致：支持 --dialect= 参数显式指定方言。
  //    之前 seed 没有这个入口，导致 `DATABASE_URL=file:... pnpm seed`
  //    在 DB_DIALECT 缺省时走 PG 档报 ECONNREFUSED（已修 resolveDialect 的 URL 兜底，
  //    但显式参数仍应保留，方便 CI 明确指定）。
  const argv = process.argv.slice(2);
  const dialectArg = argv.find((a) => a.startsWith('--dialect='));
  if (dialectArg !== undefined) {
    process.env.DB_DIALECT = dialectArg.slice('--dialect='.length);
  }
  const client = createDb();
  try {
    // SQLite 档的实例类型与 pg-core 不同（见 SeedDb 注释），此处做唯一一次转换
    const stats = await runSeed(client.db as unknown as SeedDb, client.dialect);
    console.log(
      `[db] seed 完成（方言=${client.dialect}）：学段 ${stats.stages} / 教材 ${stats.textbooks} / ` +
        `册次 ${stats.volumes} / 单元 ${stats.units} / 权限 ${stats.permissions}`,
    );
    console.log('[db] 版权提示：本次未写入任何教材原文与词条，词条由独立 ETL 任务导入（须带 license + source）');
  } finally {
    await client.close();
  }
}


// 直接执行本文件时运行（被 import 时不自动执行，便于测试直接调 runSeed）
if (process.argv[1] !== undefined && isMainModule(import.meta.url)) {
  main().catch((err: unknown) => {
    // 🔴 错误格式化要覆盖非标准 throw（如 better-sqlite3 抛的 SqliteError）
    //    之前写成 (err as Error).message，遇到非 Error 对象会打印空字符串，
    //    把真实原因完全掩盖 —— 排查时只能看到 "[db] seed 失败：" 后什么都没有。
    const reason =
      err instanceof Error
        ? (err.stack ?? `${err.name}: ${err.message}`)
        : `非 Error 对象：${safeStringify(err)}`;
    console.error(`[db] seed 失败：${reason}`);
    process.exitCode = 1;
  });
}

/** 把任意值转成可读字符串，避免 JSON.stringify 对循环引用抛错 */
function safeStringify(value: unknown): string {
  try {
    return JSON.stringify(value) ?? String(value);
  } catch {
    return String(value);
  }
}
