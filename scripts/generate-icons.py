#!/usr/bin/env python3
"""生成 EnglishForge 应用图标（PNG 多尺寸 + SVG 源）。

背景：仓库里的 `apps/web/public/icons/icon-{192,512}.png` 与根目录 `ICON.PNG`
此前是 53 字节的文本占位符（内容就是一行 "# Placeholder ..."），
`file` 认出它们不是 PNG。PWA manifest 引用这些文件、fnOS FPK 打包也要求
真实 PNG，占位符会导致：PWA 安装失败、fnOS 应用中心图标空白。

本脚本用 Pillow 直接绘制矢量级图形并导出各尺寸 PNG，不依赖外部设计工具，
保证任何机器上重跑都能得到一致结果。

用法（仓库根目录）：
    python scripts/generate-icons.py

产物：
    apps/web/public/icons/icon-192.png
    apps/web/public/icons/icon-512.png
    apps/web/public/icons/icon-maskable-512.png   # 安全区留白，供 maskable 用途
    apps/web/public/icons/apple-touch-icon.png   # 180x180
    ICON.png                # 根目录，fnOS FPK 用
    ICON_256.png            # 根目录，fnOS FPK 用
"""

from __future__ import annotations

import math
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont

ROOT = Path(__file__).resolve().parent.parent
WEB_ICONS = ROOT / "apps" / "web" / "public" / "icons"

# 品牌色：蓝（主）+ 琥珀（点缀），与前端 Tailwind 主题一致
BLUE = (59, 130, 246)
BLUE_DARK = (37, 99, 235)
BLUE_DEEP = (29, 78, 216)
AMBER = (251, 191, 36)
WHITE = (255, 255, 255)

TARGETS = {
    "icon-192.png": 192,
    "icon-512.png": 512,
    "apple-touch-icon.png": 180,
    "icon-maskable-512.png": 512,
}


def _rounded_mask(size: int, radius_ratio: float = 0.22) -> Image.Image:
    """圆角矩形遮罩（PWA 的 any 用途需要圆角，maskable 需要方形）。"""
    mask = Image.new("L", (size, size), 0)
    draw = ImageDraw.Draw(mask)
    draw.rounded_rectangle(
        (0, 0, size - 1, size - 1), radius=int(size * radius_ratio), fill=255
    )
    return mask


def _load_font(size: int) -> ImageFont.FreeTypeFont | ImageFont.ImageFont:
    """尽量用 DejaVuSans Bold；找不到时退回 Pillow 默认位图字体。"""
    candidates = [
        "C:/Windows/Fonts/arialbd.ttf",
        "C:/Windows/Fonts/segoeuib.ttf",
        "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf",
        "/System/Library/Fonts/Helvetica.ttc",
    ]
    for path in candidates:
        if Path(path).exists():
            try:
                return ImageFont.truetype(path, size)
            except OSError:
                continue
    return ImageFont.load_default()


def _draw_gradient(size: int) -> Image.Image:
    """竖向线性渐变背景，避免纯色单调。"""
    grad = Image.new("RGB", (1, size))
    pixels = grad.load()
    for y in range(size):
        t = y / max(size - 1, 1)
        # BLUE -> BLUE_DEEP
        pixels[0, y] = (
            round(BLUE[0] + (BLUE_DEEP[0] - BLUE[0]) * t),
            round(BLUE[1] + (BLUE_DEEP[1] - BLUE[1]) * t),
            round(BLUE[2] + (BLUE_DEEP[2] - BLUE[2]) * t),
        )
    return grad.resize((size, size), Image.BILINEAR)


def _draw_open_book(draw: ImageDraw.ImageDraw, size: int) -> None:
    """画一个打开的书本轮廓 —— 英语学习的直观符号。"""
    cx = size / 2
    cy = size * 0.58
    half_w = size * 0.27
    half_h = size * 0.16
    page_bottom = cy + half_h * 0.62

    def page(sign: int) -> None:
        """单页：上缘由书脊向外拱起，下缘平齐回落，形成翻开的书页。"""
        steps = 32
        top: list[tuple[float, float]] = []
        bottom: list[tuple[float, float]] = []
        for i in range(steps + 1):
            t = i / steps
            x = spine_x + sign * half_w * t
            # 上缘：靠近书脊时略高，中段最高，外缘回落 —— 模拟书页弧度
            y = cy - half_h * math.sin(math.pi * min(t * 1.15, 1.0)) * 0.62 - half_h * 0.08
            top.append((x, y))
            bottom.append((x, page_bottom))
        draw.polygon(top + bottom[::-1], fill=WHITE)

    spine_x = cx
    page(-1)
    page(1)

    # 书脊：只画在书页范围内，不外溢
    draw.line(
        [(spine_x, cy - half_h * 0.7), (spine_x, page_bottom)],
        fill=BLUE_DEEP,
        width=max(int(size * 0.016), 2),
    )

    # 页面上的文字行
    line_w = max(int(size * 0.014), 1)
    for sign in (-1, 1):
        for k, frac in enumerate((0.30, 0.58)):
            y = cy - half_h * 0.24 + k * half_h * 0.44
            x0 = spine_x + sign * half_w * 0.20
            x1 = spine_x + sign * half_w * (0.84 if frac == 0.30 else 0.66)
            draw.line([(x0, y), (x1, y)], fill=BLUE, width=line_w)


