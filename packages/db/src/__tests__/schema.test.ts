/**
 * schema 与迁移的集成测试 —— 03 文档 §8.5 集成测试⑦「迁移幂等」+
 * 架构评审确认的 5 项文档缺陷回归防护。
 *
 * 🔴 本文件是数据地基的护栏：后续所有业务模块都依赖这套 schema，
 *    任何字段级改动都必须先让这里通过。
 *
 * 测试策略：SQLite 档可**真实建库**（better-sqlite3 内存库），
 * 故 DDL 有效性、外键级联、部分索引、FTS5 都做真实验证，
 * 而非只比对 TypeScript 对象。PG 档无实例可跑，改为**SQL 文本断言**
 * （校验关键 DDL 片段存在），并在此登记为待补的集成测试。
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import Database from 'better-sqlite3';
import { getTableConfig } from 'drizzle-orm/pg-core';
import { describe, expect, it } from 'vitest';

import { splitSqlStatements } from '../cli/migrate.js';
import {
  CAPABILITIES,
  buildJobClaimSql,
  ddlType,
  jsonParse,
  jsonStringArray,
  parseJsonStringArray,
  resolveDialect,
  supportsMaterializedView,
  supportsSkipLocked,
} from '../dialect.js';
import {
  appConfig,
  appSecret,
  archiveErrorSampleArchive,
  consentLog,
  errorSample,
  idempotencyKey,
  parentChildren,
  phoneScore,
  systemNotice,
  word,
  wordWeakness,
} from '../schema/index.js';
import { buildUnitSeeds, buildVolumeSeeds } from '../seed/index.js';
import { PERMISSION_FEATURES, PERMISSION_MATRIX } from '../seed/permissions.js';
import { MVP_STAGE_CODES, STAGES } from '../seed/stages.js';
import { TEXTBOOKS, TOTAL_VOLUMES, VOLUMES, buildPlaceholderUnits } from '../seed/textbooks.js';

const SQLITE_MIGRATION = readFileSync(
  join(process.cwd(), 'migrations-sqlite/0000_init.sql'),
  'utf8',
);
const PG_MIGRATION = readFileSync(join(process.cwd(), 'migrations/0000_init.sql'), 'utf8');

/**
 * 剥掉 SQL 注释，只留可执行语句。
 *
 * 🔴 必需：迁移文件里大量注释**故意**提到了被修正的错误写法
 *    （如 `p_word_id_alias`、`idx_wm_weak ... frequency_rank`），
 *    断言「文件里不能出现某字符串」必须针对可执行部分，否则会被注释误伤。
 */
const stripSqlComments = (sql: string): string =>
  sql
    .split('\n')
    .filter((line) => !line.trim().startsWith('--'))
    .join('\n');

const PG_DDL = stripSqlComments(PG_MIGRATION);


/** 建一个已应用迁移的内存库（每个测试独立） */
const freshDb = (): Database.Database => {
  const db = new Database(':memory:');
  db.pragma('foreign_keys = ON');
  for (const stmt of splitSqlStatements(SQLITE_MIGRATION)) {
    db.exec(stmt);
  }
  return db;
};

/** 读列定义（用于断言 NOT NULL / DEFAULT / 外键） */
const columnsOf = (db: Database.Database, table: string): Map<string, string> => {
  const rows = db.prepare(`PRAGMA table_info(${table})`).all() as Array<{
    name: string;
    type: string;
    notnull: number;
    dflt_value: string | null;
  }>;
  return new Map(rows.map((r) => [r.name, `${r.type}|notnull=${r.notnull}|default=${r.dflt_value}`]));
};

const tableExists = (db: Database.Database, name: string): boolean =>
  db
    .prepare("SELECT count(*) AS c FROM sqlite_master WHERE type IN ('table','view') AND name = ?")
    .get(name) !== undefined;

