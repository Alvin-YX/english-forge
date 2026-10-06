#!/usr/bin/env node
/**
 * 版本号一致性门禁。
 *
 * 背景：monorepo 里版本号散落在 10 个文件（7 个 package.json、2 个 pyproject.toml、
 * 1 个 fpk manifest）。发版时最容易漏改某几个，装出来的 fpk 与镜像 tag 就对不上。
 * 本脚本把这些位置聚到一起比对，不一致直接非零退出。
 *
 * 用法：node ops/scripts/check-version-consistency.mjs [--fix]
 *   无参数   仅检查，不一致时打印差异并 exit 1
 *   --fix    以根 package.json 的 version 为准，回写其余文件
 */
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const FIX = process.argv.includes('--fix');

/** @typedef {{ file: string; kind: 'json' | 'toml' | 'ini'; label: string }} Target */

/** @type {Target[]} */
const TARGETS = [
  { file: 'package.json', kind: 'json', label: '根 (monorepo)' },
  { file: 'apps/api/package.json', kind: 'json', label: '@eng-forge/api' },
  { file: 'apps/web/package.json', kind: 'json', label: '@eng-forge/web' },
  { file: 'packages/contracts/package.json', kind: 'json', label: '@eng-forge/contracts' },
  { file: 'packages/db/package.json', kind: 'json', label: '@eng-forge/db' },
  { file: 'packages/content/package.json', kind: 'json', label: '@eng-forge/content' },
  { file: 'packages/ui/package.json', kind: 'json', label: '@eng-forge/ui' },
  { file: 'packages/speech-tts/package.json', kind: 'json', label: '@eng-forge/speech-tts' },
  { file: 'apps/speech/pyproject.toml', kind: 'toml', label: 'speech (Python)' },
  { file: 'apps/ai/pyproject.toml', kind: 'toml', label: 'ai (Python)' },
  { file: 'ops/fnos/fpk/manifest', kind: 'ini', label: 'fnOS FPK manifest' },
];

/** 从文件文本里抽出版本号 */
function readVersion(text, kind) {
  if (kind === 'json') {
    // 顶层 "version": "x.y.z" —— 用 JSON.parse 避免匹配到 dependencies 里的嵌套 version
    try {
      return JSON.parse(text).version ?? null;
    } catch {
      return null;
    }
  }
  if (kind === 'toml') {
    // 只取 [project] 段内的 version，避免匹配 [tool.*] 下的同名字段
    const projectSection = text.split(/^\[project\]\s*$/m)[1];
    if (!projectSection) return null;
    const m = projectSection.match(/^\s*version\s*=\s*["']([^"']+)["']/m);
    return m ? m[1] : null;
  }
  // ini: 顶层 version = x.y.z
  const m = text.match(/^version\s*=\s*(.+?)\s*$/m);
  return m ? m[1].trim() : null;
}

/** 回写版本号 */
function writeVersion(text, kind, version) {
  if (kind === 'json') {
    const pkg = JSON.parse(text);
    pkg.version = version;
    return `${JSON.stringify(pkg, null, 2)}\n`;
  }
  if (kind === 'toml') {
    // 仅替换 [project] 段内第一处
    const [head, ...rest] = text.split(/^\[project\]\s*$/m);
    const body = rest.join('[project]');
    return `${head}[project]${body.replace(/^(\s*version\s*=\s*)["'][^"']+["']/m, `$1"${version}"`)}`;
  }
  return text.replace(/^(version\s*=\s*).+$/m, `$1${version}`);
}

const results = [];
for (const t of TARGETS) {
  const abs = join(ROOT, t.file);
  if (!existsSync(abs)) {
    results.push({ ...t, version: null, missing: true });
    continue;
  }
  results.push({ ...t, version: readVersion(readFileSync(abs, 'utf8'), t.kind), missing: false });
}

const rootVersion = results.find((r) => r.file === 'package.json')?.version;
if (!rootVersion) {
  console.error('✗ 无法读取根 package.json 的 version');
  process.exit(1);
}

console.log(`基准版本（根 package.json）: ${rootVersion}\n`);

const mismatched = results.filter((r) => !r.missing && r.version !== rootVersion);
const missing = results.filter((r) => r.missing);

for (const r of results) {
  if (r.missing) {
    console.log(`  ?  ${r.file.padEnd(34)} (文件不存在)`);
  } else if (r.version === rootVersion) {
    console.log(`  ✓  ${r.file.padEnd(34)} ${r.version}`);
  } else {
    console.log(`  ✗  ${r.file.padEnd(34)} ${r.version}  ← 应为 ${rootVersion}`);
  }
}

if (FIX) {
  if (mismatched.length === 0) {
    console.log('\n所有文件已一致，无需修复。');
    process.exit(0);
  }
  console.log(`\n--fix：回写 ${mismatched.length} 个文件…`);
  for (const r of mismatched) {
    const abs = join(ROOT, r.file);
    writeFileSync(abs, writeVersion(readFileSync(abs, 'utf8'), r.kind, rootVersion));
    console.log(`  ↻ ${r.file} → ${rootVersion}`);
  }
  process.exit(0);
}

if (mismatched.length > 0) {
  console.error(
    `\n✗ ${mismatched.length} 个文件版本号与根不一致。修复：node ops/scripts/check-version-consistency.mjs --fix`,
  );
  process.exit(1);
}
if (missing.length > 0) {
  console.error(`\n✗ ${missing.length} 个目标文件不存在，无法校验。`);
  process.exit(1);
}
console.log('\n✓ 版本号全部一致。');
