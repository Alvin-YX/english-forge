#!/usr/bin/env bash
#
# build-fpk.sh —— 按 fnOS 官方规范打包 EnglishForge 为 .fpk
#
# 🔴 权威依据：ops/fnos/FPK-SPEC.md（已核实官方文档 developer.fnnas.com/docs）
#    本脚本替代了早期版本 —— 早期版本有 5 处与官方冲突，会导致安装直接失败：
#      1. privilege 用 bash 写          → 官方是 JSON
#      2. resource 声明 docker-project → 声明了会在镜像导入前就 compose up，直接 No such image
#      3. manifest 用 [Package] 且缺 distributor 等 fnpack 强制字段
#      4. 依赖 fnOS 托管 compose 生命周期 → 放弃 docker-project 后必须自己实现 up/down/status
#      5. 完全没有 cmd/ 生命周期脚本     → fnOS 安装后无法启动容器
#
# 用法：
#   bash scripts/build-fpk.sh                      # 仅组装目录，不打 tar
#   bash scripts/build-fpk.sh --images             # 先 docker save 导出镜像再组装
#   bash scripts/build-fpk.sh --images --tar       # 完整流程，产出 .fpk
#   bash scripts/build-fpk.sh --tar                # 跳过镜像导出，直接打包
#
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SPEC_DIR="${ROOT}/ops/fnos"
TEMPLATE_DIR="${SPEC_DIR}/fpk"
OUT_DIR="${ROOT}/dist/fpk"
PKG="englishforge"
VERSION="${VERSION:-1.0.0}"

WITH_IMAGES=0
MAKE_TAR=0
for arg in "$@"; do
  case "${arg}" in
    --images) WITH_IMAGES=1 ;;
    --tar)    MAKE_TAR=1 ;;
    -h|--help) sed -n '2,22p' "${BASH_SOURCE[0]}" | sed 's/^# \{0,1\}//'; exit 0 ;;
    *) echo "未知参数: ${arg}（用 --help 查看用法）" >&2; exit 1 ;;
  esac
done

[[ -d "${TEMPLATE_DIR}" ]] || { echo "✗ 缺少 FPK 模板目录 ${TEMPLATE_DIR}" >&2; exit 1; }

# 版本号以 manifest 为单一来源
if [[ -f "${TEMPLATE_DIR}/manifest" ]]; then
  v=$(grep -E '^version[[:space:]]*=' "${TEMPLATE_DIR}/manifest" | head -1 | sed -E 's/.*=[[:space:]]*//' | tr -d '\r')
  [[ -n "${v}" ]] && VERSION="${v}"
fi

COMPOSE="${ROOT}/docker-compose.yml"
[[ -f "${COMPOSE}" ]] || { echo "✗ 缺少 ${COMPOSE}" >&2; exit 1; }

