# ==============================================================================
# build-fpk.ps1 —— 在 Windows 上打包 EnglishForge 为 fnOS 一键安装 .fpk
#
# 前置条件：
#   1. Docker Desktop for Windows 已安装并运行（Settings → Resources 建议分配 ≥16GB 内存）
#   2. Git for Windows 已安装（提供 Git Bash，用于跑 build-fpk.sh）
#   3. 磁盘有 ≥20GB 空闲（4 个镜像 build + tar.gz 导出）
#
# 用法：
#   cd W:\english-forge
#   .\scripts\build-fpk.ps1                    # 默认流程
#   .\scripts\build-fpk.ps1 -SkipBuild         # 复用已构建的镜像，只打包
#   .\scripts\build-fpk.ps1 -OutputDir "D:\out"
#
# 输出：
#   <OutputDir>\englishforge_v1.0.0.fpk    （约 500MB~1GB，含 4 个应用镜像 + 1 个 postgres）
#
# 时间预估：
#   首次全量构建：  60~120 分钟（Docker Desktop WSL2 后端较慢，api/web 各 10~20 分钟）
#   已有镜像重打包：5~10 分钟
#   .fpk 上传到 fnOS 应用中心 → 一键安装
# ==============================================================================
param(
  [string]$OutputDir = "W:\output",
  [switch]$SkipBuild
)

$ErrorActionPreference = "Stop"
$RepoRoot = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
$BashExe  = "C:\Program Files\Git\bin\bash.exe"

function Write-Step($msg, $color="Cyan") {
  Write-Host ""
  Write-Host "━━━ $msg ━━━" -ForegroundColor $color
}

function Write-Ok($msg)   { Write-Host "[✓] $msg" -ForegroundColor Green }
function Write-Warn($msg){ Write-Host "[!] $msg" -ForegroundColor Yellow }
function Write-Err($msg) { Write-Host "[x] $msg" -ForegroundColor Red }

# ════════════════════════════════════════════════════════════════════════════
Write-Step "1/6  环境自检" "Green"
# ════════════════════════════════════════════════════════════════════════════

# Docker 客户端
if (-not (Get-Command docker -ErrorAction SilentlyContinue)) {
  Write-Err "未找到 docker.exe。请先安装 Docker Desktop for Windows，并启动它。"
  exit 1
}
$dockerVersion = docker version --format '{{.Server.Version}}' 2>&1
if ($LASTEXITCODE -ne 0) {
  Write-Err "Docker Daemon 未运行。请启动 Docker Desktop 后重试。"
  Write-Host "  详细信息: $dockerVersion"
  exit 1
}
Write-Ok "Docker 服务端版本: $dockerVersion"

# Git Bash
if (-not (Test-Path $BashExe)) {
  Write-Err "未找到 Git Bash: $BashExe"
  Write-Host "  安装 Git for Windows: https://git-scm.com/download/win"
  Write-Host "  或手动指定: .\scripts\build-fpk.ps1"
  exit 1
}
Write-Ok "Git Bash: $BashExe"

# 磁盘空间
$repoDrive = (Get-Location).PSDrive.Name
$driveInfo = Get-PSDrive -Name $repoDrive
$freeGB = [math]::Round($driveInfo.Free / 1GB, 1)
if ($freeGB -lt 20) {
  Write-Err "磁盘 ${repoDrive}: 空闲仅 $freeGB GB，不足 20GB。构建镜像 + 打包至少需要 20GB。"
  exit 1
}
Write-Ok "磁盘 ${repoDrive}: 空闲 $freeGB GB"

# 输出目录
New-Item -ItemType Directory -Force -Path $OutputDir | Out-Null
Write-Ok "输出目录: $OutputDir"

# ════════════════════════════════════════════════════════════════════════════
Write-Step "2/6  构建 4 个应用镜像（耗时最长）"
# ════════════════════════════════════════════════════════════════════════════

if ($SkipBuild) {
  Write-Warn "跳过 docker compose build（复用已有镜像）"
} else {
  Write-Host "  提示: 首次构建 60~120 分钟。api/web 各 10~20 分钟，speech/ai 各 5~10 分钟。"
  Write-Host "  构建完成后自动继续，无需干预。可最小化窗口观察进度。"
  Write-Host ""

  Push-Location $RepoRoot
  try {
    docker compose build --parallel --progress plain
    if ($LASTEXITCODE -ne 0) {
      Write-Err "docker compose build 失败，退出码: $LASTEXITCODE"
      Write-Host "  常见原因: 网络超时（Docker Desktop → Settings → Resources → Network 检查）"
      Write-Host "  或磁盘/CPU 资源不足。"
      exit 1
    }
    Write-Ok "4 个镜像构建完成"
  }
  finally {
    Pop-Location
  }
}

