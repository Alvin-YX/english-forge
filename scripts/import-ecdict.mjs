#!/usr/bin/env tsx
/**
 * ECDICT CSV 导入脚本 —— 把 skywind3000/ECDICT 的字典 CSV 灌入 `word` 表。
 *
 * 🔴 版权红线：ECDICT 数据本身是 CC BY-SA 4.0（见 https://github.com/skywind3000/ECDICT），
 *    本脚本强制为每条词条写入 `license = 'ecdict-1.0'` + `source = 'ecdict'` +
 *    `source_url` 追溯信息，与 `packages/db/src/schema/content.ts` 的 NOT NULL 约束对齐。
 *
 * 用法（须通过 tsx 运行，因为需要加载 packages/db 的 TypeScript schema）：
 *   npx tsx scripts/import-ecdict.mjs [--file <path>] [--limit N] [--reset] [--dry-run]
 *
 * 环境变量：
 *   DATABASE_URL  —— PG 档 `postgres://…` 或 SQLite 档 `file:./data/forge.db`
 *   DB_DIALECT    —— 可选，`postgres` / `sqlite`（缺省时按 URL 前缀判档）
 *
 * 典型工作流：
 *   1. 下载 https://github.com/skywind3000/ECDICT-ultimate 的 stardict.csv（约 43 万词条）
 *   2. 放到 `./data/ecdict.csv`
 *   3. 执行 `npx tsx scripts/import-ecdict.mjs`
 */

import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { parseArgs } from 'node:util';

import { createDb } from '@eng-forge/db/client.js';
import { word, EXAM_TAGS } from '@eng-forge/db/schema/content.js';

// ─────────────────────────────────────────────────────────────
// 常量
// ─────────────────────────────────────────────────────────────

const DEFAULT_CSV_PATH = 'data/ecdict.csv';
const BATCH_SIZE = 1000;

const ECDICT_LICENSE = 'ecdict-1.0';
const ECDICT_SOURCE = 'ecdict';
const ECDICT_SOURCE_URL = 'https://github.com/skywind3000/ECDICT';

// Collins 5 级难度 → 词频分级（脚本任务需求）
const COLLINS_TO_BAND = new Map([
  [5, '超高'],
  [4, '高'],
  [3, '中'],
  [2, '低'],
  [1, '低'],
]);

// Collins 5 级 → CEFR（近似映射，非严格学术映射，仅作排序与展示用）
const COLLINS_TO_CEFR = new Map([
  [5, 'C1'],
  [4, 'B2'],
  [3, 'B1'],
  [2, 'A2'],
  [1, 'A1'],
]);

// 合法考试标签（与 content.ts 的 EXAM_TAGS 对齐）
const VALID_EXAM_TAGS = new Set(EXAM_TAGS);

// ─────────────────────────────────────────────────────────────
// CSV 解析（支持 RFC 4180 引号/换行/转义）
// ─────────────────────────────────────────────────────────────

/**
 * 解析 RFC 4180 CSV，返回二维数组。
 *
 * ECDICT 的 CSV 字段中包含英文逗号、双引号、换行符，必须正确解析。
 * 用 `csv-parse` 也行，但为了减少依赖，用最小实现。
 *
 * @param {string} text
 * @returns {string[][]}
 */
function parseCsv(text) {
  const rows = [];
  let row = [];
  let field = '';
  let inQuotes = false;
  let i = 0;

  while (i < text.length) {
    const c = text[i];

    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i += 2;
          continue;
        }
        inQuotes = false;
        i += 1;
        continue;
      }
      field += c;
      i += 1;
      continue;
    }

    if (c === '"') {
      inQuotes = true;
      i += 1;
      continue;
    }
    if (c === ',') {
      row.push(field);
      field = '';
      i += 1;
      continue;
    }
    if (c === '\r') {
      // \r\n 或 \r
      if (text[i + 1] === '\n') i += 1;
      row.push(field);
      field = '';
      rows.push(row);
      row = [];
      i += 1;
      continue;
    }
    if (c === '\n') {
      row.push(field);
      field = '';
      rows.push(row);
      row = [];
      i += 1;
      continue;
    }
    field += c;
    i += 1;
  }

  // 最后一行（无结尾换行时）
  if (field.length > 0 || row.length > 0) {
    row.push(field);
    rows.push(row);
  }

  return rows;
}

