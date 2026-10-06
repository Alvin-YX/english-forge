#!/usr/bin/env node
/**
 * workspace 包本地化安装（NFS 兼容）
 *
 * 背景：本仓库部署在 NFS/SMB 网络盘上，Windows 报 `ENOTSUP: operation not
 * supported on socket, symlink`。pnpm 的 `inject-workspace-packages` 依然要
 * 为「直接根依赖」建 symlink，因此在 NFS 上必然失败。
 *
 * 方案：绕过 pnpm 的链接阶段，改为把 workspace 包**实体拷贝**到各消费者的
 * `node_modules/@eng-forge/<pkg>`。这些包都是「源码直出」型（package.json 的
 * main/types 指向 `./src/index.ts`），拷贝源码即可被 tsc / tsx / vitest 正常解析，
 * 无需构建产物。
 *
 * 用法：node scripts/link-workspace-packages.mjs
 * 需在 pnpm install 之后运行（install 负责第三方依赖，本脚本负责 workspace 包）。
 */
import {
  cpSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
} from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const SCOPE = '@eng-forge';
const PKG_DIRS = ['packages', 'apps'];

/** 读取根 pnpm-workspace.yaml 里声明的成员目录 */
function readWorkspaceMembers() {
  const yamlPath = join(ROOT, 'pnpm-workspace.yaml');
  if (!existsSync(yamlPath)) throw new Error(`找不到 ${yamlPath}`);
  const text = readFileSync(yamlPath, 'utf8');
  /** @type {string[]} */
  const members = [];
  // 去掉注释行，避免把注释里的路径当成员
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.replace(/#.*$/, '').trimEnd();
    const m = line.match(/^\s*-\s*['"]?([^'"]+?)['"]?\s*$/);
    if (m) members.push(m[1].trim());
  }
  return members;
}

/** 收集所有声明了 name 的 workspace 包 */
function collectWorkspacePackages() {
  /** @type {Map<string, string>} */
  const found = new Map();
  for (const group of PKG_DIRS) {
    const base = join(ROOT, group);
    if (!existsSync(base)) continue;
    for (const entry of readdirSync(base, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      const dir = join(base, entry.name);
      const manifest = join(dir, 'package.json');
      if (!existsSync(manifest)) continue;
      const pkg = JSON.parse(readFileSync(manifest, 'utf8'));
      if (typeof pkg.name === 'string' && pkg.name.startsWith(`${SCOPE}/`)) {
        found.set(pkg.name, dir);
      }
    }
  }
  return found;
}

/** 读取一个消费者 package.json 的 dependencies / devDependencies */
function readConsumerDeps(dir) {
  const manifest = join(dir, 'package.json');
  if (!existsSync(manifest)) return new Set();
  const pkg = JSON.parse(readFileSync(manifest, 'utf8'));
  return new Set([
    ...Object.keys(pkg.dependencies ?? {}),
    ...Object.keys(pkg.devDependencies ?? {}),
  ]);
}

/** 递归收集一个目录下的所有 node_modules 宿主（含 workspace 包自身的嵌套依赖） */
function collectHosts(root, hosts) {
  for (const group of PKG_DIRS) {
    const base = join(root, group);
    if (!existsSync(base)) continue;
    for (const entry of readdirSync(base, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      const dir = join(base, entry.name);
      if (existsSync(join(dir, 'package.json'))) hosts.push(dir);
    }
  }
  return hosts;
}

/** 拷贝单个 workspace 包到宿主的 node_modules 下 */
function installPackage(pkgName, pkgDir, hostDir) {
  const target = join(hostDir, 'node_modules', ...pkgName.split('/'));
  try {
    // 先删旧的（可能是 pnpm 留下的空目录或上次的残留）
    if (existsSync(target)) {
      try {
        if (statSync(target).isDirectory()) rmSync(target, { recursive: true, force: true });
      } catch {
        /* 忽略：目标可能是坏掉的链接 */
      }
    }
    mkdirSync(dirname(target), { recursive: true });
    cpSync(pkgDir, target, {
      recursive: true,
      // node_modules 内部不拷贝（workspace 包自身不需要嵌套依赖）
      filter: (src) => !src.split(/[\\/]/).includes('node_modules') && !src.split(/[\\/]/).includes('.git'),
    });
    return { pkgName, target, ok: true };
  } catch (err) {
    return { pkgName, target, ok: false, error: err.message };
  }
}

function main() {
  const members = readWorkspaceMembers();
  const pkgs = collectWorkspacePackages();

  console.log(`workspace 成员 ${members.length} 个，已定位 @eng-forge 包 ${pkgs.size} 个：`);
// eslint-disable-next-line no-console
  for (const name of pkgs.keys()) console.log(`  - ${name}`);

  const hosts = collectHosts(ROOT, []);
  console.log(`\n宿主项目 ${hosts.length} 个，开始实体拷贝 workspace 包：\n`);

  let ok = 0;
  const failures = [];
  for (const host of hosts) {
    const deps = readConsumerDeps(host);
    // 该宿主声明依赖了哪些 workspace 包
    const needed = [...deps].filter((d) => pkgs.has(d));
    if (needed.length === 0) continue;
    const rel = host.replace(`${ROOT}/`, '');
    for (const pkgName of needed) {
      const res = installPackage(pkgName, pkgs.get(pkgName), host);
      if (res.ok) {
        ok += 1;
        console.log(`  ✓ ${rel}  <-  ${pkgName}`);
      } else {
        failures.push(res);
        console.log(`  ✗ ${rel}  <-  ${pkgName}  : ${res.error}`);
      }
    }
  }

  console.log(`\n完成：成功 ${ok} 个`);
  if (failures.length > 0) {
    console.error(`失败 ${failures.length} 个：`);
    for (const f of failures) console.error(`  ${f.pkgName} -> ${f.target}: ${f.error}`);
    process.exitCode = 1;
  }
}

main();
