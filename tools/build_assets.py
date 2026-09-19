#!/usr/bin/env python3
"""出世ゲーム アセットビルドスクリプト

img/001.png 〜 011.png から以下を生成する。

  1. img/optimized/NNN.png  … 表示サイズの2倍に縮小した軽量画像
  2. js/stages.js           … ステージ定義（描画サイズ・当たり判定の凸包頂点）

当たり判定は「アルファ値が ALPHA_THRESHOLD 以上のピクセル」の凸包。
アルファチャンネルを持たない画像（白背景）は外周からの白抜きで透過化してから扱う。

依存ライブラリなし（標準ライブラリの zlib のみ使用）。
画像を差し替えたら本スクリプトを再実行すること。
"""

import json
import math
import os
import struct
import sys
import zlib
from collections import deque

# ---------------------------------------------------------------- 設定

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SRC_DIR = os.path.join(ROOT, "img")
OUT_DIR = os.path.join(ROOT, "img", "optimized")
JS_OUT = os.path.join(ROOT, "js", "stages.js")

STAGE_COUNT = 11

# フィールドの論理サイズ（js/config.js と一致させること）
BOARD_W = 400
BOARD_H = 720

# ステージ n の目標半径（等価円半径）: BASE_RADIUS * GROWTH^(n-1)
BASE_RADIUS = 26.0
GROWTH = 1.16

# 書き出す画像の解像度倍率（Retina 対応）
PIXEL_RATIO = 2

# 当たり判定とみなすアルファ値のしきい値
ALPHA_THRESHOLD = 128

# 凸包の最大頂点数（多すぎると物理演算が重くなる）
MAX_VERTS = 20

# アルファ無し画像を白抜きする際のしきい値（この値以上の RGB を背景とみなす）
WHITE_KEY = 235
# 白抜き後、境界をなじませる際の下限
WHITE_FEATHER = 200


# ---------------------------------------------------------------- PNG 読み込み

def read_png(path):
    """PNG を読んで (w, h, bytearray RGBA) を返す。8bit の colortype 2/6 のみ対応。"""
    data = open(path, "rb").read()
    if data[:8] != b"\x89PNG\r\n\x1a\n":
        raise ValueError("%s は PNG ではありません" % path)

    w, h, bit_depth, color_type, _, _, interlace = struct.unpack(">IIBBBBB", data[16:29])
    if bit_depth != 8 or color_type not in (2, 6) or interlace != 0:
        raise ValueError(
            "%s は未対応の形式です (bitdepth=%d colortype=%d interlace=%d)"
            % (path, bit_depth, color_type, interlace)
        )

    idat = bytearray()
    i = 8
    while i < len(data):
        length = struct.unpack(">I", data[i:i + 4])[0]
        ctype = data[i + 4:i + 8]
        if ctype == b"IDAT":
            idat += data[i + 8:i + 8 + length]
        elif ctype == b"IEND":
            break
        i += 12 + length

    raw = zlib.decompress(bytes(idat))
    ch = 4 if color_type == 6 else 3
    stride = w * ch

    # フィルタ解除
    out = bytearray(h * stride)
    prev = bytearray(stride)
    pos = 0
    for y in range(h):
        ft = raw[pos]
        pos += 1
        line = bytearray(raw[pos:pos + stride])
        pos += stride
        if ft == 1:
            for x in range(ch, stride):
                line[x] = (line[x] + line[x - ch]) & 255
        elif ft == 2:
            for x in range(stride):
                line[x] = (line[x] + prev[x]) & 255
        elif ft == 3:
            for x in range(ch):
                line[x] = (line[x] + (prev[x] >> 1)) & 255
            for x in range(ch, stride):
                line[x] = (line[x] + ((line[x - ch] + prev[x]) >> 1)) & 255
        elif ft == 4:
            for x in range(stride):
                a = line[x - ch] if x >= ch else 0
                b = prev[x]
                c = prev[x - ch] if x >= ch else 0
                p = a + b - c
                pa = abs(p - a)
                pb = abs(p - b)
                pc = abs(p - c)
                if pa <= pb and pa <= pc:
                    pr = a
                elif pb <= pc:
                    pr = b
                else:
                    pr = c
                line[x] = (line[x] + pr) & 255
        elif ft != 0:
            raise ValueError("不正なフィルタ種別 %d" % ft)
        out[y * stride:(y + 1) * stride] = line
        prev = line

    if ch == 4:
        return w, h, out

    # RGB → RGBA（全不透明として展開）
    rgba = bytearray(w * h * 4)
    for p in range(w * h):
        rgba[p * 4:p * 4 + 3] = out[p * 3:p * 3 + 3]
        rgba[p * 4 + 3] = 255
    return w, h, rgba


