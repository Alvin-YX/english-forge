#!/usr/bin/env tsx
/**
 * 例句导入脚本 —— 从 JSON 文件批量灌入 `sentence` 表。
 *
 * 🔴 版权红线：每条例句强制 `license` 字段，未指定默认 `user-owned`。
 *    教材原音由用户自备（`audio_path` 字段仅存路径，不含音频数据）。
 *
 * 用法：
 *   npx tsx scripts/import-sentences.mjs [--file <path>] [--limit N] [--reset] [--dry-run]
 *
 * JSON 输入格式（数组，每条一个对象）：
 *   [
 *     {
 *       "text": "I like apples.",
 *       "translationZh": "我喜欢苹果。",
 *       "speakerRole": "man",          // man | woman | narrator
 *       "audioPath": "/audio/xxx.mp3", // 可选
 *       "sourceKind": "course",        // course | exam | ai_generated | user
 *       "license": "user-owned",       // 必填（缺省 user-owned）
 *       "difficulty": 0.25             // 可选 0~1，缺省按词频估算
 *     },
 *     ...
 *   ]
 *
 * 环境变量：DATABASE_URL / DB_DIALECT
 */

import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { parseArgs } from 'node:util';

import { createDb } from '@eng-forge/db/client.js';
import { sentence } from '@eng-forge/db/schema/content.js';

const DEFAULT_JSON_PATH = 'data/sentences.json';
const BATCH_SIZE = 500;

const VALID_SOURCE_KINDS = new Set(['course', 'exam', 'ai_generated', 'user']);
const VALID_SPEAKER_ROLES = new Set(['man', 'woman', 'narrator']);
const DEFAULT_LICENSE = 'user-owned';

/**
 * 难度估算（词频未入库时按长度粗算，0~1）
 *
 * @param {string} _text
 * @param {number} wordCount
 * @returns {number}
 */
function estimateDifficulty(_text, wordCount) {
  // 长度权重（1~2 词 = 0.1，>20 词 = 0.9）
  const lengthScore = Math.min(0.9, Math.max(0.1, wordCount / 20));
  return Math.round(lengthScore * 100) / 100;
}

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

/** 把 JSON 对象规范化为 sentence 表插入行 */
function buildSentenceRow(row) {
  const text = row.text;
  if (typeof text !== 'string' || text.trim() === '') {
    return null;
  }

  const trimmed = text.trim();
  const translationZh = typeof row.translationZh === 'string' ? row.translationZh.trim() : undefined;

  let speakerRole;
  if (typeof row.speakerRole === 'string') {
    const r = row.speakerRole.trim().toLowerCase();
    speakerRole = VALID_SPEAKER_ROLES.has(r) ? r : undefined;
  }

  let sourceKind = 'course';
  if (typeof row.sourceKind === 'string' && VALID_SOURCE_KINDS.has(row.sourceKind)) {
    sourceKind = row.sourceKind;
  }

  const license =
    typeof row.license === 'string' && row.license.trim() !== '' ? row.license.trim() : DEFAULT_LICENSE;

  const audioPath = typeof row.audioPath === 'string' ? row.audioPath.trim() : undefined;

  const wordCount = Math.max(0, trimmed.split(/\s+/).length);
  const charCount = trimmed.length;
  const difficulty =
    typeof row.difficulty === 'number' ? row.difficulty : estimateDifficulty(trimmed, wordCount);

  return {
    text: trimmed,
    translationZh,
    speakerRole,
    audioPath,
    sourceKind,
    license,
    wordCount,
    charCount,
    difficulty: Math.round(Math.min(1, Math.max(0, difficulty)) * 100) / 100,
  };
}

async function main() {
  const args = parseArgs({
    options: {
      file: { type: 'string', default: DEFAULT_JSON_PATH },
      limit: { type: 'string' },
      reset: { type: 'boolean', default: false },
      'dry-run': { type: 'boolean', default: false },
    },
  });

  const jsonPath = resolve(process.cwd(), args.values.file ?? DEFAULT_JSON_PATH);
  const limit = args.values.limit !== undefined ? Number(args.values.limit) : undefined;
  const dryRun = args.values['dry-run'] === true;
  const reset = args.values.reset === true;

  // ── 1. 检查文件 ───────────────────────────────────────────
  if (!existsSync(jsonPath)) {
    console.error(`❌ JSON 文件不存在：${jsonPath}`);
    console.error('   请创建 JSON 文件或用 --file 指定路径。');
    process.exit(1);
  }

  let data;
  try {
    data = JSON.parse(readFileSync(jsonPath, 'utf-8'));
  } catch (err) {
    console.error(`❌ JSON 解析失败：${err.message}`);
    process.exit(1);
  }

  if (!Array.isArray(data)) {
    console.error('❌ JSON 根节点必须是数组');
    process.exit(1);
  }

  const total = limit !== undefined ? Math.min(limit, data.length) : data.length;

  console.log('💬 例句导入');
  console.log(`   文件：${jsonPath}`);
  console.log(`   条目：${data.length}${limit !== undefined ? `（限制 ${limit}）` : ''}`);
  console.log(`   模式：${dryRun ? 'dry-run（不落库）' : reset ? '重置 + 导入' : '导入'}`);

  const startTime = Date.now();
  const stats = { total, inserted: 0, skipped: 0, errors: 0, elapsedMs: 0 };

  // ── 2. 连接数据库 ─────────────────────────────────────────
  let client;
  try {
    client = createDb();
  } catch (err) {
    console.error(`❌ 数据库连接失败：${err.message}`);
    process.exit(1);
  }
  const db = client.db;

  // ── 3. 重置（--reset） ────────────────────────────────────
  if (reset && !dryRun) {
    console.log('🗑  清空 sentence 表...');
    await db.delete(sentence);
    console.log('   已清空');
  }

  // ── 4. 解析与批量插入 ─────────────────────────────────────
  const progress = new ProgressBar(total, dryRun ? 'preview' : 'insert');
  const batch = [];

  for (let i = 0; i < total; i++) {
    const row = data[i];
    try {
      const built = buildSentenceRow(row);
      if (built === null) {
        stats.skipped++;
        progress.update();
        continue;
      }

      if (dryRun) {
        if (i < 5) {
          if (i === 0) console.log('🔍 样本预览（前 5 条）：');
          console.log(
            `  ${i + 1}. "${String(built.text).slice(0, 80)}" → zh="${String(built.translationZh).slice(0, 40) || '-'}" ` +
              `src=${built.sourceKind} role=${built.speakerRole ?? '-'} lic=${built.license}`,
          );
        }
        stats.inserted++;
      } else {
        batch.push(built);
        if (batch.length >= BATCH_SIZE) {
          await db.insert(sentence).values(batch).onConflictDoNothing();
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
        console.error(`\n⚠ 第 ${i + 1} 条解析失败：${err.message}`);
      }
    }
  }

  if (!dryRun && batch.length > 0) {
    await db.insert(sentence).values(batch).onConflictDoNothing();
    stats.inserted += batch.length;
    progress.update(batch.length);
  }

  stats.elapsedMs = Date.now() - startTime;

  console.log('');
  console.log('═'.repeat(52));
  console.log('📊 导入完成');
  console.log(`   总条数：${stats.total}`);
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