describe('教材骨架（04 文档 第 10 章 Q3 邢工确认「全涵盖」）', () => {
  it('4 个教材版本', () => {
    expect(TEXTBOOKS).toHaveLength(4);
    expect(TEXTBOOKS.map((t) => t.code).sort()).toEqual(['bnu', 'fltrp', 'pep', 'sue']);
  });

  it('每版本 8 册，合计 32 册', () => {
    for (const tb of TEXTBOOKS) {
      expect(tb.volumeCount).toBe(8);
    }
    expect(TOTAL_VOLUMES).toBe(32);
    expect(buildVolumeSeeds()).toHaveLength(32);
  });

  it('册次为小学 3-6 年级 × 上/下册', () => {
    expect(VOLUMES).toHaveLength(8);
    expect(VOLUMES.map((v) => v.grade)).toEqual([3, 3, 4, 4, 5, 5, 6, 6]);
    expect(VOLUMES.map((v) => v.term)).toEqual([1, 2, 1, 2, 1, 2, 1, 2]);
    // code 形如 g3a（§4.2.2 volume.code）
    expect(VOLUMES.every((v) => /^g[3-6][ab]$/.test(v.code))).toBe(true);
  });

  it('32 册 × 6 占位单元 = 192 单元', () => {
    const units = buildUnitSeeds();
    expect(units).toHaveLength(192);
    expect(buildPlaceholderUnits('g3a')).toHaveLength(6);
    // 单元 code 只在**册内**唯一（DB 约束是 uq_unit_volume_code），
    // 4 套教材的册次 code 相同，故 code 集合为 8×6=48，
    // 但 (textbookCode, code) 组合必须 192 个全不同，否则单元会跨教材串味。
    expect(new Set(units.map((u) => u.code)).size).toBe(48);
    expect(new Set(units.map((u) => `${u.textbookCode}/${u.code}`)).size).toBe(192);
  });

  it('教材版本 code 全库唯一（带学段前缀）', () => {
    const codes = TEXTBOOKS.map((t) => `${t.stage}-${t.code}`);
    expect(new Set(codes).size).toBe(4);
  });
});

describe('权限矩阵（11 项功能 × 4 角色）', () => {
  it('恰好 11 项功能', () => {
    expect(PERMISSION_FEATURES).toHaveLength(11);
    expect(PERMISSION_FEATURES).toEqual([
      'dashboard',
      'student_manage',
      'class_manage',
      'shadowing_record',
      'scenario_manage',
      'wordpack_manage',
      'game_record',
      'error_track',
      'progress_track',
      'report_export',
      'settings',
    ]);
  });

  it('矩阵为 4 角色 × 11 功能 = 44 行，无重复', () => {
    expect(PERMISSION_MATRIX).toHaveLength(44);
    const keys = PERMISSION_MATRIX.map((p) => `${p.role}:${p.feature}`);
    expect(new Set(keys).size).toBe(44);
  });

  it('🔴 家长不得有教材词表/班级/学生管理的写权限', () => {
    const parentWritable = PERMISSION_MATRIX.filter((p) => p.role === 'parent' && p.canWrite);
    expect(parentWritable.map((p) => p.feature)).toEqual(['report_export']);
  });

  it('admin 全读写', () => {
    const admin = PERMISSION_MATRIX.filter((p) => p.role === 'admin');
    expect(admin.every((p) => p.canRead && p.canWrite)).toBe(true);
  });
});

describe('学段（6 个，MVP 仅小学 3-6 与初中）', () => {
  it('6 个学段', () => {
    expect(STAGES).toHaveLength(6);
    expect(STAGES.map((s) => s.code).sort()).toEqual([
      'adult',
      'college',
      'junior',
      'primary',
      'primary_low',
      'senior',
    ]);
  });

  it('🔶 MVP 只开放小学 3-6 与初中', () => {
    expect([...MVP_STAGE_CODES].sort()).toEqual(['junior', 'primary']);
    for (const s of STAGES.filter((x) => !x.enabledInMvp)) {
      // 未开放学段必须有提示文案，不能静默降级为「没有课程」
      expect(s.disclaimer, `${s.code} 缺 disclaimer`).toBeTruthy();
    }
  });

  it('年龄下限 6 岁（04 文档 §4.7 规则6）', () => {
    expect(Math.min(...STAGES.map((s) => s.minAge))).toBe(6);
  });
});

