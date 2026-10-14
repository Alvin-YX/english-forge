#!/usr/bin/env tsx
/**
 * 教材骨架种子脚本 —— 32 册 × 6 单元（4 版本 × 8 册）
 *
 * 🔴 版权红线：本脚本**只建骨架结构**（学段/教材/册次/单元占位），
 *    不写任何教材原文。真实单元词表由 ETL 任务或用户在后台导入。
 *
 * 覆盖：4 套小学教材（人教版 PEP / 外研版 / 北师大版 / 苏教版）×
 *       3-6 年级 × 上/下册 = 32 册 × 6 单元 = 192 单元占位。
 *
 * 用法（须通过 tsx 运行，因为需要加载 packages/db 的 TypeScript schema）：
 *   npx tsx scripts/seed-textbooks.mjs [--dry-run] [--sample-words]
 *
 * 环境变量：DATABASE_URL / DB_DIALECT
 *
 * 依赖：需先跑 `npx tsx apps/api/scripts/import-ecdict.mjs` 才有词条可分配；
 *       不带 `--sample-words` 时只建骨架，不写 word_unit。
 */

import { parseArgs } from 'node:util';

import { and, eq } from 'drizzle-orm';

import { createDb } from '@eng-forge/db/client.js';
import { stage, textbook, volume, unit } from '@eng-forge/db/schema/index.js';
import { word, wordUnit } from '@eng-forge/db/schema/content.js';
import {
  PLACEHOLDER_UNITS_PER_VOLUME,
  STAGES,
  TEXTBOOKS,
  TEXTBOOK_LICENSE_PLACEHOLDER,
  TEXTBOOK_SOURCE_PLACEHOLDER,
  VOLUMES,
  buildPlaceholderUnits,
  textbookUniqueCode,
} from '@eng-forge/db/seed.js';

// ─────────────────────────────────────────────────────────────
// 进度条
// ─────────────────────────────────────────────────────────────

class ProgressBar {
  /**
   * @param {number} total
   * @param {string} label
   */
  constructor(total, label = 'progress') {
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
// SQLite bool 兼容
// ─────────────────────────────────────────────────────────────

function bool(dialect, value) {
  if (dialect !== 'sqlite') return value;
  return value ? 1 : 0;
}

// ─────────────────────────────────────────────────────────────
// 主流程
// ─────────────────────────────────────────────────────────────

async function main() {
  const args = parseArgs({
    options: {
      'dry-run': { type: 'boolean', default: false },
      'sample-words': { type: 'boolean', default: false },
    },
  });
  const dryRun = args.values['dry-run'] === true;
  const sampleWords = args.values['sample-words'] === true;

  console.log('📚 教材骨架种子');
  console.log(`   模式：${dryRun ? 'dry-run' : '写入'}`);
  console.log(`   词表分配：${sampleWords ? '是' : '否（仅建骨架）'}`);
  console.log('');

  if (dryRun) {
    console.log('   将写入：');
    console.log(`     - ${STAGES.length} 个学段`);
    console.log(`     - ${TEXTBOOKS.length} 套教材（${TEXTBOOKS.map((t) => t.nameZh).join('、')}）`);
    const totalVol = TEXTBOOKS.reduce((s, t) => s + t.volumeCount, 0);
    console.log(`     - ${totalVol} 册（4 × 8）`);
    console.log(`     - ${totalVol * PLACEHOLDER_UNITS_PER_VOLUME} 个单元占位`);
    if (sampleWords) console.log('     - word_unit 分配（依赖已有词条）');
    return;
  }

  const startTime = Date.now();
  const client = createDb();
  const db = client.db;
  const dialect = client.dialect;

  const stats = {
    stages: 0,
    textbooks: 0,
    volumes: 0,
    units: 0,
    wordUnits: 0,
    elapsedMs: 0,
  };

  // ── 1. 学段 ───────────────────────────────────────────────
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
      .onConflictDoNothing({ target: stage.code });
    stats.stages++;
  }

  const stageIds = new Map();
  for (const row of await db.select({ code: stage.code, id: stage.id }).from(stage)) {
    stageIds.set(row.code, row.id);
  }

  // ── 2. 教材 / 册次 / 单元 ─────────────────────────────────
  const totalVol = TEXTBOOKS.reduce((s, t) => s + t.volumeCount, 0);
  const progress = new ProgressBar(totalVol + totalVol * PLACEHOLDER_UNITS_PER_VOLUME, 'seed');

  for (const tb of TEXTBOOKS) {
    const stageId = stageIds.get(tb.stage);
    if (stageId === undefined) throw new Error(`学段不存在：${tb.stage}`);
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
        isOfficial: bool(dialect, true),
        license: TEXTBOOK_LICENSE_PLACEHOLDER,
        source: TEXTBOOK_SOURCE_PLACEHOLDER,
        enabledInMvp: bool(dialect, tb.enabledInMvp),
      })
      .onConflictDoNothing({ target: textbook.code });

