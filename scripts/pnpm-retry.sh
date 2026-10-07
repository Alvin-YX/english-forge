#!/bin/bash
# 在 NFS 上反复执行任意 pnpm 命令，失败后清理 *_tmp_<pid> 残留再重试。
# 用法：bash scripts/pnpm-retry.sh <pnpm子命令与参数...>
#   例：bash scripts/pnpm-retry.sh install --frozen-lockfile
#        bash scripts/pnpm-retry.sh add -w -D some-pkg
cd /w/english-forge || exit 1
export CODEBUDDY_SAFE_DELETE_ENABLED=0
STORE='C:\Users\13210\.pnpm-store-ef'
MAX=${PNPM_RETRY_MAX:-12}

for i in $(seq 1 "$MAX"); do
  echo "=== attempt $i: pnpm $* ==="
  out=$(pnpm "$@" --store-dir "$STORE" 2>&1)
  code=$?
  if [ $code -eq 0 ] && ! echo "$out" | grep -q "ERR_PNPM"; then
    echo "=== SUCCESS on attempt $i ==="
    echo "$out" | tail -6
    exit 0
  fi
  echo "$out" | grep -oE "ERR_PNPM_[A-Z]+" | head -1
  echo "$out" | grep -oE "node_modules.[^ ]*_tmp_[0-9]+" | head -1
  node ./scripts/clean-nfs-tmp.mjs
done
echo "=== FAILED after $MAX attempts ==="
exit 1