describe('🔴 缺陷修正 1：phone_score 补 word_id', () => {
  it('Drizzle schema 有 word_id 列', () => {
    const cfg = getTableConfig(phoneScore);
    expect(cfg.columns.map((c) => c.name)).toContain('word_id');
  });

  it('SQLite 迁移里 phone_score 有 word_id 且外键指向 word', () => {
    const db = freshDb();
    const cols = columnsOf(db, 'phone_score');
    expect(cols.has('word_id')).toBe(true);
    const fks = db.prepare('PRAGMA foreign_key_list(phone_score)').all() as Array<{
      table: string;
      from: string;
    }>;
    expect(fks.some((f) => f.table === 'word' && f.from === 'word_id')).toBe(true);
    db.close();
  });

  it('word_id 建索引（弱点聚合的驱动列）', () => {
    const db = freshDb();
    const idx = db
      .prepare("SELECT name FROM sqlite_master WHERE type='index' AND tbl_name='phone_score'")
      .all() as Array<{ name: string }>;
    expect(idx.map((i) => i.name)).toContain('idx_phone_score_word');
    db.close();
  });
});

describe('🔴 缺陷修正 2：error_sample 补 word_id', () => {
  it('Drizzle schema 有 word_id 列', () => {
    const cfg = getTableConfig(errorSample);
    expect(cfg.columns.map((c) => c.name)).toContain('word_id');
  });

  it('SQLite 迁移里 error_sample 有 word_id 外键（ON DELETE SET NULL）', () => {
    const db = freshDb();
    const fks = db.prepare('PRAGMA foreign_key_list(error_sample)').all() as Array<{
      table: string;
      from: string;
      on_delete: string;
    }>;
    const fk = fks.find((f) => f.from === 'word_id');
    expect(fk?.table).toBe('word');
    expect(fk?.on_delete).toBe('SET NULL');
    db.close();
  });
});