# ---------------------------------------------------------------- PNG 書き出し

def write_png(path, w, h, rgba):
    """RGBA バイト列を PNG として書き出す。"""

    def chunk(tag, payload):
        body = tag + payload
        return struct.pack(">I", len(payload)) + body + struct.pack(">I", zlib.crc32(body) & 0xFFFFFFFF)

    # 行ごとに最適なフィルタを選ぶ（絶対値和が最小のものを採用する標準的な heuristic）
    raw = bytearray()
    stride = w * 4
    prev = bytearray(stride)
    for y in range(h):
        line = rgba[y * stride:(y + 1) * stride]
        candidates = []

        none = bytes(line)
        candidates.append((0, none))

        sub = bytearray(stride)
        for x in range(stride):
            sub[x] = (line[x] - (line[x - 4] if x >= 4 else 0)) & 255
        candidates.append((1, sub))

        up = bytearray(stride)
        for x in range(stride):
            up[x] = (line[x] - prev[x]) & 255
        candidates.append((2, up))

        paeth = bytearray(stride)
        for x in range(stride):
            a = line[x - 4] if x >= 4 else 0
            b = prev[x]
            c = prev[x - 4] if x >= 4 else 0
            p = a + b - c
            pa = abs(p - a)
            pb = abs(p - b)
            pc = abs(p - c)
            if pa <= pb and pa <= pc:
                pr = a
            elif pb <= pc:
                pr = b
            else:
                pr = c
            paeth[x] = (line[x] - pr) & 255
        candidates.append((4, paeth))

        best = min(candidates, key=lambda c: sum(v if v < 128 else 256 - v for v in c[1]))
        raw.append(best[0])
        raw += best[1]
        prev = line

    png = b"\x89PNG\r\n\x1a\n"
    png += chunk(b"IHDR", struct.pack(">IIBBBBB", w, h, 8, 6, 0, 0, 0))
    png += chunk(b"IDAT", zlib.compress(bytes(raw), 9))
    png += chunk(b"IEND", b"")
    open(path, "wb").write(png)


# ---------------------------------------------------------------- 白背景の透過化

def has_alpha(w, h, rgba):
    """実質的にアルファチャンネルを持つか（完全不透明一色でないか）。"""
    for p in range(3, w * h * 4, 4):
        if rgba[p] != 255:
            return True
    return False


def white_key(w, h, rgba):
    """外周から連結した近白色領域を透過にする。内側の白（シャツ等）は残る。"""
    transparent = bytearray(w * h)
    queue = deque()

    def is_white(idx):
        base = idx * 4
        return rgba[base] >= WHITE_KEY and rgba[base + 1] >= WHITE_KEY and rgba[base + 2] >= WHITE_KEY

    for x in range(w):
        for idx in (x, (h - 1) * w + x):
            if not transparent[idx] and is_white(idx):
                transparent[idx] = 1
                queue.append(idx)
    for y in range(h):
        for idx in (y * w, y * w + w - 1):
            if not transparent[idx] and is_white(idx):
                transparent[idx] = 1
                queue.append(idx)

    while queue:
        idx = queue.popleft()
        x = idx % w
        y = idx // w
        if x > 0 and not transparent[idx - 1] and is_white(idx - 1):
            transparent[idx - 1] = 1
            queue.append(idx - 1)
        if x < w - 1 and not transparent[idx + 1] and is_white(idx + 1):
            transparent[idx + 1] = 1
            queue.append(idx + 1)
        if y > 0 and not transparent[idx - w] and is_white(idx - w):
            transparent[idx - w] = 1
            queue.append(idx - w)
        if y < h - 1 and not transparent[idx + w] and is_white(idx + w):
            transparent[idx + w] = 1
            queue.append(idx + w)

    # 境界の白フチをなじませる（透過画素に隣接する明るい画素を半透明に）
    span = float(WHITE_KEY - WHITE_FEATHER)
    for idx in range(w * h):
        if transparent[idx]:
            rgba[idx * 4 + 3] = 0
            continue
        x = idx % w
        y = idx // w
        neighbor = (
            (x > 0 and transparent[idx - 1])
            or (x < w - 1 and transparent[idx + 1])
            or (y > 0 and transparent[idx - w])
            or (y < h - 1 and transparent[idx + w])
        )
        if not neighbor:
            continue
        base = idx * 4
        brightness = min(rgba[base], rgba[base + 1], rgba[base + 2])
        if brightness > WHITE_FEATHER:
            rgba[base + 3] = max(0, min(255, int(255 * (WHITE_KEY - brightness) / span)))
    return rgba


