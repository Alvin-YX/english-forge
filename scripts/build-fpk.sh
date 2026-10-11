#!/usr/bin/env bash
# ============================================================
# EnglishForge · 飞牛 fnOS 应用中心 FPK 打包脚本（合规版）
# 产物：dist/fpk/englishforge_v1.0.0.fpk （fnOS 官方「双层 gzip tar」）
#   · 外层：manifest / ICON.PNG / ICON_256.PNG / app.tgz / cmd/ / config/ / wizard/
#   · 内层 app.tgz：app/ 的内容（docker/ 与 ui/），解压后铺进安装目录的 target/
# 用法：
#   bash scripts/build-fpk.sh            # 仅生成合规目录结构
#   bash scripts/build-fpk.sh --images   # 把 5 个镜像 save 进包（离线安装必需）
#   bash scripts/build-fpk.sh --tar      # 打成 .fpk
#   bash scripts/build-fpk.sh --images --tar   # 生产打包（一次性）
# ============================================================
set -euo pipefail

PKG=englishforge
VERSION=1.0.0
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
OUT_DIR="$ROOT/dist/fpk"
STAGE="$OUT_DIR/$PKG"                     # 平铺根（fpk 内的 / ）
FPK="$OUT_DIR/${PKG}_v${VERSION}.fpk"

# ---- 架构自动探测（避免「应用包不符合系统要求」）----
# fnOS 部分版本拒绝 platform=all / 缺失 arch 字段；这里直接在打包机上
# 用 uname -m 探测，写进 manifest 的 arch 与 platform，保证与随包镜像一致。
detect_arch() {
  local m; m="$(uname -m 2>/dev/null || echo x86_64)"
  case "$m" in
    x86_64|amd64)  echo x86_64 ;;
    aarch64|arm64) echo aarch64 ;;
    *) echo x86_64 ;;                          # 兜底：绝大多数飞牛机型为 x86_64
  esac
}
ARCH="${ARCH_OVERRIDE:-$(detect_arch)}"   # 可用 ARCH_OVERRIDE=x86_64 强制覆盖
case "$ARCH" in
  x86_64)  PLATFORM=x86 ;;
  aarch64) PLATFORM=arm ;;
  *)       PLATFORM=x86 ;;
esac
echo "架构    : $ARCH (platform=$PLATFORM)"

# 随包分发的镜像（离线安装时先 docker load）
IMAGES="englishforge/nginx:${VERSION} englishforge/api:${VERSION} englishforge/speech:${VERSION} englishforge/ai:${VERSION} postgres:16-alpine"

IMAGES_FLAG=0; TAR_FLAG=0
for a in "$@"; do
  case "$a" in
    --images) IMAGES_FLAG=1 ;;
    --tar)    TAR_FLAG=1 ;;
  esac
done

echo "=== EnglishForge FPK 打包 ==="
echo "版本    : $VERSION"
echo "暂存目录: $STAGE"
echo "产物    : $FPK"

# 1) 重建平铺暂存目录（fpk 内根）
#    注意：fnOS 的 .fpk 是「双层 gzip tar」——外层只放 app.tgz（不是 app/ 目录），
#    内层 app.tgz 装 app/ 的内容。这里先照开发目录结构生成 app/，最后交给 fnpack 打包。
rm -rf "$STAGE"
mkdir -p "$STAGE/app/docker/images" "$STAGE/app/ui/images" "$STAGE/cmd" "$STAGE/config" "$STAGE/wizard"

# 2) ICON（仓库内搜索）
ICON=$(find "$ROOT" -maxdepth 2 -iname ICON.PNG 2>/dev/null | head -1)
ICON256=$(find "$ROOT" -maxdepth 2 -iname ICON_256.PNG 2>/dev/null | head -1)
[ -n "$ICON" ]    && cp -v "$ICON"    "$STAGE/ICON.PNG"    || { echo "✗ 找不到 ICON.PNG"; exit 1; }
[ -n "$ICON256" ] && cp -v "$ICON256" "$STAGE/ICON_256.PNG" || { echo "✗ 找不到 ICON_256.PNG"; exit 1; }

