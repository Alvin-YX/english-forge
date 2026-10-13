#!/usr/bin/env bash
# ============================================================
# EnglishForge · NAS 部署（从 Windows Git Bash 执行）
#
# 为什么需要这个脚本而不是 `git pull`：
#   本机和 NAS 是**两棵不同的 git 树**。NAS 侧 `/vol2/1000/WorkBuddy/英语学习/english-forge`
#   HEAD 停在 caa789e、有约 100 个未提交改动、且**没有 remote**（无 GitHub 凭据）。
#   所以不能 pull / reset / checkout —— 会用远端覆盖掉那约 100 个本地改动。
#   本脚本只用 tar 同步「本轮实际改过的文件」，其余原样保留。
#
# 用法：
#   bash scripts/deploy-to-nas.sh                # 同步 + 重建 api/nginx + 重启 + 回归
#   bash scripts/deploy-to-nas.sh --cleanup       # 额外软删 diagtest 账号（数据库层）
#
# 前置：本机到 NAS 的 SSH 密码认证（scp/ssh 会各提示一次密码）。
#       NAS 侧 docker 需要 sudo（脚本已加）。
#
# 可用环境变量覆盖：NAS_HOST NAS_USER NAS_DIR BASE_SHA APP_PORT
# ============================================================
set -euo pipefail

NAS_HOST="${NAS_HOST:-192.168.31.188}"
NAS_USER="${NAS_USER:-yuxiao}"
NAS_DIR="${NAS_DIR:-/vol2/1000/WorkBuddy/英语学习/english-forge}"
BASE_SHA="${BASE_SHA:-caa789e}"
APP_PORT="${APP_PORT:-10011}"
TARBALL="${TARBALL:-$HOME/efg-sync.tgz}"
CLEANUP=0
[ "${1:-}" = "--cleanup" ] && CLEANUP=1

ROOT="$(cd "$(dirname "$0")/.." && pwd)"

echo "━━ 1/5  生成同步包（$BASE_SHA..HEAD）"
cd "$ROOT"
FILES="$(git diff --name-only "$BASE_SHA..HEAD" -- ':!docs' ':!*.md' ':!ICON.PNG')"
if [ -z "$FILES" ]; then
  echo "❌ $BASE_SHA..HEAD 没有差异，说明 NAS 树基点可能已过时，先用 BASE_SHA 覆盖重试"
  exit 1
fi
echo "$FILES" | tar -czf "$TARBALL" -T -
echo "   $(echo "$FILES" | wc -l) 个文件 → $(basename "$TARBALL") ($(du -h "$TARBALL" | cut -f1))"

echo "━━ 2/5  上传到 NAS（可能提示输入密码）"
scp -o ConnectTimeout=10 -o BatchMode=no "$TARBALL" "${NAS_USER}@${NAS_HOST}:/tmp/efg-sync.tgz"

echo "━━ 3/5  NAS 侧校验基点 + 解包"
# 校验：只有当 NAS 树 HEAD 仍是已知基点时才覆盖，避免把未知改动盖掉
ssh -o ConnectTimeout=10 "${NAS_USER}@${NAS_HOST}" \
  "set -euo pipefail
   cd '${NAS_DIR}'
   HEAD_SHORT=\$(git rev-parse --short HEAD)
   echo \"   NAS 树 HEAD = \$HEAD_SHORT（期望 ${BASE_SHA}）\"
   if [ \"\$HEAD_SHORT\" != '${BASE_SHA}' ]; then
     echo '❌ NAS 树基点不符，已中止（未覆盖任何文件）'
     exit 1
   fi
   tar -xzf /tmp/efg-sync.tgz -C .
   echo \"   已同步 \$(tar -tzf /tmp/efg-sync.tgz | wc -l) 个文件\""

echo "━━ 4/5  重建镜像并重启（api 带后端，nginx 带前端静态）"
ssh -o ConnectTimeout=600 "${NAS_USER}@${NAS_HOST}" \
  "set -euo pipefail
   cd '${NAS_DIR}'
   sudo docker compose build nginx api
   sudo docker compose up -d api nginx
   sleep 10
   sudo docker compose ps"

echo "━━ 5/5  回归验证"
if [ "$CLEANUP" -eq 1 ]; then
  echo "   软删 diagtest 账号（走 postgres 容器；写 deleted_at，可逆）"
  # 引号已在 /tmp/qtest.sh 验证过：容器内 psql 收到的就是裸 SQL
  ssh -o ConnectTimeout=30 "${NAS_USER}@${NAS_HOST}" \
    "REMOTE_SQL=\$(printf \"%s\" 'UPDATE \"user\" SET deleted_at = now() WHERE username = '\''diagtest'\'' AND deleted_at IS NULL;')
     cd '${NAS_DIR}'
     sudo docker compose exec -T postgres psql -U forge -d englishforge -v ON_ERROR_STOP=1 -c \"\$REMOTE_SQL\""
fi

BASE_URL="http://${NAS_HOST}:${APP_PORT}/api/v1"
echo "   healthz: $(curl -sS "${BASE_URL}/system/healthz" 2>&1 | head -c 160)"
echo ""
echo "   逐项回归（判定标准见 scripts/probe-prod.mjs 头部注释）："
if command -v node >/dev/null 2>&1; then
  (cd "$ROOT" && node scripts/probe-prod.mjs)
else
  echo "   ⚠️  本机没有 node，跳过逐项回归"
fi

echo ""
echo "✅ 完成。访问地址：http://${NAS_HOST}:${APP_PORT}"