# ---------------------------------------------------------------- 凸包

def convex_hull(points):
    """Andrew's monotone chain。反時計回り（画面座標なので見た目は時計回り）で返す。"""
    pts = sorted(set(points))
    if len(pts) <= 2:
        return pts

    def cross(o, a, b):
        return (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0])

    lower = []
    for p in pts:
        while len(lower) >= 2 and cross(lower[-2], lower[-1], p) <= 0:
            lower.pop()
        lower.append(p)
    upper = []
    for p in reversed(pts):
        while len(upper) >= 2 and cross(upper[-2], upper[-1], p) <= 0:
            upper.pop()
        upper.append(p)
    return lower[:-1] + upper[:-1]


def simplify_hull(hull, max_verts):
    """面積変化が最も小さい頂点から順に間引く（Visvalingam 相当）。"""
    poly = list(hull)
    while len(poly) > max_verts:
        best_i = 0
        best_area = None
        n = len(poly)
        for i in range(n):
            a = poly[i - 1]
            b = poly[i]
            c = poly[(i + 1) % n]
            area = abs((b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0])) / 2.0
            if best_area is None or area < best_area:
                best_area = area
                best_i = i
        poly.pop(best_i)
    return poly


def polygon_centroid(poly):
    a2 = 0.0
    cx = 0.0
    cy = 0.0
    n = len(poly)
    for i in range(n):
        x0, y0 = poly[i]
        x1, y1 = poly[(i + 1) % n]
        cr = x0 * y1 - x1 * y0
        a2 += cr
        cx += (x0 + x1) * cr
        cy += (y0 + y1) * cr
    if abs(a2) < 1e-9:
        return (sum(p[0] for p in poly) / n, sum(p[1] for p in poly) / n)
    return (cx / (3.0 * a2), cy / (3.0 * a2))


# ---------------------------------------------------------------- 縮小

