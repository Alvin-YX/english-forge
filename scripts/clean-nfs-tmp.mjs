#!/usr/bin/env node
/**
 * 清理 NFS 网络盘上 pnpm 安装残留的 `*_tmp_<pid>` 临时目录。
 *
 * 背景：pnpm 采用「复制到临时目录 → 原子 rename」策略落盘。NFS/SMB 网络盘
 * 不保证 rename 原子性且存在句柄延迟，导致 rename 报 EEXIST/EPERM 并残留
 * `_tmp_<pid>` 目录。这些目录内容与目标包重复，清理后重试 install 即可推进。
 *
 * 仅删除严格匹配 `<pkg-name>_tmp_<数字>` 的目录，不触碰正常依赖。
 * 重复多轮扫描，规避 NFS 句柄释放延迟导致的删除失败。
 */
import { readdirSync, rmSync, statSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = join(process.cwd(), 'node_modules');
const PATTERN = /_tmp_\d+$/;
const MAX_PASSES = 5;

function scan() {
  /** @type {string[]} */
  const found = [];
  let entries;
  try {
    entries = readdirSync(ROOT, { withFileTypes: true });
  } catch {
    return found;
  }
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    // 顶层：node_modules/<pkg>/ 以及 node_modules/@scope/<pkg>/
    if (PATTERN.test(entry.name)) {
      found.push(join(ROOT, entry.name));
      continue;
    }
    if (entry.name.startsWith('@')) {
      // 进入 scope 子目录再扫一层
      let scoped;
      try {
        scoped = readdirSync(join(ROOT, entry.name), { withFileTypes: true });
      } catch {
        continue;
      }
      for (const sub of scoped) {
        if (sub.isDirectory() && PATTERN.test(sub.name)) {
          found.push(join(ROOT, entry.name, sub.name));
        }
      }
    }
  }
  return found;
}

let total = 0;
for (let pass = 1; pass <= MAX_PASSES; pass += 1) {
  const targets = scan();
  if (targets.length === 0) {
    console.log(`pass ${pass}: clean (total removed ${total})`);
    break;
  }
  let removed = 0;
  for (const dir of targets) {
    try {
      statSync(dir);
      rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
      removed += 1;
    } catch {
      // NFS 句柄尚未释放，下一轮重试
    }
  }
  total += removed;
  console.log(`pass ${pass}: found ${targets.length}, removed ${removed}`);
}

if (total > 0) console.log(`cleanup done, ${total} stale temp dirs removed`);
else console.log('cleanup done, nothing to remove');