// ─────────────────────────────────────────────────────────────
// 字段规范化
// ─────────────────────────────────────────────────────────────

/**
 * 由 headword 推导 lemma（去 -s/-ed/-ing）。
 *
 * 简单启发式：小写化 + 去后缀。规则顺序很重要（先 -ies 再 -s 再 -es 再 -ed 再 -ing）。
 * 不追求学术严格性 —— 词元只做粗筛，精确词形分析留给 LLM 层。
 *
 * @param {string} headword
 * @returns {string}
 */
function deriveLemma(headword) {
  const w = headword.trim().toLowerCase();
  if (!w) return headword.trim();
  if (w.length < 4) return w;

  // 复数
  if (w.endsWith('ies') && w.length > 4) return w.slice(0, -3) + 'y';
  if (w.endsWith('ses')) return w.slice(0, -1);
  if (w.endsWith('xes')) return w.slice(0, -1);
  if (w.endsWith('zes')) return w.slice(0, -1);
  if (w.endsWith('ches')) return w.slice(0, -1);
  if (w.endsWith('shes')) return w.slice(0, -1);
  if (w.endsWith('s') && !w.endsWith('ss')) return w.slice(0, -1);

  // 过去式 / 过去分词
  if (w.endsWith('ied') && w.length > 5) return w.slice(0, -3) + 'y';
  if (w.endsWith('ed')) {
    const base = w.slice(0, -2);
    if (base.endsWith('e')) return base;
    if (base.endsWith('y')) return base.slice(0, -1) + 'ie';
    return base;
  }

  // 现在分词
  if (w.endsWith('ied') && w.length > 5) return w.slice(0, -3) + 'y';
  if (w.endsWith('ing')) {
    const base = w.slice(0, -3);
    if (base.endsWith('e')) return base;
    if (base.endsWith('y')) return base.slice(0, -1) + 'ie';
    return base;
  }

  return w;
}

/**
 * 从 ECDICT 的 phonetic 字段解析 UK / US 音标。
 *
 * @param {string} raw
 * @returns {{uk?: string, us?: string}}
 */
function parsePhonetic(raw) {
  if (!raw) return {};
  const s = raw.trim();
  // ECDICT 常见格式："IPA /ˈæpl/ ; US /ˈæpəl/" 或仅有单个音标
  if (s.startsWith('[') || s.startsWith('/')) {
    const usMatch = s.match(/;?\s*US\s*\/[^/]+\/?\s*$/i);
    if (usMatch) {
      return { us: usMatch[0].trim().replace(/^;?\s*US\s*/i, '') };
    }
    return { uk: s };
  }
  // "[UK] /ˈæpl/ [US] /ˈæpəl/"
  const ukMatch = s.match(/\[?(UK)?\]?\s*\/([^/]+)\/?/i);
  const usMatch = s.match(/US\s*\/([^/]+)\/?/i);
  const result = {};
  if (usMatch) result.us = `/${usMatch[1]}/`;
  if (ukMatch && !result.us) result.uk = `/${ukMatch[2]}/`;
  return result;
}

/**
 * 解析 ECDICT 的 tag 字段（逗号分隔）为合法考试标签数组。
 *
 * @param {string} raw
 * @returns {string[]}
 */
function parseExamTags(raw) {
  if (!raw) return [];
  return raw
    .split(',')
    .map((t) => t.trim().toLowerCase())
    .filter((t) => VALID_EXAM_TAGS.has(t));
}

/**
 * 判断是否动词（用于 is_verb 字段）。
 *
 * @param {string} pos
 * @returns {boolean}
 */
function isVerb(pos) {
  if (!pos) return false;
  const p = pos.toLowerCase();
  return p.includes('v') && !p.includes('n.') && !p.includes('adj');
}

