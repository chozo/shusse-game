#!/usr/bin/env python3
"""tools/snapshot.js が出力した盤面を PNG に合成する（描画と当たり判定の一致確認用）。

    node tools/snapshot.js && python3 tools/render_snapshot.py [--hitbox]

js/render.js と同じ座標計算（body.position を重心とし、offsetX/offsetY を回転させて
画像中心を求める）を再現しているので、ここで合っていればブラウザでも合う。
"""

import json
import math
import os
import re
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from build_assets import read_png, write_png  # noqa: E402

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SNAPSHOT = os.path.join(ROOT, "tools", "debug", "snapshot.json")
OUT = os.path.join(ROOT, "tools", "debug", "board.png")

SCALE = 2  # js/stages.js の pixelRatio と合わせる（最適化画像が等倍で使える）


def load_stages():
    src = open(os.path.join(ROOT, "js", "stages.js")).read()
    return json.loads(re.sub(r"^.*?window\.STAGES_DATA\s*=\s*", "", src, flags=re.S).rstrip().rstrip(";"))


def config_value(name, default):
    """js/config.js から数値を1つ読む（描画を実物と揃えるため）。"""
    m = re.search(r"\b%s\s*:\s*(-?\d+(?:\.\d+)?)" % name, open(os.path.join(ROOT, "js", "config.js")).read())
    return float(m.group(1)) if m else default


def blend(dst, w, h, x, y, r, g, b, a):
    if a <= 0 or not (0 <= x < w and 0 <= y < h):
        return
    o = (y * w + x) * 4
    ia = 255 - a
    dst[o] = (r * a + dst[o] * ia) // 255
    dst[o + 1] = (g * a + dst[o + 1] * ia) // 255
    dst[o + 2] = (b * a + dst[o + 2] * ia) // 255
    dst[o + 3] = min(255, a + dst[o + 3] * ia // 255)


def draw_sprite(dst, W, H, img, iw, ih, cx, cy, angle):
    """画像中心 (cx, cy) に angle 回転で貼り付ける（逆変換 + バイリニア）。"""
    cos = math.cos(angle)
    sin = math.sin(angle)
    half_diag = math.hypot(iw, ih) / 2 + 2
    x0 = max(0, int(cx - half_diag))
    x1 = min(W - 1, int(cx + half_diag))
    y0 = max(0, int(cy - half_diag))
    y1 = min(H - 1, int(cy + half_diag))

    for py in range(y0, y1 + 1):
        dy = py + 0.5 - cy
        for px in range(x0, x1 + 1):
            dx = px + 0.5 - cx
            # 逆回転して画像座標へ
            u = dx * cos + dy * sin + iw / 2.0
            v = -dx * sin + dy * cos + ih / 2.0
            if u < 0 or v < 0 or u >= iw or v >= ih:
                continue
            su = int(u)
            sv = int(v)
            o = (sv * iw + su) * 4
            a = img[o + 3]
            if a:
                blend(dst, W, H, px, py, img[o], img[o + 1], img[o + 2], a)


def draw_line(dst, W, H, x0, y0, x1, y1, color, width=1):
    steps = int(max(abs(x1 - x0), abs(y1 - y0))) + 1
    r, g, b, a = color
    for i in range(steps + 1):
        t = i / float(steps)
        x = int(round(x0 + (x1 - x0) * t))
        y = int(round(y0 + (y1 - y0) * t))
        for ox in range(-width, width + 1):
            for oy in range(-width, width + 1):
                blend(dst, W, H, x + ox, y + oy, r, g, b, a)


def main():
    show_hitbox = "--hitbox" in sys.argv
    data = load_stages()
    snap = json.load(open(SNAPSHOT))

    W = data["boardWidth"] * SCALE
    H = data["boardHeight"] * SCALE

    # 背景（js/render.js のグラデーションに合わせる）
    canvas = bytearray(W * H * 4)
    for y in range(H):
        t = y / float(H - 1)
        r = int(0xDB + (0xF4 - 0xDB) * t)
        g = int(0xE7 + (0xF1 - 0xE7) * t)
        b = int(0xF3 + (0xE8 - 0xF3) * t)
        row = bytes((r, g, b, 255)) * W
        canvas[y * W * 4:(y + 1) * W * 4] = row

    # 画像キャッシュ
    images = {}
    for s in data["stages"]:
        path = os.path.join(ROOT, s["src"])
        iw, ih, px = read_png(path)
        images[s["stage"]] = (iw, ih, px)

    # 地面
    floor_h = int(config_value("floorHeight", 10) * SCALE)
    for y in range(H - floor_h, H):
        for x in range(W):
            blend(canvas, W, H, x, y, 90, 70, 45, 46)

    # デッドライン
    ly = int(config_value("deadlineY", 128) * SCALE)
    for x in range(0, W, 36):
        draw_line(canvas, W, H, x, ly, min(W - 1, x + 20), ly, (200, 60, 60, 110), 1)

    stages = {s["stage"]: s for s in data["stages"]}

    for body in sorted(snap["bodies"], key=lambda b: b["stage"]):
        st = stages[body["stage"]]
        iw, ih, px = images[body["stage"]]
        ang = body["angle"]
        cos = math.cos(ang)
        sin = math.sin(ang)
        # 重心 + 回転させたオフセット = 画像中心
        ox = st["offsetX"]
        oy = st["offsetY"]
        cx = (body["x"] + ox * cos - oy * sin) * SCALE
        cy = (body["y"] + ox * sin + oy * cos) * SCALE
        draw_sprite(canvas, W, H, px, iw, ih, cx, cy, ang)

        if show_hitbox:
            pts = []
            for v in st["verts"]:
                vx = body["x"] + v["x"] * cos - v["y"] * sin
                vy = body["y"] + v["x"] * sin + v["y"] * cos
                pts.append((vx * SCALE, vy * SCALE))
            for i in range(len(pts)):
                a = pts[i]
                b = pts[(i + 1) % len(pts)]
                draw_line(canvas, W, H, a[0], a[1], b[0], b[1], (255, 0, 80, 220), 0)
            draw_line(canvas, W, H, body["x"] * SCALE - 4, body["y"] * SCALE,
                      body["x"] * SCALE + 4, body["y"] * SCALE, (0, 128, 255, 255), 0)
            draw_line(canvas, W, H, body["x"] * SCALE, body["y"] * SCALE - 4,
                      body["x"] * SCALE, body["y"] * SCALE + 4, (0, 128, 255, 255), 0)

    out = OUT if not show_hitbox else OUT.replace(".png", "_hitbox.png")
    write_png(out, W, H, canvas)
    print("=> %s  (%d個 / スコア %d)" % (os.path.relpath(out, ROOT), len(snap["bodies"]), snap["score"]))


if __name__ == "__main__":
    main()