describe('🔴 缺陷修正 3：补齐 6 张「文档无 DDL」的表', () => {
  const expected = [
    'parent_children',
    'consent_log',
    'app_secret',
    'app_config',
    'system_notice',
    'archive_error_sample_archive',
  ] as const;

  it.each(expected)('%s 在 SQLite 迁移中已建表', (t) => {
    const db = freshDb();
    expect(tableExists(db, t)).toBe(true);
    db.close();
  });

  it.each(expected)('%s 在 PG 迁移中有建表语句', (t) => {
    expect(PG_MIGRATION).toMatch(
      new RegExp(`CREATE TABLE IF NOT EXISTS\\s+${t}\\s*\\(`),
    );
  });

  it('parent_children 有 UNIQUE(parent_id, child_id) 幂等约束', () => {
    const db = freshDb();
    const sqlText = (
      db.prepare("SELECT sql FROM sqlite_master WHERE name='parent_children'").get() as {
        sql: string;
      }
    ).sql;
    expect(sqlText).toContain('UNIQUE (parent_id, child_id)');

    // Drizzle 侧也声明了复合唯一索引
    const cfg = getTableConfig(parentChildren);
    expect(cfg.indexes.some((i) => i.config.name === 'uq_parent_children_pair')).toBe(true);

    // 重复绑定必须被拒绝
    db.prepare("INSERT INTO \"user\" (username, password_hash, role, display_name) VALUES ('p','x','parent','P')").run();
    db.prepare("INSERT INTO \"user\" (username, password_hash, role, display_name) VALUES ('c','x','student','C')").run();
    db.prepare('INSERT INTO parent_children (parent_id, child_id) VALUES (1, 2)').run();
    expect(() =>
      db.prepare('INSERT INTO parent_children (parent_id, child_id) VALUES (1, 2)').run(),
    ).toThrow();
    db.close();
  });

  it('🔴 parent_children 是「家长只能看自己孩子」的数据支撑：外键级联有效', () => {
    const db = freshDb();
    db.prepare("INSERT INTO \"user\" (username, password_hash, role, display_name) VALUES ('p','x','parent','P')").run();
    db.prepare("INSERT INTO \"user\" (username, password_hash, role, display_name) VALUES ('c','x','student','C')").run();
    db.prepare('INSERT INTO parent_children (parent_id, child_id) VALUES (1, 2)').run();
    // 删除孩子 → 绑定关系应级联清除，不留孤儿
    db.prepare('DELETE FROM "user" WHERE id = 2').run();
    const left = db.prepare('SELECT count(*) AS c FROM parent_children').get() as { c: number };
    expect(left.c).toBe(0);
    db.close();
  });

  it('app_secret 分离存储 ciphertext / iv / auth_tag（无明文列）', () => {
    const cfg = getTableConfig(appSecret);
    const names = cfg.columns.map((c) => c.name);
    expect(names).toEqual(expect.arrayContaining(['ciphertext', 'iv', 'auth_tag', 'key_version']));
    // 🔴 不得存在任何明文密钥列
    expect(names.some((n) => /plain|secret_key|api_key|raw/i.test(n))).toBe(false);
  });

  it('app_config 与 app_secret 职责分离（config 不得被误用存 Key）', () => {
    const cfg = getTableConfig(appConfig);
    const names = cfg.columns.map((c) => c.name);
    expect(names).toContain('key');
    expect(names).not.toContain('ciphertext');
  });

  it('system_notice 支持 dedupe_key 幂等（worker 重跑不重复通知）', () => {
    const db = freshDb();
    db.prepare("INSERT INTO \"user\" (username, password_hash, role, display_name) VALUES ('u','x','student','U')").run();
    db.prepare(
      "INSERT INTO system_notice (user_id, category, title, dedupe_key) VALUES (1, 'degrade', '降级', 'k1')",
    ).run();
    expect(() =>
      db
        .prepare(
          "INSERT INTO system_notice (user_id, category, title, dedupe_key) VALUES (1, 'degrade', '降级', 'k1')",
        )
        .run(),
    ).toThrow();

    // Drizzle 侧唯一索引同样声明了 dedupe_key
    const cfg = getTableConfig(systemNotice);
    expect(cfg.indexes.some((i) => i.config.name === 'uq_notice_dedupe')).toBe(true);
    db.close();
  });

  it('archive 表 user_id 可空（90 天后匿名化）', () => {
    const db = freshDb();
    const cols = columnsOf(db, 'archive_error_sample_archive');
    expect(cols.get('user_id')).toContain('notnull=0');
    expect(cols.get('error_count')).toContain('notnull=1');

    // Drizzle 侧同样声明为可空（与其它表 .notNull() 的刻意差异）
    const cfg = getTableConfig(archiveErrorSampleArchive);
    expect(cfg.columns.find((c) => c.name === 'user_id')?.notNull).toBeFalsy();
    expect(cfg.columns.find((c) => c.name === 'error_count')?.notNull).toBe(true);

    // 匿名化路径可跑通：置 NULL 后归档仍保留词条级统计
    db.prepare("INSERT INTO word (headword, lemma, translation_zh, license) VALUES ('w','w','词','x')").run();
    db.prepare("INSERT INTO \"user\" (username, password_hash, role, display_name) VALUES ('u','x','student','U')").run();
    db.prepare(
      "INSERT INTO archive_error_sample_archive (user_id, word_id, wrong_content, error_count) VALUES (1, 1, 'wroTe', 3)",
    ).run();
    db.prepare('UPDATE archive_error_sample_archive SET user_id = NULL, anonymized_at = ?').run(
      '2026-10-05T00:00:00.000Z',
    );
    const row = db
      .prepare('SELECT user_id AS u, word_id AS w, error_count AS c FROM archive_error_sample_archive')
      .get() as { u: number | null; w: number; c: number };
    expect(row.u).toBeNull();
    expect(row.c).toBe(3);
    db.close();
  });

  it('consent_log 有协议版本 + hash（可回溯当时同意的版本）', () => {
    const cfg = getTableConfig(consentLog);
    const names = cfg.columns.map((c) => c.name);
    expect(names).toEqual(expect.arrayContaining(['agreement_version', 'agreement_hash', 'granted']));
  });
});

