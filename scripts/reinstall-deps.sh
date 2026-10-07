#!/usr/bin/env bash
# 在本地磁盘完成 pnpm install，再把 node_modules 拷回 NFS 工作区。
#
# 为什么不直接 NFS 装：
#   NFS 不支持 symlink，且 rename 非原子。pnpm 的 headless install 在上面会
#   反复留下 <pkg>_tmp_<pid> 残留并报 EEXIST/EPERM/ENOENT，实测重试 15 轮仍
#   无法收敛，且会把 node_modules 搞成半残状态（多个包只解压了一半）。
#   本地磁盘无此限制，装完再整体拷贝即可（.npmrc 已用 hoisted 布局，全是实文件）。
#
# 用法：bash scripts/reinstall-deps.sh
set -euo pipefail

LOCAL_ROOT="${LOCAL_ROOT:-/c/Users/13210/dev/ef-deps}"
SRC="/w/english-forge"
STORE='C:\Users\13210\.pnpm-store-ef'

echo "=== 1/4 本地准备 ==="
rm -rf "$LOCAL_ROOT"
mkdir -p "$LOCAL_ROOT"

# 拷贝构建所需文件（不含 node_modules / dist / .venv 等重生成物）
echo "=== 2/4 拷贝源码到本地磁盘 ==="
for f in package.json pnpm-workspace.yaml pnpm-lock.yaml .npmrc tsconfig.base.json eslint.config.js .dependency-cruiser.js .prettierrc.json; do
  [ -f "$SRC/$f" ] && cp "$SRC/$f" "$LOCAL_ROOT/" || true
done
for d in apps packages; do
  mkdir -p "$LOCAL_ROOT/$d"
  # 只拷 package.json，install 阶段不需要源码
  for pkg in $(cd "$SRC" && ls -d $d/*/ 2>/dev/null); do
    name=$(basename "$pkg")
    [ -f "$SRC/$pkg/package.json" ] || continue
    mkdir -p "$LOCAL_ROOT/$pkg"
    cp "$SRC/$pkg/package.json" "$LOCAL_ROOT/$pkg/"
  done
done
echo "本地骨架：$(find "$LOCAL_ROOT" -name package.json | wc -l) 个 package.json"

echo "=== 3/4 本地安装 ==="
cd "$LOCAL_ROOT"
export CODEBUDDY_SAFE_DELETE_ENABLED=0

# pnpm 可能不在 PATH（新会话的 PATH 不含 corepack shim），逐个候选找
PNPM_BIN=""
for c in "$(command -v pnpm 2>/dev/null || true)" \
         "$APPDATA/npm/pnpm.cmd" \
         "/c/Users/13210/AppData/Local/node/corepack/v1/pnpm/9.15.0/bin/pnpm.cjs"; do
  [ -n "$c" ] && [ -f "$c" ] && { PNPM_BIN="$c"; break; }
done
[ -z "$PNPM_BIN" ] && { echo "✗ 找不到 pnpm，请先 corepack enable pnpm" >&2; exit 1; }
echo "  使用 pnpm: $PNPM_BIN"

if [[ "$PNPM_BIN" == *.cjs ]]; then
  node "$PNPM_BIN" install --store-dir "$STORE"
else
  "$PNPM_BIN" install --store-dir "$STORE"
fi

# better-sqlite3 是原生模块，必须有编译好的 .node 二进制，否则所有 DB 测试报
# "Could not locate the bindings file"。走 --ignore-scripts 或在 NFS 上装都会漏掉，
# 这里显式校验并给出可执行的补救指引。
if [ ! -f "$LOCAL_ROOT/node_modules/better-sqlite3/build/Release/better_sqlite3.node" ]; then
  echo ""
  echo "  ⚠ better-sqlite3 原生二进制缺失，尝试下载官方预编译产物..."
  # 从 npmmirror 的二进制镜像取。ABI 版本随 Node 主版本变化（Node 22 → v127）。
  BS_VER=$(node -p "require('$LOCAL_ROOT/node_modules/better-sqlite3/package.json').version" 2>/dev/null || echo "")
  NODE_ABI=$(node -p "process.versions.modules" 2>/dev/null || echo "")
  if [ -n "$BS_VER" ] && [ -n "$NODE_ABI" ]; then
    TARBALL="better-sqlite3-v${BS_VER}-node-v${NODE_ABI}-win32-x64.tar.gz"
    URL="https://registry.npmmirror.com/-/binary/better-sqlite3/v${BS_VER}/${TARBALL}"
    TMP_TGZ="$(mktemp -d)/${TARBALL}"
    if curl -fsSL -o "$TMP_TGZ" "$URL"; then
      mkdir -p "$LOCAL_ROOT/node_modules/better-sqlite3/build/Release"
      tar -xzf "$TMP_TGZ" -C "$LOCAL_ROOT/node_modules/better-sqlite3/build/Release"
      if [ -f "$LOCAL_ROOT/node_modules/better-sqlite3/build/Release/better_sqlite3.node" ]; then
        echo "  ✓ 已安装 better-sqlite3 ${BS_VER} (node-v${NODE_ABI})"
      else
        echo "  ✗ 解压后仍未找到 .node，DB 测试会失败"
      fi
    else
      echo "  ✗ 下载失败：${URL}"
      echo "    可手动下载后解压到 node_modules/better-sqlite3/build/Release/"
    fi
  else
    echo "  ✗ 无法确定 better-sqlite3 版本或 Node ABI，需手动处理"
  fi
fi

echo "=== 4/4 拷回 NFS ==="
cd "$SRC"
node scripts/clean-nfs-tmp.mjs || true
# 先搬走旧目录，再整体替换
if [ -d node_modules ]; then
  mv node_modules "node_modules.old.$$" 2>/dev/null || rm -rf node_modules
fi
echo "  拷贝中（node_modules 较大，请稍候）..."
cp -r "$LOCAL_ROOT/node_modules" "$SRC/node_modules"
rm -rf "node_modules.old.$$" 2>/dev/null || true

echo ""
echo "=== 完成 ==="
echo "node_modules 包数: $(ls node_modules | wc -l)"
echo "若 workspace 包报找不到，跑：node scripts/link-workspace-packages.mjs"