// ─────────────────────────────────────────────────────────────
// 进度条
// ─────────────────────────────────────────────────────────────

class ProgressBar {
  /**
   * @param {number} total
   * @param {string} label
   */
  constructor(total, label = 'importing') {
    this.total = total;
    this.label = label;
    this.current = 0;
    this.width = 30;
  }

  update(count = 1) {
    this.current = Math.min(this.current + count, this.total);
    const pct = this.total > 0 ? this.current / this.total : 1;
    const filled = Math.floor(this.width * pct);
    const bar = '█'.repeat(filled) + '░'.repeat(this.width - filled);
    process.stdout.write(
      `\r  ${this.label} [${bar}] ${this.current}/${this.total} (${(pct * 100).toFixed(1)}%)`,
    );
    if (this.current >= this.total) process.stdout.write('\n');
  }
}

// ─────────────────────────────────────────────────────────────
// 主流程
// ─────────────────────────────────────────────────────────────

/** 把 CSV 一行解析为 word 表插入行 */
function buildWordRow(row) {
  const [rawWord, rawPhonetic, rawDef, rawTrans, rawPos, rawCollins, rawOxford, rawTag] = row;

  const headword = rawWord?.trim();
  if (!headword) return null;

  const lemma = deriveLemma(headword);
  const { uk: phoneticUk, us: phoneticUs } = parsePhonetic(rawPhonetic ?? '');
  const pos = (rawPos ?? '').trim() || undefined;
  const collins = rawCollins ? Number(rawCollins) : undefined;
  const examTags = parseExamTags(rawTag ?? '');

  const translationZh = (rawTrans ?? '').trim() || undefined;
  if (!translationZh) {
    // ECDICT 某些行只有英文释义没有中文 —— 用 definition 兜底
    const def = rawDef?.trim();
    if (!def) return null;
  }

  const frequencyBand = collins ? COLLINS_TO_BAND.get(collins) : undefined;
  const cefrLevel = collins ? COLLINS_TO_CEFR.get(collins) : undefined;

  return {
    headword,
    lemma,
    phoneticUk,
    phoneticUs,
    pos,
    translationZh: translationZh ?? '',
    definitionEn: rawDef?.trim() || undefined,
    frequencyRank: undefined,
    frequencyBand,
    examTags,
    audioUkPath: undefined,
    audioUsPath: undefined,
    cefrLevel,
    isVerb: isVerb(pos ?? ''),
    irregularForms: {},
    source: ECDICT_SOURCE,
    license: ECDICT_LICENSE,
    sourceUrl: ECDICT_SOURCE_URL,
    isActive: true,
  };
}

/** 批量插入 —— PG 用 `onConflictDoNothing`，SQLite 用同样的语法 */
async function insertBatch(db, batch) {
  if (batch.length === 0) return;
  await db
    .insert(word)
    .values(batch)
    .onConflictDoNothing({ target: [word.lemma, word.pos] });
}

