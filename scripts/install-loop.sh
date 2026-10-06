#!/bin/bash
# 反复执行 pnpm install，每次失败后清理 NFS 上遗留的 *_tmp_* 临时目录
# 背景：NFS 网络盘不支持原子 rename，pnpm 的 "copy to tmp then rename" 策略会失败
cd /w/english-forge || exit 1
export CODEBUDDY_SAFE_DELETE_ENABLED=0
STORE='C:\Users\13210\.pnpm-store-ef'
MAX=${1:-10}
# inject-workspace-packages: NFS 不支持 symlink，workspace 包改为硬拷贝
# --ignore-scripts: 跳过 postinstall（argon2 会在包内建 node_modules，触发 rename 冲突）
EXTRA="--ignore-scripts --config.inject-workspace-packages=true"

for i in $(seq 1 "$MAX"); do
  echo "=== attempt $i ==="
  out=$(pnpm install --store-dir "$STORE" $EXTRA 2>&1)
  if echo "$out" | grep -q "ERR_PNPM"; then
    echo "$out" | grep -oE "ERR_PNPM_[A-Z]+" | head -1
    echo "$out" | grep -oE "node_modules.[^ ]*_tmp_[0-9]+" | head -1
    echo "--- cleaning stale tmp dirs ---"
    /c/Users/13210/.workbuddy/binaries/node/versions/22.22.2-3/node.exe ./scripts/clean-nfs-tmp.mjs
  else
    echo "=== INSTALL SUCCESS on attempt $i ==="
    echo "$out" | tail -8
    exit 0
  fi
done
echo "=== FAILED after $MAX attempts ==="
exit 1