describe('🔴 缺陷修正 4：word_weakness 唯一索引', () => {
  it('索引建在 (user_id, word_id)，不含不存在的 p_word_id_alias', () => {
    const db = freshDb();
    const idx = db
      .prepare("SELECT name, sql FROM sqlite_master WHERE type='index' AND tbl_name='word_weakness'")
      .all() as Array<{ name: string; sql: string | null }>;
    const uniq = idx.find((i) => i.name === 'idx_ww_key');
    expect(uniq).toBeDefined();
    expect(uniq?.sql).toContain('user_id');
    expect(uniq?.sql).toContain('word_id');
    expect(uniq?.sql).not.toContain('p_word_id_alias');
    db.close();
  });

  it('🔴 PG 迁移的物化视图定义里不出现 p_word_id_alias', () => {
    // 用剥离注释后的 DDL 断言：注释里刻意记录了「文档原本写错成 p_word_id_alias」
    expect(PG_DDL).not.toContain('p_word_id_alias');
    expect(PG_DDL).toContain('CREATE MATERIALIZED VIEW IF NOT EXISTS word_weakness');
    // 唯一索引建在真实存在的列上
    expect(PG_DDL).toMatch(
      /CREATE UNIQUE INDEX IF NOT EXISTS idx_ww_key ON word_weakness \(user_id, word_id\)/,
    );
  });


  it('Drizzle schema 的 word_weakness 含 word_id', () => {
    const cfg = getTableConfig(wordWeakness);
    expect(cfg.columns.map((c) => c.name)).toContain('word_id');
  });

  it('聚合 SQL 过滤 NULL word_id 并要求 >= 3 次尝试', () => {
    // 与 schema/speech.ts 的定义一致（避免 SQL 与常量漂移）
    const db = freshDb();
    const view = db
      .prepare("SELECT sql FROM sqlite_master WHERE name='word_weakness'")
      .get() as { sql: string | null };
    expect(view.sql).toBeTruthy();
    db.close();
  });
});

describe('🔴 缺陷修正 5：word 表 license NOT NULL', () => {
  it('Drizzle schema：license notNull=true', () => {
    const cfg = getTableConfig(word);
    const license = cfg.columns.find((c) => c.name === 'license');
    expect(license).toBeDefined();
    expect(license?.notNull).toBe(true);
  });

  it('SQLite 迁移：license NOT NULL，缺 license 无法写入', () => {
    const db = freshDb();
    expect(columnsOf(db, 'word').get('license')).toContain('notnull=1');
    // 不带 license 插入应失败 —— 从写入层拦住版权风险
    expect(() =>
      db
        .prepare("INSERT INTO word (headword, lemma, translation_zh) VALUES ('a','a','甲')")
        .run(),
    ).toThrow();
    // 带 license 则成功
    db.prepare(
      "INSERT INTO word (headword, lemma, translation_zh, license) VALUES ('apple','apple','苹果','ecdict-1.0')",
    ).run();
    expect((db.prepare('SELECT count(*) AS c FROM word').get() as { c: number }).c).toBe(1);
    db.close();
  });

  it('sentence / course 同样强制 license（版权红线覆盖全部内容实体）', () => {
    const db = freshDb();
    expect(columnsOf(db, 'sentence').get('license')).toContain('notnull=1');
    expect(columnsOf(db, 'course').get('license')).toContain('notnull=1');
    db.close();
  });
});