async function main() {
  const args = parseArgs({
    options: {
      file: { type: 'string', default: DEFAULT_CSV_PATH },
      limit: { type: 'string' },
      reset: { type: 'boolean', default: false },
      'dry-run': { type: 'boolean', default: false },
    },
  });

  const csvPath = resolve(process.cwd(), args.values.file ?? DEFAULT_CSV_PATH);
  const limit = args.values.limit !== undefined ? Number(args.values.limit) : undefined;
  const dryRun = args.values['dry-run'] === true;
  const reset = args.values.reset === true;

  // ── 1. 检查文件 ───────────────────────────────────────────
  if (!existsSync(csvPath)) {
    console.error(`❌ CSV 文件不存在：${csvPath}`);
    console.error(`   请先下载 ECDICT 字典（https://github.com/skywind3000/ECDICT）`);
    console.error(`   放到 ${DEFAULT_CSV_PATH} 或用 --file 指定路径。`);
    process.exit(1);
  }

  const raw = readFileSync(csvPath, 'utf-8');
  const rows = parseCsv(raw);
  if (rows.length < 2) {
    console.error('❌ CSV 为空或缺少表头');
    process.exit(1);
  }

  // ECDICT 表头：word,phonetic,definition,translation,pos,collins,oxford,tag,type,word_tags
  const header = rows[0].map((h) => h.toLowerCase().trim());
  const hasHeader = header.includes('word') || header.includes('phonetic');
  const dataRows = hasHeader ? rows.slice(1) : rows;
  const total = limit !== undefined ? Math.min(limit, dataRows.length) : dataRows.length;

  console.log('📖 ECDICT 导入');
  console.log(`   文件：${csvPath}`);
  console.log(`   行数：${dataRows.length}${limit !== undefined ? `（限制 ${limit}）` : ''}`);
  console.log(`   模式：${dryRun ? 'dry-run（不落库）' : reset ? '重置 + 导入' : '导入'}`);
  console.log('');

  const startTime = Date.now();
  const stats = {
    total,
    inserted: 0,
    skipped: 0,
    errors: 0,
    elapsedMs: 0,
  };

  // ── 2. 连接数据库 ─────────────────────────────────────────
  let client;
  try {
    client = createDb();
  } catch (err) {
    console.error(`❌ 数据库连接失败：${err.message}`);
    console.error(`   请确保 DATABASE_URL 环境变量已设置。`);
    process.exit(1);
  }
  const db = client.db;

  // ── 3. 重置（--reset） ────────────────────────────────────
  if (reset && !dryRun) {
    console.log('🗑  清空 word 表...');
    await db.delete(word);
    console.log('   已清空');
  }

  // ── 4. 解析与批量插入 ─────────────────────────────────────
  const progress = new ProgressBar(total, dryRun ? 'preview' : 'insert');
  const batch = [];

  for (let i = 0; i < total; i++) {
    const row = dataRows[i];
    try {
      const built = buildWordRow(row);
      if (built === null) {
        stats.skipped++;
        progress.update();
        continue;
      }

      if (dryRun) {
        if (i < 5) {
          if (i === 0) console.log('🔍 样本预览（前 5 条）：');
          const zhPreview = String(built.translationZh || '').slice(0, 60);
          console.log(
            `  ${i + 1}. headword="${built.headword}" lemma="${built.lemma}" pos=${built.pos ?? '-'} ` +
              `band=${built.frequencyBand ?? '-'} cefr=${built.cefrLevel ?? '-'} tags=[${(built.examTags ?? []).join(',')}]`,
          );
          console.log(
            `     zh="${zhPreview}${built.translationZh?.length > 60 ? '...' : ''}"`,
          );
        }
        stats.inserted++;
      } else {
        batch.push(built);
        if (batch.length >= BATCH_SIZE) {
          await insertBatch(db, batch);
          stats.inserted += batch.length;
          progress.update(batch.length);
          batch.length = 0;
        } else {
          progress.update();
        }
      }
    } catch (err) {
      stats.errors++;
      if (stats.errors <= 3) {
        console.error(`\n⚠ 第 ${i + 1} 行解析失败：${err.message}`);
      }
    }
  }

  // 刷尾批
  if (!dryRun && batch.length > 0) {
    await insertBatch(db, batch);
    stats.inserted += batch.length;
    progress.update(batch.length);
  }

  stats.elapsedMs = Date.now() - startTime;

  // ── 5. 汇总 ───────────────────────────────────────────────
  console.log('');
  console.log('═'.repeat(52));
  console.log('📊 导入完成');
  console.log(`   总行数：${stats.total}`);
  console.log(`   成功：${stats.inserted}`);
  console.log(`   跳过：${stats.skipped}`);
  console.log(`   错误：${stats.errors}`);
  console.log(`   耗时：${(stats.elapsedMs / 1000).toFixed(2)}s`);
  if (dryRun) console.log('   ⚠ dry-run 模式，未落库');
  console.log('═'.repeat(52));

  await client.close();
}

main().catch((err) => {
  console.error('❌ 致命错误：', err);
  process.exit(1);
});