# 3) 部署用 docker-compose（无 build 段，只引用已构建/随包镜像）
#    🔴 生成随机 JWT 密钥（≥32 字符）：env.ts 校验要求 JWT_*_SECRET min(32)，
#    若写死 "change-me-in-production"(23字符) 会导致 api 启动即 parseEnv 失败 → 退出 → 502。
gen_secret() {
  if command -v openssl >/dev/null 2>&1; then
    openssl rand -hex 24          # 48 个 hex 字符，>32
  else
    head -c 24 /dev/urandom | od -An -tx1 | tr -d ' \n'
  fi
}
JWT_ACCESS_SECRET="$(gen_secret)"
JWT_REFRESH_SECRET="$(gen_secret)"
cat > "$STAGE/app/docker/docker-compose.yaml" <<'YAML'
version: "3.8"
services:
  nginx:
    image: englishforge/nginx:1.0.0
    ports:
      - "10011:80"
    depends_on:
      - api
      - speech
      - ai
    restart: unless-stopped
    networks:
      - forge-net
  api:
    image: englishforge/api:1.0.0
    environment:
      - NODE_ENV=production
      - PORT=3000
      - DATABASE_URL=postgresql://forge:forge_password@postgres:5432/englishforge
      - JWT_ACCESS_SECRET=__JWT_ACCESS_SECRET__
      - JWT_REFRESH_SECRET=__JWT_REFRESH_SECRET__
      - JWT_ISSUER=english-forge
      - CORS_ORIGINS=*
      - MEDIA_ROOT=/data/media
      - SPEECH_URL=http://speech:8001
      - AI_URL=http://ai:8002
    volumes:
      - media-data:/data/media
    depends_on:
      - postgres
      - speech
      - ai
    restart: unless-stopped
    networks:
      - forge-net
  speech:
    image: englishforge/speech:1.0.0
    restart: unless-stopped
    networks:
      - forge-net
  ai:
    image: englishforge/ai:1.0.0
    environment:
      - AI_PROVIDER=fake
      - AI_API_KEY=
      - AI_MODEL=gpt-4o
      - AI_BASE_URL=
      - AI_TIMEOUT=30
    restart: unless-stopped
    networks:
      - forge-net
  postgres:
    image: postgres:16-alpine
    environment:
      - POSTGRES_USER=forge
      - POSTGRES_PASSWORD=forge_password
      - POSTGRES_DB=englishforge
    volumes:
      - pg-data:/var/lib/postgresql/data
    restart: unless-stopped
    networks:
      - forge-net
volumes:
  pg-data:
  media-data:
networks:
  forge-net:
    driver: bridge
YAML

# 3a) 注入随机 JWT 密钥（仅 hex 字符，sed 安全）
sed -i "s#__JWT_ACCESS_SECRET__#${JWT_ACCESS_SECRET}#g; s#__JWT_REFRESH_SECRET__#${JWT_REFRESH_SECRET}#g" "$STAGE/app/docker/docker-compose.yaml"

# 3b) 桌面入口（app/ui/config + 图标）
#     fnOS 桌面图标 / 应用中心「打开」按钮由 app/ui/config 声明：
#     - 入口定义在 ".url" 下，key 必须以 appname 为前缀（englishforge.main）
#     - icon 的 {0} 是尺寸占位符，系统自动替换为 64/256，需同时提供两个尺寸
#     - port 必须是字符串，且与 manifest 的 service_port 一致（10011）
cat > "$STAGE/app/ui/config" <<'EOF'
{
  ".url": {
    "englishforge.main": {
      "title": "EnglishForge",
      "icon": "images/icon-{0}.png",
      "type": "url",
      "protocol": "http",
      "port": "10011",
      "url": "/",
      "allUsers": true
    }
  }
}
EOF
# 桌面图标直接复用包图标（ICON.PNG=64、ICON_256.PNG=256）
cp -f "$STAGE/ICON.PNG"     "$STAGE/app/ui/images/icon-64.png"
cp -f "$STAGE/ICON_256.PNG" "$STAGE/app/ui/images/icon-256.png"

