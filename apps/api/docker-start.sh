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

# ── 首装灌词库 ─────────────────────────────────────────────
# 全新安装的库 word 表是空的，而前端没有词库管理入口，游戏 / 跟读 / 默写会集体
# 报「词库为空」。这里在 word 表为空时灌入随包样例词库（data/sample-ecdict.csv）。
# 幂等：已有词条时守卫脚本直接退出，只多一次 count 查询。
# 失败不阻断启动：词库缺失不该让 api 起不来，日志里会写明。
# 设 SEED_WORDS=0 可完全关闭（例如生产环境改用完整 ECDICT 手工灌入）。
#
# 🔴 脚本必须放在 apps/api/scripts/ 而不是仓库根 scripts/：
# 生产镜像是 `pnpm install --prod`，`@eng-forge/db` 的 workspace 符号链接只落在
# /app/apps/api/node_modules 下，/app/node_modules 里没有。ESM 按导入文件自身路径
# 向上找 node_modules，所以 /app/scripts/*.mjs 永远解析不到 @eng-forge/db
# （ERR_MODULE_NOT_FOUND，2026-10-14 生产实测），挪到 apps/api/scripts/ 才能解析。
# import-ecdict.mjs 用 resolve(process.cwd(), ...) 读 CSV，cwd 仍是 /app，不受影响。
if [ "${SEED_WORDS:-1}" != "0" ]; then
  pnpm exec tsx --tsconfig apps/api/tsconfig.json apps/api/scripts/ensure-starter-words.mjs || echo "[start] 灌词步骤失败，继续启动" >&2
fi

# tsx 必须显式指向 apps/api/tsconfig.json（仓库根 tsconfig.base.json 不含 experimentalDecorators）
exec pnpm exec tsx --tsconfig apps/api/tsconfig.json apps/api/src/main.ts