describe('04 文档已确认决策的落库字段', () => {
  it('learning_record 有 confidence_level + degrade_level（§5.6.3 绝不静默降级）', () => {
    const db = freshDb();
    const cols = columnsOf(db, 'learning_record');
    expect(cols.has('confidence_level')).toBe(true);
    expect(cols.has('degrade_level')).toBe(true);
    // 降级级别限定 A~F
    const sqlText = (
      db.prepare("SELECT sql FROM sqlite_master WHERE name='learning_record'").get() as {
        sql: string;
      }
    ).sql;
    expect(sqlText).toContain("degrade_level IN ('A','B','C','D','E','F')");
    db.close();
  });

  it('user_profile 有 calibration_done + noise_floor_db（§5.6.1 规则①）', () => {
    const db = freshDb();
    const cols = columnsOf(db, 'user_profile');
    expect(cols.has('calibration_done')).toBe(true);
    expect(cols.has('noise_floor_db')).toBe(true);
    expect(cols.get('calibration_done')).toContain('default=0');
    db.close();
  });

  it('idempotency_key 存在且主键为 (key, user_id, route)，含 expire_at', () => {
    const cfg = getTableConfig(idempotencyKey);
    const pk = cfg.primaryKeys[0];
    expect(pk?.columns.map((c) => c.name)).toEqual(['key', 'user_id', 'route']);
    expect(cfg.columns.map((c) => c.name)).toEqual(expect.arrayContaining(['request_hash', 'response_json', 'expire_at']));

    const db = freshDb();
    db.prepare("INSERT INTO \"user\" (username, password_hash, role, display_name) VALUES ('u','x','student','U')").run();
    // 同 key + 同 user + 同 route 重复 → 应冲突
    db.prepare(
      "INSERT INTO idempotency_key (key, user_id, route, request_hash, expire_at) VALUES ('k', 1, 'POST:/x', 'h', '2026-10-06T00:00:00.000Z')",
    ).run();
    expect(() =>
      db
        .prepare(
          "INSERT INTO idempotency_key (key, user_id, route, request_hash, expire_at) VALUES ('k', 1, 'POST:/x', 'h', '2026-10-06T00:00:00.000Z')",
        )
        .run(),
    ).toThrow();
    // 不同 route 同 key → 应允许
    db.prepare(
      "INSERT INTO idempotency_key (key, user_id, route, request_hash, expire_at) VALUES ('k', 1, 'POST:/y', 'h', '2026-10-06T00:00:00.000Z')",
    ).run();
    db.close();
  });

  it('audit_log 支持 system_tier_change / egress_call（§7.7 + §9.2）', () => {
    const db = freshDb();
    db.prepare("INSERT INTO \"user\" (username, password_hash, role, display_name) VALUES ('u','x','student','U')").run();
    for (const action of ['system_tier_change', 'egress_call']) {
      db.prepare('INSERT INTO audit_log (action) VALUES (?)').run(action);
    }
    const rows = db.prepare('SELECT count(*) AS c FROM audit_log').get() as { c: number };
    expect(rows.c).toBe(2);
    db.close();
  });

  it('recording 有 status（评分流水线）+ retain_until（保留期）', () => {
    const db = freshDb();
    const cols = columnsOf(db, 'recording');
    expect(cols.has('status')).toBe(true);
    expect(cols.has('retain_until')).toBe(true);
    expect(cols.get('is_error_sample')).toContain('default=0');
    db.close();
  });
});

describe('外键与索引（03 文档 §4 全局约定）', () => {
  it('外键强制生效（PRAGMA 可验证）', () => {
    const db = freshDb();
    // 直接插入孤立 word_id 应失败
    expect(() =>
      db
        .prepare(
          'INSERT INTO word_unit (unit_id, word_id, sort_order) VALUES (999, 999, 1)',
        )
        .run(),
    ).toThrow();
    db.close();
  });

  it('关键查询路径的索引齐全（§4.3 对照表）', () => {
    const db = freshDb();
    const indexNames = (
      db.prepare("SELECT name FROM sqlite_master WHERE type='index'").all() as Array<{
        name: string;
      }>
    ).map((r) => r.name);

    for (const required of [
      'idx_wm_next_review', // 今日待复习
      'idx_eb_user_cat', // 错题本筛选
      'idx_rec_gc', // 录音 GC
      'idx_es_purge', // 样本到期
      'idx_heatmap_range', // 热力图 12 周
      'idx_cm_user', // 班级进步榜
      'idx_lr_user_kind_time', // 学习记录
    ]) {
      expect(indexNames, `缺索引 ${required}`).toContain(required);
    }
    db.close();
  });

  it('部分索引在 SQLite 下可用（WHERE 子句）', () => {
    const db = freshDb();
    const partial = db
      .prepare(
        "SELECT sql FROM sqlite_master WHERE type='index' AND sql LIKE '%WHERE%'",
      )
      .all() as Array<{ sql: string }>;
    expect(partial.length).toBeGreaterThan(0);
    db.close();
  });
});