# 从 compose 顶层 services 解析服务名（不依赖 PyYAML）
mapfile -t SERVICES < <(awk '
  /^services:[[:space:]]*$/ {f=1; next}
  /^[a-zA-Z]/ {f=0}
  f && /^  [a-zA-Z0-9_-]+:[[:space:]]*$/ {k=$0; sub(/^  /,"",k); sub(/:.*/,"",k); print k}
' "$COMPOSE")
[[ ${#SERVICES[@]} -eq 0 ]] && { echo "✗ 无法从 ${COMPOSE} 解析服务列表" >&2; exit 1; }

echo "=== EnglishForge FPK 打包 ==="
echo "版本    : ${VERSION}"
echo "服务    : ${SERVICES[*]}"
echo "输出目录: ${OUT_DIR}"
echo ""

STAGE="${OUT_DIR}/${PKG}"
# 清理上一轮产物。用 || true 保证：目录不存在、或被环境的安全删除钩子拦下时，
# 脚本继续往下走（后续 cp/mkdir 会覆盖同名文件，不会残留脏数据）。
if [[ -d "${STAGE}" ]]; then
  rm -rf "${STAGE}" 2>/dev/null || {
    echo "  ⚠ 无法完整清理 ${STAGE}（可能被占用），将覆盖式重建"
  }
fi
mkdir -p "${STAGE}/config" "${STAGE}/cmd" "${STAGE}/app/ui/images" "${STAGE}/app/docker"

# ── 1. 元数据：manifest / privilege / resource 已有核实过的权威版本 ──
cp "${TEMPLATE_DIR}/manifest"          "${STAGE}/manifest"
cp "${TEMPLATE_DIR}/config/privilege"  "${STAGE}/config/privilege"
cp "${TEMPLATE_DIR}/config/resource"   "${STAGE}/config/resource"

# ── 2. 生命周期脚本（install/upgrade/uninstall/config 各自 init+callback + main）──
cp "${TEMPLATE_DIR}"/cmd/* "${STAGE}/cmd/"
chmod +x "${STAGE}/cmd/"* 2>/dev/null || true

# ── 3. 桌面入口 ──
cp "${TEMPLATE_DIR}/app/ui/config" "${STAGE}/app/ui/config"
# 复用仓库根的真实图标（由 scripts/generate-icons.py 生成）
# 注意：Windows 上 ICON.png 与 ICON.PNG 是同一个文件（文件系统大小写不敏感），
# 打包时统一输出为 fnOS 要求的 ICON.PNG / ICON_256.PNG。
is_real_png() {
  local f="$1"
  [[ -f "$f" ]] || return 1
  # PNG magic number：\x89PNG\r\n\x1a\n
  local sig
  sig=$(head -c 8 "$f" | od -An -tx1 | tr -d ' \n')
  [[ "$sig" == "89504e470d0a1a0a" ]]
}
for pair in "ICON.PNG:ICON.PNG" "ICON_256.png:ICON_256.PNG"; do
  src="${ROOT}/${pair%%:*}"; dst_name="${pair##*:}"
  if is_real_png "${src}"; then
    cp "${src}" "${STAGE}/app/ui/images/${dst_name}"
    echo "  ✓ ${dst_name}"
  else
    echo "  ⚠ 缺少有效 PNG 图标 ${src}，请先执行：python scripts/generate-icons.py"
  fi
done

# ── 4. compose 与配置模板 ──
cp "${COMPOSE}" "${STAGE}/app/docker/docker-compose.yaml"
if [[ -d "${ROOT}/apps/nginx" ]]; then
  mkdir -p "${STAGE}/app/docker/nginx"
  cp -r "${ROOT}/apps/nginx/." "${STAGE}/app/docker/nginx/"
fi
if [[ -f "${ROOT}/.env.example" ]]; then
  cp "${ROOT}/.env.example" "${STAGE}/app/docker/.env.template"
else
  cat > "${STAGE}/app/docker/.env.template" <<'ENVEOF'
# 由 fnOS 安装向导生成真实随机值，请勿手工填写后分发
POSTGRES_PASSWORD=__POSTGRES_PASSWORD__
JWT_ACCESS_SECRET=__JWT_SECRET__
JWT_REFRESH_SECRET=__JWT_SECRET__
APP_MASTER_KEY=__APP_MASTER_KEY__
ENVEOF
fi

# ── 5. 镜像（体积大，默认不入包）──
mkdir -p "${STAGE}/app/docker/images"
if [[ ${WITH_IMAGES} -eq 1 ]]; then
  command -v docker >/dev/null || { echo "✗ 未安装 docker，无法导出镜像" >&2; exit 1; }
  for svc in "${SERVICES[@]}"; do
    img=$(awk -v s="$svc" '
      $0 ~ "^  "s":[[:space:]]*$" {inf=1; next}
      inf && /^  [a-zA-Z0-9_-]+:[[:space:]]*$/ {inf=0}
      inf && /^[[:space:]]*image:[[:space:]]*/ {sub(/^[[:space:]]*image:[[:space:]]*/,""); print; exit}
    ' "$COMPOSE")
    if [[ -z "$img" ]]; then
      echo "  · ${svc}: compose 未声明 image（走 build），跳过"
      continue
    fi
    echo "  · 导出 ${img} ..."
    docker save "$img" | gzip -1 > "${STAGE}/app/docker/images/${svc}.tar.gz"
  done
  echo "  ✓ 镜像已导出到 app/docker/images/"
else
  echo "  · 未指定 --images，跳过镜像导出"
  echo "    生产打包：bash scripts/build-fpk.sh --images --tar"
fi

# ── 6. 文档 ──
[[ -f "${ROOT}/LICENSE" ]] && cp "${ROOT}/LICENSE" "${STAGE}/LICENSE"
cp "${SPEC_DIR}/FPK-SPEC.md" "${STAGE}/README.md"
mkdir -p "${STAGE}/changelog"
echo "# ${PKG} ${VERSION}" > "${STAGE}/changelog/${VERSION}.md"

# ── 7. 打包 ──
if [[ ${MAKE_TAR} -eq 1 ]]; then
  tar -czf "${OUT_DIR}/${PKG}_v${VERSION}.fpk" -C "${OUT_DIR}" "${PKG}"
  SIZE=$(du -h "${OUT_DIR}/${PKG}_v${VERSION}.fpk" | cut -f1)
  echo ""
  echo "=== 完成 ==="
  echo "产物: ${OUT_DIR}/${PKG}_v${VERSION}.fpk  (${SIZE})"
  echo "上传: fnOS 应用中心 → 第三方应用"
else
  echo ""
  echo "=== 目录已就绪: ${STAGE} ==="
  echo "  打成 fpk:  bash scripts/build-fpk.sh --tar"
fi