    const [tbRow] = await db
      .select({ id: textbook.id })
      .from(textbook)
      .where(eq(textbook.code, tbCode));
    if (tbRow === undefined) throw new Error(`教材写入失败：${tbCode}`);
    stats.textbooks++;

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
        .onConflictDoNothing({ target: [volume.textbookId, volume.code] });
      stats.volumes++;
      progress.update();

      const [volRow] = await db
        .select({ id: volume.id })
        .from(volume)
        .where(and(eq(volume.textbookId, tbRow.id), eq(volume.code, v.code)));
      if (volRow === undefined) throw new Error(`册次写入失败：${tbCode}/${v.code}`);

      for (const u of buildPlaceholderUnits(v.code, PLACEHOLDER_UNITS_PER_VOLUME)) {
        await db
          .insert(unit)
          .values({
            volumeId: volRow.id,
            code: u.code,
            nameZh: u.nameZh,
            sortOrder: u.sortOrder,
          })
          .onConflictDoNothing({ target: [unit.volumeId, unit.code] });
        stats.units++;
        progress.update();
      }
    }
  }

  // ── 3. 可选：把词条分配到单元 ─────────────────────────────
  if (sampleWords) {
    const allUnits = await db.select({ id: unit.id }).from(unit);
    const allWords = await db
      .select({ id: word.id })
      .from(word)
      .orderBy(word.frequencyRank)
      .limit(1000);

    console.log(`\n🎲 词条分配：${allUnits.length} 单元 / ${allWords.length} 词条`);
    if (allUnits.length > 0 && allWords.length > 0) {
      const wordsPerUnit = Math.max(5, Math.floor(allWords.length / allUnits.length));
      const progress2 = new ProgressBar(allUnits.length, 'assign');

      for (let i = 0; i < allUnits.length; i++) {
        const u = allUnits[i];
        const offset = (i * wordsPerUnit) % allWords.length;
        const slice = allWords.slice(offset, offset + wordsPerUnit);
        for (let j = 0; j < slice.length; j++) {
          await db
            .insert(wordUnit)
            .values({
              unitId: u.id,
              wordId: slice[j].id,
              sortOrder: j + 1,
              isRequired: true,
            })
            .onConflictDoNothing({ target: [wordUnit.unitId, wordUnit.wordId] });
          stats.wordUnits++;
        }
        progress2.update();
      }
    } else {
      console.log('   ⚠ 词条表为空，跳过分配（可先跑 import-ecdict.mjs）');
    }
  }

  stats.elapsedMs = Date.now() - startTime;

  // ── 4. 汇总 ───────────────────────────────────────────────
  console.log('');
  console.log('═'.repeat(52));
  console.log('📊 教材骨架种子完成');
  console.log(`   学段：${stats.stages}`);
  console.log(`   教材：${stats.textbooks}`);
  console.log(`   册次：${stats.volumes}`);
  console.log(`   单元：${stats.units}`);
  console.log(`   词单元：${stats.wordUnits}`);
  console.log(`   耗时：${(stats.elapsedMs / 1000).toFixed(2)}s`);
  console.log('═'.repeat(52));

  await client.close();
}

main().catch((err) => {
  console.error('❌ 致命错误：', err);
  process.exit(1);
});
