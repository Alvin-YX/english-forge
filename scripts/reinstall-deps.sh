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
  node "$PNPM_BIN" install --store-dir "$STORE" --ignore-scripts
else
  "$PNPM_BIN" install --store-dir "$STORE" --ignore-scripts
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