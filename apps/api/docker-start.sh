#!/bin/sh
# 🔴 启动前先跑幂等 schema 迁移。
#
# 为什么必须放在进程入口而不是 install_callback：fpk 安装时 cmd/install_callback
# 只做 `docker load`（把随包镜像灌进本地 docker），此时容器尚未创建，库也不可用，
# 无处执行迁移。若不在此兜底，全新安装的库是空的，首个注册请求会直接 500：
#   `error: relation "user" does not exist`（2026-10-12 实测复现）。
#
# migrate.ts 是幂等的（§8.5）：先查 forge_migrations，已应用的版本按 sha256 hash
# 比对后直接跳过；hash 不一致则拒绝执行。所以每次启动都跑是安全且廉价的
# （已迁移后仅剩一次 index scan，实测 <100ms）。
#
# 迁移目录以 CWD 定位（packages/db/src/cli/migrate.ts: join(process.cwd(), 'migrations')），
# 所以必须先 cd 到 packages/db。
set -eu

cd /app/packages/db

# compose 的 depends_on 只保证 postgres 容器已创建，不保证它已开始接受连接。
# 全新安装时 postgres 与 api 同时启动，首轮连接可能失败，这里做有界重试。
ATTEMPTS=20
i=1
until pnpm exec tsx src/cli/migrate.ts; do
  code=$?
  if [ "$i" -ge "$ATTEMPTS" ]; then
    echo "[start] 迁移重试 $ATTEMPTS 次仍失败，退出（exit $code）" >&2
    exit "$code"
  fi
  echo "[start] 第 $i 次迁移失败（库可能未就绪），2s 后重试" >&2
  i=$((i + 1))
  sleep 2
done

cd /app
# tsx 必须显式指向 apps/api/tsconfig.json（仓库根 tsconfig.base.json 不含 experimentalDecorators）
exec pnpm exec tsx --tsconfig apps/api/tsconfig.json apps/api/src/main.ts