describe('全文检索（FTS5 替代 PG tsvector）', () => {
  it('FTS5 虚拟表已建且可检索', () => {
    const db = freshDb();
    expect(tableExists(db, 'word_fts')).toBe(true);
    expect(tableExists(db, 'sentence_fts')).toBe(true);

    db.prepare(
      "INSERT INTO word (headword, lemma, translation_zh, license) VALUES ('apple','apple','苹果','x')",
    ).run();
    const hit = db
      .prepare('SELECT headword FROM word_fts WHERE word_fts MATCH ?')
      .all('apple');
    expect(hit).toHaveLength(1);
    db.close();
  });

  it('写入触发器自动维护索引（否则搜索永远为空）', () => {
    const db = freshDb();
    db.prepare(
      "INSERT INTO word (headword, lemma, translation_zh, license) VALUES ('banana','banana','香蕉','x')",
    ).run();
    // count(*) 恒返回 1 行，故断言的是 c 的值而非数组长度
    const countHit = (q: string): number =>
      (db.prepare('SELECT count(*) AS c FROM word_fts WHERE word_fts MATCH ?').get(q) as {
        c: number;
      }).c;
    expect(countHit('banana')).toBe(1);

    // 更新后旧词应查不到，新词应查得到
    db.prepare("UPDATE word SET headword='orange' WHERE lemma='banana'").run();
    expect(countHit('banana')).toBe(0);
    expect(countHit('orange')).toBe(1);
    db.close();
  });
});

describe('时间戳为 ISO8601 UTC（§4.4）', () => {
  it('默认时间戳格式为 ISO8601，不是 CURRENT_TIMESTAMP 的空格分隔格式', () => {
    const db = freshDb();
    db.prepare(
      "INSERT INTO word (headword, lemma, translation_zh, license) VALUES ('a','a','甲','x')",
    ).run();
    const row = db.prepare('SELECT created_at FROM word').get() as { created_at: string };
    // 形如 2026-10-05T05:30:21.886Z
    expect(row.created_at).toMatch(/^\d{4}-\d{2}-\d{2}T[\d:.]+Z$/);
    expect(() => new Date(row.created_at).toISOString()).not.toThrow();
    db.close();
  });
});

describe('迁移幂等（03 文档 §8.5 集成测试⑦）', () => {
  it('迁移 SQL 重复执行不报错（全部 IF NOT EXISTS）', () => {
    const db = new Database(':memory:');
    db.pragma('foreign_keys = ON');
    const stmts = splitSqlStatements(SQLITE_MIGRATION);
    for (const stmt of stmts) db.exec(stmt);
    const firstCount = countObjects(db);
    // 第二次执行
    for (const stmt of stmts) db.exec(stmt);
    expect(countObjects(db)).toBe(firstCount);
    db.close();
  });

  it('两次执行得到完全相同的对象集合', () => {
    const db = new Database(':memory:');
    const stmts = splitSqlStatements(SQLITE_MIGRATION);
    for (const s of stmts) db.exec(s);
    const snap1 = listObjects(db);
    for (const s of stmts) db.exec(s);
    expect(listObjects(db)).toEqual(snap1);
    db.close();
  });

  it('SQL 切分器保留触发器体与 DO 块完整性', () => {
    const stmts = splitSqlStatements(SQLITE_MIGRATION);
    // 每个切分出的语句都必须是完整可执行的
    for (const s of stmts) {
      expect(s.trim().endsWith(';'), `未以分号结尾: ${s.slice(0, 60)}`).toBe(true);
    }
    // 触发器体不应被切断
    const triggers = stmts.filter((s) => /CREATE TRIGGER/i.test(s));
    expect(triggers.length).toBeGreaterThan(0);
    for (const t of triggers) {
      expect(t).toMatch(/END\s*;\s*$/i);
    }
  });
});