# 4) manifest（INI）
cat > "$STAGE/manifest" <<EOF
appname = englishforge
version = 1.0.0
display_name = EnglishForge
desc = 飞牛 NAS 私有化部署的全学段英语学习软件（本地优先、默认零外网）。
platform = $PLATFORM
source = thirdparty
maintainer = EnglishForge
maintainer_url = https://github.com/your-org/englishforge
distributor = EnglishForge
distributor_url = https://github.com/your-org/englishforge
service_port = 10011
checkport = true
desktop_uidir = ui
desktop_applaunchname = englishforge.main
ctl_stop = true
EOF

# 5) config/privilege（JSON）
cat > "$STAGE/config/privilege" <<'EOF'
{
  "defaults": {
    "run-as": "package"
  },
  "username": "docker-englishforge",
  "groupname": "docker-englishforge"
}
EOF

# 6) config/resource（JSON）
# Docker 类应用【必须】声明 docker-project，否则应用中心判定不满足系统要求（不管理容器生命周期）。
# path 是相对 app/ 目录的路径，指向含 docker-compose.yaml 的文件夹（本包为 app/docker/）。
# name 为 compose 项目名，须符合 compose 命名规则（小写/数字/连字符/下划线，且以字母或数字开头）。
# 注意：不要声明 data-share —— fnOS 安装时会真实初始化共享目录（建目录+设 ACL），
# 若存储卷缺 trimacl 选项会静默失败（社区 tid=68401），且本应用数据走 compose 命名卷，无需共享目录。
cat > "$STAGE/config/resource" <<'EOF'
{
  "docker-project": {
    "projects": [
      { "name": "englishforge", "path": "docker" }
    ]
  }
}
EOF

# 7) cmd/main（生命周期；Docker 类应用启停由应用中心直接跑 compose）
cat > "$STAGE/cmd/main" <<'EOF'
#!/bin/bash
set -u
STATUS_IMG="englishforge/nginx:1.0.0"
running() { [ -n "$(docker ps -q --filter "ancestor=${STATUS_IMG}" 2>/dev/null)" ]; }
case "${1:-}" in
  start)  exit 0 ;;
  stop)   exit 0 ;;
  status) running && exit 0 || exit 3 ;;
  *)      exit 0 ;;
esac
EOF
chmod +x "$STAGE/cmd/main"

