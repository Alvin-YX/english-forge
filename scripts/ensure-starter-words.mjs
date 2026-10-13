#!/usr/bin/env tsx
/**
 * 首装自动灌词库守卫 —— 只在 `word` 表为空时执行 ECDICT 导入。
 *
 * 为什么需要：全新安装后 word 表是空的，游戏 / 跟读 / 默写全部提示「词库为空」，
 * 而前端没有词库管理入口，用户无路可走。让首次启动自动灌入随包样例词库即可闭环。
 *
 * 幂等性：先数一次 word 行数，非空即退出；真正的插入仍靠 import-ecdict.mjs 的
 * `onConflictDoNothing({ target: [lemma, pos] })` 兜底，重复执行不产生重复词条。
 *
 * 失败语义：灌词失败不阻断 api 启动（词库是增强项），只打日志。
 *
 * 用法：
 *   ECF_SEED_CSV=data/ecdict.csv pnpm exec tsx scripts/ensure-starter-words.mjs
 * 不传 ECF_SEED_CSV 时走 import-ecdict.mjs 自身的回退：data/ecdict.csv 缺失则用
 * data/sample-ecdict.csv。
 *
 * 🔴 本仓库 scripts/*.mjs 一律是纯 JS：tsx 不会对 .mjs 剥离 TypeScript 类型标注，
 * 函数签名写 `(): Promise<number>` 会在容器里直接抛 SyntaxError 让整个启动灌词步骤崩掉
 * （2026-10-14 生产实测）。要写类型就得把文件改成 .mts。
 */

import { spawnSync } from 'node:child_process';

import { createDb } from '@eng-forge/db/client.js';
import { word } from '@eng-forge/db/schema/content.js';

async function countWords() {
  const client = createDb();
  try {
    const rows = await client.db.select({ id: word.id }).from(word).limit(1);
    return rows.length;
  } finally {
    await client.close();
  }
}

async function main() {
  let existing = 0;
  try {
    existing = await countWords();
  } catch (err) {
    console.error(`[seed] 无法读取 word 表，跳过灌词：${err instanceof Error ? err.message : err}`);
    return;
  }

  if (existing > 0) {
    console.log(`[seed] word 表已有词条，跳过灌词`);
    return;
  }

  console.log('[seed] word 表为空，执行 ECDICT 样例词库导入…');
  const args = ['exec', 'tsx', '--tsconfig', 'apps/api/tsconfig.json', 'scripts/import-ecdict.mjs'];
  const csv = process.env.ECF_SEED_CSV;
  if (csv) args.push('--file', csv);

  const res = spawnSync('pnpm', args, { stdio: 'inherit', env: process.env });
  if (res.status !== 0) {
    console.error(`[seed] 灌词失败（exit ${res.status}），api 仍会正常启动`);
  }
}

main().catch((err) => {
  console.error(`[seed] 未预期错误：${err instanceof Error ? err.stack : err}`);
});