def resize(w, h, rgba, nw, nh):
    """ボックスフィルタ縮小。アルファを乗算済みにしてから平均する（フチの黒ずみ防止）。"""
    out = bytearray(nw * nh * 4)
    xs = [(x * w) // nw for x in range(nw + 1)]
    ys = [(y * h) // nh for y in range(nh + 1)]
    for ny in range(nh):
        y0, y1 = ys[ny], max(ys[ny] + 1, ys[ny + 1])
        for nx in range(nw):
            x0, x1 = xs[nx], max(xs[nx] + 1, xs[nx + 1])
            sr = sg = sb = sa = 0
            count = 0
            for y in range(y0, y1):
                base = (y * w + x0) * 4
                for _ in range(x1 - x0):
                    a = rgba[base + 3]
                    sr += rgba[base] * a
                    sg += rgba[base + 1] * a
                    sb += rgba[base + 2] * a
                    sa += a
                    count += 1
                    base += 4
            o = (ny * nw + nx) * 4
            if sa == 0:
                out[o:o + 4] = b"\x00\x00\x00\x00"
            else:
                out[o] = min(255, sr // sa)
                out[o + 1] = min(255, sg // sa)
                out[o + 2] = min(255, sb // sa)
                out[o + 3] = min(255, sa // count)
    return out


# ---------------------------------------------------------------- デバッグ描画

def draw_hull_overlay(w, h, rgba, hull, scale, centroid):
    """当たり判定の確認用に、凸包と重心を画像へ焼き込んだコピーを返す。"""
    img = bytearray(rgba)

    def put(x, y, color):
        if 0 <= x < w and 0 <= y < h:
            o = (y * w + x) * 4
            img[o:o + 4] = color

    def line(x0, y0, x1, y1, color):
        steps = int(max(abs(x1 - x0), abs(y1 - y0))) + 1
        for i in range(steps + 1):
            t = i / float(steps)
            x = int(round(x0 + (x1 - x0) * t))
            y = int(round(y0 + (y1 - y0) * t))
            for dx in (-1, 0, 1):
                for dy in (-1, 0, 1):
                    put(x + dx, y + dy, color)

    red = b"\xff\x00\x00\xff"
    blue = b"\x00\x80\xff\xff"
    n = len(hull)
    for i in range(n):
        x0, y0 = hull[i]
        x1, y1 = hull[(i + 1) % n]
        line(x0 * scale, y0 * scale, x1 * scale, y1 * scale, red)
    cx, cy = centroid
    line(cx * scale - 8, cy * scale, cx * scale + 8, cy * scale, blue)
    line(cx * scale, cy * scale - 8, cx * scale, cy * scale + 8, blue)
    return img


# ---------------------------------------------------------------- メイン

def main():
    debug = "--debug" in sys.argv
    debug_dir = os.path.join(ROOT, "tools", "debug")
    os.makedirs(OUT_DIR, exist_ok=True)
    os.makedirs(os.path.dirname(JS_OUT), exist_ok=True)
    if debug:
        os.makedirs(debug_dir, exist_ok=True)

    stages = []
    for n in range(1, STAGE_COUNT + 1):
        name = "%03d.png" % n
        src = os.path.join(SRC_DIR, name)
        if not os.path.exists(src):
            print("!! %s が見つかりません" % src)
            sys.exit(1)

        w, h, rgba = read_png(src)
        keyed = False
        if not has_alpha(w, h, rgba):
            rgba = white_key(w, h, rgba)
            keyed = True

        # --- 不透明ピクセルを走査して凸包と面積を求める
        points = []
        opaque = 0
        for y in range(h):
            row = y * w
            left = -1
            right = -1
            for x in range(w):
                if rgba[(row + x) * 4 + 3] >= ALPHA_THRESHOLD:
                    opaque += 1
                    if left < 0:
                        left = x
                    right = x
            if left >= 0:
                points.append((left, y))
                points.append((right + 1, y))
                points.append((left, y + 1))
                points.append((right + 1, y + 1))

        if opaque == 0:
            print("!! %s に不透明ピクセルがありません" % name)
            sys.exit(1)

        hull = simplify_hull(convex_hull(points), MAX_VERTS)

        # --- サイズ決定: 不透明面積の等価半径を目標半径に合わせる
        target_radius = BASE_RADIUS * (GROWTH ** (n - 1))
        equiv_radius = math.sqrt(opaque / math.pi)
        scale = target_radius / equiv_radius

        render_w = w * scale
        render_h = h * scale

        cx, cy = polygon_centroid(hull)
        verts = [{"x": round((px - cx) * scale, 2), "y": round((py - cy) * scale, 2)} for px, py in hull]

        # 画像中心と当たり判定重心のズレ（描画位置補正に使う）
        offset_x = (w / 2.0 - cx) * scale
        offset_y = (h / 2.0 - cy) * scale

        # --- 軽量画像の書き出し
        out_w = max(1, int(round(render_w * PIXEL_RATIO)))
        out_h = max(1, int(round(render_h * PIXEL_RATIO)))
        small = resize(w, h, rgba, out_w, out_h)
        dst = os.path.join(OUT_DIR, name)
        write_png(dst, out_w, out_h, small)

        if debug:
            dw = max(1, w // 2)
            dh = max(1, h // 2)
            preview = resize(w, h, rgba, dw, dh)
            overlay = draw_hull_overlay(dw, dh, preview, hull, dw / float(w), (cx, cy))
            write_png(os.path.join(debug_dir, name), dw, dh, overlay)

        stages.append({
            "stage": n,
            "src": "img/optimized/" + name,
            "renderW": round(render_w, 2),
            "renderH": round(render_h, 2),
            "radius": round(target_radius, 2),
            "offsetX": round(offset_x, 2),
            "offsetY": round(offset_y, 2),
            "verts": verts,
        })

        print(
            "%s  元 %dx%d → 出力 %dx%d  表示 %.0fx%.0f  半径 %.1f  頂点 %d  不透明率 %.1f%%%s"
            % (name, w, h, out_w, out_h, render_w, render_h, target_radius,
               len(hull), 100.0 * opaque / (w * h), "  [白抜き]" if keyed else "")
        )

    payload = json.dumps({
        "boardWidth": BOARD_W,
        "boardHeight": BOARD_H,
        "pixelRatio": PIXEL_RATIO,
        "stages": stages,
    }, ensure_ascii=False, indent=1)

    # file:// でも読めるよう JSON ではなく JS として出力する（fetch は file:// で失敗するため）
    with open(JS_OUT, "w") as f:
        f.write("// tools/build_assets.py が自動生成。直接編集しないこと。\n")
        f.write("window.STAGES_DATA = " + payload + ";\n")
    print("\n=> %s を書き出しました" % os.path.relpath(JS_OUT, ROOT))


if __name__ == "__main__":
    main()