# 验证 4 个镜像已存在
$images = @("englishforge/nginx:1.0.0","englishforge/api:1.0.0","englishforge/speech:1.0.0","englishforge/ai:1.0.0","postgres:16-alpine")
Write-Host ""
Write-Host "  验证镜像清单:"
foreach ($img in $images) {
  $size = (docker image inspect "$img" --format '{{.Size}}' 2>$null)
  if ($LASTEXITCODE -eq 0) {
    $sizeMB = [math]::Round([long]$size / 1MB, 1)
    Write-Host "    ✓ $img ($sizeMB MB)" -ForegroundColor Green
  } else {
    Write-Host "    x $img — 不存在" -ForegroundColor Red
  }
}

# ════════════════════════════════════════════════════════════════════════════
Write-Step "3/6  清理 dist/fpk 旧产物"
# ════════════════════════════════════════════════════════════════════════════

$distDir = Join-Path $RepoRoot "dist\fpk"
if (Test-Path $distDir) {
  Write-Host "  删除旧产物: $distDir"
  Remove-Item -Recurse -Force $distDir
}
Write-Ok "旧产物已清理"

# ════════════════════════════════════════════════════════════════════════════
Write-Step "4/6  组装 FPK 并打包（跑 build-fpk.sh --images --tar）"
# ════════════════════════════════════════════════════════════════════════════

Write-Host "  这一步会：docker save 导出 5 个镜像 → 组装目录 → tar.gz"
Write-Host "  耗时 5~15 分钟，取决于机器磁盘速度。"
Write-Host ""

Push-Location $RepoRoot
try {
  # bash -c 显式指定工作目录，避免 shell 状态影响
  $bashCmd = "bash scripts/build-fpk.sh --images --tar"
  & $BashExe -c $bashCmd
  if ($LASTEXITCODE -ne 0) {
    Write-Err "build-fpk.sh 失败，退出码: $LASTEXITCODE"
    exit 1
  }
  Write-Ok "build-fpk.sh 执行成功"
}
finally {
  Pop-Location
}

# ════════════════════════════════════════════════════════════════════════════
Write-Step "5/6  复制 .fpk 到输出目录"
# ════════════════════════════════════════════════════════════════════════════

$fpkPattern = Join-Path $distDir "englishforge_v*.fpk"
$fpkFiles = Get-ChildItem -Path $fpkPattern -ErrorAction SilentlyContinue
if ($fpkFiles.Count -eq 0) {
  Write-Err "未找到 .fpk 文件（期望路径 $fpkPattern）"
  exit 1
}

$fpkSrc = $fpkFiles[0].FullName
$fpkDst = Join-Path $OutputDir $fpkFiles[0].Name
Copy-Item -Force $fpkSrc $fpkDst
$fpkSizeMB = [math]::Round((Get-Item $fpkDst).Length / 1MB, 1)
Write-Ok "FPK 已就绪: $fpkDst  ($fpkSizeMB MB)"

# ════════════════════════════════════════════════════════════════════════════
Write-Step "6/6  部署指引" "Green"
# ════════════════════════════════════════════════════════════════════════════

Write-Host ""
Write-Host "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━" -ForegroundColor Green
Write-Host "  EnglishForge FPK 构建完成" -ForegroundColor Green
Write-Host "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━" -ForegroundColor Green
Write-Host ""
Write-Host "📦  FPK 位置: $fpkDst"
Write-Host "📏  文件大小: $fpkSizeMB MB"
Write-Host ""
Write-Host "下一步 —— 上传到飞牛 NAS 并安装:"
Write-Host ""
Write-Host "  1) 打开飞牛管理页  http://192.168.31.188:5666"
Write-Host "  2) 应用中心 → 第三方应用 → 上传应用"
Write-Host "  3) 选择 $fpkDst"
Write-Host "  4) 安装向导会问："
Write-Host "     - 存储空间：选 /volume1（至少 20GB）"
Write-Host "     - 管理员账号密码：脚本自动随机生成，抄到记事本"
Write-Host "  5) 安装完成后，桌面会出现「英语学习工作台」图标"
Write-Host "  6) 双击图标 → 打开 $fpkDst 所在浏览器地址"
Write-Host ""
Write-Host "🔗  首次访问地址（fnOS 默认 8443 → 我们改成 10011）:"
Write-Host "     http://192.168.31.188:10011"
Write-Host ""
Write-Host "🔥  防火墙记得放行 10011/TCP"
Write-Host ""
Write-Host "💡  如果安装报「端口占用」，去 fnOS 应用中心 → 应用设置 →"
Write-Host "     改 EnglishForge 的服务端口到别的端口（如 10012）"
Write-Host "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━" -ForegroundColor Green
