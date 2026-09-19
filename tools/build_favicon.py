#!/usr/bin/env python3
"""img/001.png（インターン）の頭部からファビコンを生成する。

    python3 tools/build_favicon.py

生成物:
  favicon.png           64x64  背景透過。ブラウザのタブ用
  apple-touch-icon.png  180x180 背景不透明。iOS のホーム画面用
                        （iOS は透過部分を黒く塗るため下地を敷く）

元画像は 170x247 の縦長なので、そのままでは正方形のファビコンにできない。
頭部を正方形に切り出して使う。
"""

import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from build_assets import read_png, write_png, resize  # noqa: E402

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SRC = os.path.join(ROOT, "img", "001.png")

# 頭部を囲む正方形。髪の先が切れないよう上に余白を取る
CROP_X, CROP_Y, CROP_SIDE = 2, -8, 166

# iOS のホーム画面アイコンの下地（ゲームの背景色）
BG = (232, 238, 245)


def crop_square(w, h, px, x0, y0, side):
    out = bytearray(side * side * 4)
    for y in range(side):
        sy = y0 + y
        if not (0 <= sy < h):
            continue
        row = sy * w
        for x in range(side):
            sx = x0 + x
            if not (0 <= sx < w):
                continue
            s = (row + sx) * 4
            d = (y * side + x) * 4
            out[d:d + 4] = px[s:s + 4]
    return out


def flatten(side, buf, bg):
    """透過部分を単色で埋める（iOS は透過を黒で塗るため）。"""
    out = bytearray(side * side * 4)
    for i in range(side * side):
        o = i * 4
        a = buf[o + 3]
        ia = 255 - a
        for c in range(3):
            out[o + c] = (buf[o + c] * a + bg[c] * ia) // 255
        out[o + 3] = 255
    return out


def main():
    w, h, px = read_png(SRC)
    square = crop_square(w, h, px, CROP_X, CROP_Y, CROP_SIDE)

    favicon = resize(CROP_SIDE, CROP_SIDE, square, 64, 64)
    write_png(os.path.join(ROOT, "favicon.png"), 64, 64, favicon)
    print("favicon.png           64x64   背景透過")

    touch = resize(CROP_SIDE, CROP_SIDE, square, 180, 180)
    write_png(os.path.join(ROOT, "apple-touch-icon.png"), 180, 180, flatten(180, touch, BG))
    print("apple-touch-icon.png  180x180 背景不透明 rgb%s" % (BG,))


if __name__ == "__main__":
    main()