# 8) install_callback（离线安装关键：把随包镜像 load 进本地 docker）
#    安装时 app/ 的内容会被解压到 target/（TRIM_APPDEST），故镜像位于 ${TRIM_APPDEST}/docker/images
cat > "$STAGE/cmd/install_callback" <<'EOF'
#!/bin/bash
set -u
APPDEST="${TRIM_APPDEST:-/var/apps/englishforge/target}"
IMG_DIR="${APPDEST}/docker/images"
if [ -d "$IMG_DIR" ]; then
  for f in "$IMG_DIR"/*.tar.gz; do
    [ -e "$f" ] || continue
    echo "docker load: $(basename "$f")"
    docker load -i "$f"
  done
fi
exit 0
EOF
chmod +x "$STAGE/cmd/install_callback"

# 8b) 其余生命周期脚本（fnOS docker 应用校验要求 install_init / config_init / config_callback /
#     uninstall_init / uninstall_callback / upgrade_init / upgrade_callback 均存在；
#     这里给最小桩，docker 启停由应用中心直接托管 compose）。
for s in install_init config_init config_callback uninstall_init uninstall_callback upgrade_init upgrade_callback; do
  cat > "$STAGE/cmd/$s" <<'EOF'
#!/bin/bash
exit 0
EOF
  chmod +x "$STAGE/cmd/$s"
done

# 9) wizard/（目录需存在且保持为空即可通过校验；不留 .keep 占位，避免被当成无效向导文件）
#    （mkdir -p 已在步骤 1 创建该目录，此处无需再写文件）

# 10) 导出镜像（可选）
if [ "$IMAGES_FLAG" = "1" ]; then
  echo "· 导出镜像 -> $STAGE/app/docker/images"
  for img in $IMAGES; do
    safe="$(echo "$img" | tr ':/' '__')"
    echo "  - $img"
    docker save "$img" | gzip > "$STAGE/app/docker/images/${safe}.tar.gz"
  done
else
  echo "· 未指定 --images，跳过镜像导出（compose 将在安装时从仓库拉取，需联网）"
fi

# 11) 打包成 .fpk
#     fnOS 的 .fpk 是「双层 gzip tar」：外层只放 app.tgz（+ cmd/config/wizard/manifest/ICON），
#     内层 app.tgz 装 app/ 的内容（解压时直接铺进 target/，不带 app/ 前缀）。
#     · 优先调用官方 fnpack build（与本机 fnOS 打包器行为一致）
#     · 若无 fnpack，则手工等价实现
if [ "$TAR_FLAG" = "1" ]; then
  FNPACK_BIN="${FNPACK_BIN:-}"
  if [ -z "$FNPACK_BIN" ]; then
    for cand in fnpack /usr/local/bin/fnpack /usr/bin/fnpack ./fnpack; do
      if command -v "$cand" >/dev/null 2>&1 || [ -x "$cand" ]; then FNPACK_BIN="$cand"; break; fi
    done
  fi

  if [ -n "$FNPACK_BIN" ]; then
    echo "· 使用官方 fnpack 打包: $FNPACK_BIN"
    ( cd "$OUT_DIR" && "$FNPACK_BIN" build --directory "$STAGE" )
    SRC_FPK="$(find "$OUT_DIR" -maxdepth 2 -name "${PKG}.fpk" 2>/dev/null | head -1)"
    if [ -n "$SRC_FPK" ]; then
      mv -f "$SRC_FPK" "$FPK"
    else
      echo "✗ fnpack 未生成 ${PKG}.fpk（请检查上方输出）"; exit 1
    fi
  else
    echo "· 未找到 fnpack，回退到手工双层 tar 打包"
    tar -czf "$STAGE/app.tgz" -C "$STAGE/app" .   # 内层：app/ 内容（无 app/ 前缀）
    rm -rf "$STAGE/app"
    tar -czf "$FPK" -C "$STAGE" .                 # 外层
  fi

  echo "✓ 完成: $FPK"
  echo "  外层顶层（应为 manifest / ICON.PNG / ICON_256.PNG / app.tgz / cmd / config / wizard）："
  tar -tzf "$FPK" | sed 's#^\./##; s#/.*##' | sort -u
  TMPD="$(mktemp -d)"
  { tar -xzf "$FPK" -C "$TMPD" ./app.tgz 2>/dev/null || tar -xzf "$FPK" -C "$TMPD" app.tgz 2>/dev/null; } || true
  if [ -f "$TMPD/app.tgz" ]; then
    echo "  app.tgz 内层首层（应直接是 docker / ui，无 app/ 前缀）："
    tar -tzf "$TMPD/app.tgz" | sed 's#^\./##; s#/.*##' | sort -u
  else
    echo "  ⚠ 外层未包含 app.tgz —— GUI 安装会报「解压 app.tgz 失败」"
  fi
  rm -rf "$TMPD"
else
  echo "· 未指定 --tar，仅生成结构目录: $STAGE"
  echo "· 打成 fpk: bash $0 --tar"
fi