def _draw_star(draw: ImageDraw.ImageDraw, size: int) -> None:
    """右上角一颗琥珀色星星，点出「成就/游戏化」。"""
    cx, cy, r = size * 0.79, size * 0.225, size * 0.058
    inner = r * 0.45
    pts = []
    for i in range(10):
        ang = math.pi / 2 - i * math.pi / 5  # 起始朝上
        rad = r if i % 2 == 0 else inner
        pts.append((cx + rad * math.cos(ang), cy - rad * math.sin(ang)))
    draw.polygon(pts, fill=AMBER)


def render(size: int, *, rounded: bool = True, safe_area: float = 0.0) -> Image.Image:
    """渲染单张图标。

    Args:
        size: 边长（像素）
        rounded: 是否切圆角（any 用途 True，maskable 用途 False）
        safe_area: 内容缩放比例，maskable 用 0.72 留出安全区
    """
    img = _draw_gradient(size).convert("RGBA")

    # 内容层：按需为 maskable 留白
    content = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    cdraw = ImageDraw.Draw(content)

    if safe_area and safe_area < 1.0:
        # 画到独立层后整体缩放并居中
        inner = int(size * safe_area)
        layer = Image.new("RGBA", (inner, inner), (0, 0, 0, 0))
        ldraw = ImageDraw.Draw(layer)
        _draw_open_book(ldraw, inner)
        _draw_star(ldraw, inner)
        offset = (size - inner) // 2
        content.alpha_composite(layer, (offset, offset))
    else:
        _draw_open_book(cdraw, size)
        _draw_star(cdraw, size)

    img.alpha_composite(content)

    if rounded:
        img.putalpha(_rounded_mask(size))
    return img


SVG_SOURCE = """<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512" width="512" height="512">
  <defs>
    <linearGradient id="g" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0%" stop-color="#3b82f6"/>
      <stop offset="100%" stop-color="#1d4ed8"/>
    </linearGradient>
  </defs>
  <rect width="512" height="512" rx="113" ry="113" fill="url(#g)"/>
  <g fill="none" stroke="#ffffff" stroke-width="11" stroke-linecap="round">
    <path d="M133 297 Q133 240 256 240 Q379 240 379 297 L379 340 Q256 340 256 340 Q133 340 133 340 Z"
          fill="#ffffff" stroke="none"/>
    <line x1="256" y1="240" x2="256" y2="340"/>
  </g>
  <polygon points="397,73 407,95 431,99 413,117 417,141 397,130 377,141 381,117 363,99 387,95"
           fill="#fbbf24"/>
</svg>
"""


def main() -> None:
    WEB_ICONS.mkdir(parents=True, exist_ok=True)

    for filename, size in TARGETS.items():
        if "maskable" in filename:
            img = render(size, rounded=False, safe_area=0.72)
        else:
            img = render(size, rounded=True)
        path = WEB_ICONS / filename
        img.save(path, "PNG", optimize=True)
        print(f"  {path.relative_to(ROOT)}  ({size}x{size}, {path.stat().st_size} bytes)")

    svg_path = WEB_ICONS / "icon.svg"
    svg_path.write_text(SVG_SOURCE, encoding="utf-8")
    print(f"  {svg_path.relative_to(ROOT)}")

    # fnOS FPK 需要的根目录图标
    for name, size in (("ICON.png", 128), ("ICON_256.png", 256)):
        path = ROOT / name
        render(size, rounded=False).save(path, "PNG", optimize=True)
        print(f"  {name}  ({size}x{size}, {path.stat().st_size} bytes)")

    # 清理旧的文本占位符
    legacy = ROOT / "ICON.PNG"
    if legacy.exists() and legacy.stat().st_size < 1024:
        legacy.unlink()
        print(f"  removed legacy placeholder {legacy.name}")


if __name__ == "__main__":
    main()