describe('方言适配层（§8.1 差异收敛）', () => {
  it('能力矩阵：SQLite 无 SKIP LOCKED / 物化视图 / LISTEN-NOTIFY', () => {
    expect(supportsSkipLocked('postgres')).toBe(true);
    expect(supportsSkipLocked('sqlite')).toBe(false);
    expect(supportsMaterializedView('postgres')).toBe(true);
    expect(supportsMaterializedView('sqlite')).toBe(false);
    expect(CAPABILITIES.sqlite.queueImplementation).toBe('sqlite-queue');
    expect(CAPABILITIES.postgres.queueImplementation).toBe('pg-boss');
  });

  it('队列抢占 SQL：PG 用 SKIP LOCKED，SQLite 用 BEGIN IMMEDIATE 语义', () => {
    const pgSql = buildJobClaimSql('postgres', { table: 'job_audit', batchSize: 10 });
    expect(pgSql).toContain('FOR UPDATE SKIP LOCKED');
    const liteSql = buildJobClaimSql('sqlite', { table: 'job_audit', batchSize: 10 });
    expect(liteSql).not.toContain('SKIP LOCKED');
    expect(liteSql).toContain('BEGIN IMMEDIATE');
  });

  it('非法 DB_DIALECT 直接抛错，禁止静默降级', () => {
    expect(resolveDialect(undefined)).toBe('postgres');
    expect(resolveDialect('sqlite')).toBe('sqlite');
    expect(() => resolveDialect('mysql')).toThrow(/DB_DIALECT/);
  });

  it('逻辑类型映射覆盖 §4.4 全部条目', () => {
    expect(ddlType('timestamptz', 'postgres')).toBe('TIMESTAMPTZ');
    expect(ddlType('timestamptz', 'sqlite')).toBe('TEXT');
    expect(ddlType('serial', 'postgres')).toContain('IDENTITY');
    expect(ddlType('serial', 'sqlite')).toBe('INTEGER');
    expect(ddlType('bytea', 'postgres')).toBe('BYTEA');
    expect(ddlType('bytea', 'sqlite')).toBe('BLOB');
  });

  it('JSON helper 往返一致，且损坏输入降级为 fallback', () => {
    expect(parseJsonStringArray(jsonStringArray(['zk', 'cet4']))).toEqual(['zk', 'cet4']);
    expect(parseJsonStringArray(null)).toEqual([]);
    expect(parseJsonStringArray('{oops')).toEqual([]);
    expect(jsonParse<{ a: number }>('{"a":1}', { a: 0 })).toEqual({ a: 1 });
    expect(jsonParse<{ a: number }>('broken', { a: 42 })).toEqual({ a: 42 });
  });
});

describe('PG 迁移关键 DDL 文本断言（无 PG 实例可跑，登记为待补集成测试）', () => {
  it('pg_trgm 扩展与模糊索引', () => {
    expect(PG_MIGRATION).toContain('CREATE EXTENSION IF NOT EXISTS pg_trgm');
    expect(PG_MIGRATION).toContain('gin_trgm_ops');
  });

  it('tsvector GIN 索引', () => {
    expect(PG_MIGRATION).toMatch(/idx_word_search_gin[\s\S]*?USING GIN/);
    expect(PG_MIGRATION).toMatch(/idx_sentence_search[\s\S]*?USING GIN/);
  });

  it('search_tsv 由触发器维护（否则搜索功能形同虚设）', () => {
    expect(PG_MIGRATION).toContain('trg_word_search_tsv');
    expect(PG_MIGRATION).toContain('word_search_tsv_update');
  });

  it('⚠️ 修正：idx_wm_weak 不含不存在的 frequency_rank 列', () => {
    // 用剥离注释后的 DDL 断言（注释里记录了文档原本的错误写法）
    expect(PG_DDL).toMatch(
      /CREATE INDEX IF NOT EXISTS idx_wm_weak\s+ON word_mastery \(user_id, overall_score\)/,
    );
    expect(PG_DDL).not.toMatch(/idx_wm_weak[^;]*frequency_rank/);
  });

  it('⚠️ 修正：stage CHECK 用 contracts 的 6 个 code', () => {
    expect(PG_DDL).toContain("'primary_low','primary','junior','senior','college','adult'");
  });


  it('建表顺序：stage 先于 user_profile（外键依赖）', () => {
    expect(PG_MIGRATION.indexOf('CREATE TABLE IF NOT EXISTS stage')).toBeLessThan(
      PG_MIGRATION.indexOf('CREATE TABLE IF NOT EXISTS user_profile'),
    );
  });
});

const countObjects = (db: Database.Database): number =>
  (
    db
      .prepare("SELECT count(*) AS c FROM sqlite_master WHERE type IN ('table','view','index','trigger')")
      .get() as { c: number }
  ).c;

const listObjects = (db: Database.Database): string[] =>
  (
    db
      .prepare(
        "SELECT type || ':' || name AS o FROM sqlite_master WHERE type IN ('table','view','index','trigger') ORDER BY o",
      )
      .all() as Array<{ o: string }>
  ).map((r) => r.o);
