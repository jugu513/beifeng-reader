#!/usr/bin/env python3
"""生成 北风.ico —— 与程序内联 favicon 同一设计（红底圆角 + 三道白色风纹）。

设计真源是 dev/src/index.template.html 里的 data:image/svg+xml favicon。
本脚本把那段 SVG 抽出来，用 rsvg-convert 高质量栅格化，再拼成多尺寸 ico。
favicon 设计改了这里跟着跑一遍即可，两边永远同源。

依赖：librsvg2-bin（rsvg-convert）、Pillow。
用法：python3 dev/tool/make-icon.py   （输出仓库根的 北风.ico——它是发布文件：
      安装包与「创建桌面快捷方式.bat」都用它，别只放 dev/ 里）
"""
import os
import re
import subprocess
import tempfile
import urllib.parse
from PIL import Image

HERE = os.path.dirname(os.path.abspath(__file__))
TEMPLATE = os.path.normpath(os.path.join(HERE, "..", "src", "index.template.html"))
OUT = os.path.normpath(os.path.join(HERE, "..", "..", "北风.ico"))
SIZES = [(16, 16), (24, 24), (32, 32), (48, 48), (64, 64), (128, 128), (256, 256)]


def favicon_svg():
    html = open(TEMPLATE, encoding="utf-8").read()
    m = re.search(r'data:image/svg\+xml,([^"]+)', html)
    if not m:
        raise SystemExit("✗ 模板里找不到内联 favicon")
    return urllib.parse.unquote(m.group(1)).replace("\n", "")


def main():
    svg = favicon_svg()
    with tempfile.NamedTemporaryFile("w", suffix=".svg", delete=False, encoding="utf-8") as f:
        f.write(svg)
        svg_path = f.name
    try:
        # 渲染 512 主图（大图供 ico 各尺寸缩放，LANCZOS 在下面统一做）
        png = svg_path + ".png"
        subprocess.run(["rsvg-convert", "-w", "512", "-h", "512", svg_path, "-o", png],
                       check=True)
        img = Image.open(png).convert("RGBA")
    finally:
        for p in (svg_path, svg_path + ".png"):
            if os.path.exists(p):
                os.unlink(p)

    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    # Pillow 的 ICO 编码器从同一张原图按 sizes 缩放（自带 LANCZOS）
    img.save(OUT, format="ICO", sizes=SIZES)
    print(f"  ✓ {OUT} · {os.path.getsize(OUT)} B · {len(SIZES)} 尺寸")


if __name__ == "__main__":
    main()
