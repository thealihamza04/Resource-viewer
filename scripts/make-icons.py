#!/usr/bin/env python3
"""
Generates every app icon from code, so all platforms get the same design.

    python3 scripts/make-icons.py

Outputs
  build/icon.png              1024 px master (electron-builder default, Windows/Linux)
  build/icon.ico              Windows: 16–256 px, small sizes drawn separately
  build/icon.icns             macOS: 16–1024 px with Apple's standard ~10% margin
  build/icons/NxN.png         Linux hicolor sizes (16 … 1024)
  resources/icon.png          512 px window/taskbar icon used at runtime (Linux)
  src/renderer/src/assets/logo.png   128 px logo for the in-app title bar

Small sizes (≤ 32 px) are not just scaled down: they use thicker strokes, a bigger
hub and no fine detail, so the gauge stays readable in a taskbar or title bar.
"""
import math
import os
from PIL import Image, ImageDraw

ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..')

BG_TOP = (44, 44, 50)      # zinc-800-ish
BG_BOTTOM = (14, 14, 17)   # zinc-950-ish
TRACK = (70, 70, 80)
ARC_START = (42, 120, 214)  # palette blue (light step)
ARC_END = (110, 175, 250)   # brighter toward the needle
INK = (250, 250, 250)

START_DEG, END_DEG, VALUE_DEG = 135, 405, 335  # 270° sweep, open at the bottom


def lerp(a, b, t):
    return tuple(round(x + (y - x) * t) for x, y in zip(a, b))


def render(size: int, margin: float) -> Image.Image:
    """Draws the icon at `size` px. `margin` is the transparent inset (fraction of size)."""
    small = size <= 32
    ss = 16 if size <= 64 else 4  # supersampling factor
    S = size * ss
    img = Image.new('RGBA', (S, S), (0, 0, 0, 0))

    # --- body: rounded square with a vertical gradient
    m = round(S * margin)
    body = (m, m, S - m, S - m)
    bw = S - 2 * m
    radius = round(bw * (0.20 if small else 0.225))
    grad = Image.new('RGBA', (S, S))
    gd = ImageDraw.Draw(grad)
    for y in range(m, S - m):
        gd.line([(m, y), (S - m, y)], fill=lerp(BG_TOP, BG_BOTTOM, (y - m) / bw) + (255,))
    mask = Image.new('L', (S, S), 0)
    ImageDraw.Draw(mask).rounded_rectangle(body, radius=radius, fill=255)
    img.paste(grad, (0, 0), mask)
    d = ImageDraw.Draw(img)

    if not small:
        # thin light rim so the dark tile stays visible on dark taskbars/docks
        d.rounded_rectangle(body, radius=radius, outline=(255, 255, 255, 34), width=max(ss, round(bw * 0.006)))

    # --- gauge geometry (relative to the body, not the canvas)
    cx = S / 2
    cy = m + bw * (0.55 if small else 0.56)
    r = bw * (0.33 if small else 0.31)
    w = bw * (0.15 if small else 0.085)  # arc thickness
    box = [cx - r, cy - r, cx + r, cy + r]

    def cap(deg, color):
        a = math.radians(deg)
        rr = r - w / 2
        px, py = cx + rr * math.cos(a), cy + rr * math.sin(a)
        d.ellipse([px - w / 2, py - w / 2, px + w / 2, py + w / 2], fill=color)

    # track
    d.arc(box, START_DEG, END_DEG, fill=TRACK + (255,), width=round(w))
    cap(END_DEG, TRACK + (255,))
    # value arc with a gradient along the sweep
    steps = 90
    for i in range(steps):
        a0 = START_DEG + (VALUE_DEG - START_DEG) * i / steps
        a1 = START_DEG + (VALUE_DEG - START_DEG) * (i + 1) / steps + 0.6
        d.arc(box, a0, a1, fill=lerp(ARC_START, ARC_END, i / steps) + (255,), width=round(w))
    cap(START_DEG, ARC_START + (255,))
    cap(VALUE_DEG, ARC_END + (255,))

    # needle
    a = math.radians(VALUE_DEG)
    length = r * (0.80 if small else 0.74)
    nw = bw * (0.085 if small else 0.05)
    nx, ny = cx + length * math.cos(a), cy + length * math.sin(a)
    d.line([cx, cy, nx, ny], fill=INK + (255,), width=round(nw))
    d.ellipse([nx - nw / 2, ny - nw / 2, nx + nw / 2, ny + nw / 2], fill=INK + (255,))
    hub = bw * (0.075 if small else 0.075)
    d.ellipse([cx - hub, cy - hub, cx + hub, cy + hub], fill=INK + (255,))
    if not small:
        dot = hub * 0.38
        d.ellipse([cx - dot, cy - dot, cx + dot, cy + dot], fill=BG_BOTTOM + (255,))

    return img.resize((size, size), Image.LANCZOS)


# Every icns slot macOS looks up, as (type code, pixel size). All hold PNG data.
ICNS_SLOTS = [
    (b'icp4', 16), (b'icp5', 32), (b'icp6', 64), (b'ic07', 128), (b'ic08', 256),
    (b'ic09', 512), (b'ic10', 1024),                     # 1x
    (b'ic11', 32), (b'ic12', 64), (b'ic13', 256), (b'ic14', 512),  # @2x of 16/32/128/256
]


def write_icns(path, images):
    """Writes an .icns with every slot filled (Pillow's writer skips the 16/32 px ones)."""
    import io
    import struct
    chunks = b''
    for code, px in ICNS_SLOTS:
        buf = io.BytesIO()
        images[px].save(buf, 'PNG')
        data = buf.getvalue()
        chunks += code + struct.pack('>I', len(data) + 8) + data
    with open(path, 'wb') as f:
        f.write(b'icns' + struct.pack('>I', len(chunks) + 8) + chunks)


def out(*parts):
    p = os.path.join(ROOT, *parts)
    os.makedirs(os.path.dirname(p), exist_ok=True)
    return p


def main():
    # Windows & Linux tiles fill most of the canvas; small sizes go edge to edge.
    def tile(size):
        return render(size, 0.0 if size <= 32 else 0.04)

    master = tile(1024)
    master.save(out('build', 'icon.png'))

    # Linux hicolor theme sizes
    for s in (16, 24, 32, 48, 64, 128, 256, 512, 1024):
        tile(s).save(out('build', 'icons', f'{s}x{s}.png'))

    # Windows .ico — each size is its own drawing (append_images keeps them distinct)
    ico_sizes = [16, 20, 24, 32, 40, 48, 64, 128, 256]
    ico_imgs = [tile(s) for s in ico_sizes]
    ico_imgs[-1].save(out('build', 'icon.ico'), sizes=[(s, s) for s in ico_sizes], append_images=ico_imgs[:-1])

    # macOS .icns — Apple's grid leaves ~10% transparent margin around the tile
    mac = {s: render(s, 0.0 if s <= 32 else 0.10) for s in (16, 32, 64, 128, 256, 512, 1024)}
    write_icns(out('build', 'icon.icns'), mac)

    # runtime window icon + in-app logo
    tile(512).save(out('resources', 'icon.png'))
    tile(128).save(out('src', 'renderer', 'src', 'assets', 'logo.png'))

    # contact sheet for a quick visual check (not shipped)
    sheet_sizes = [16, 24, 32, 48, 64, 128, 256]
    W = sum(sheet_sizes) + 20 * (len(sheet_sizes) + 1)
    for name, bg in (('light', (245, 245, 245, 255)), ('dark', (30, 30, 30, 255))):
        sheet = Image.new('RGBA', (W, 256 + 40), bg)
        x = 20
        for s in sheet_sizes:
            sheet.alpha_composite(tile(s), (x, 20 + (256 - s) // 2))
            x += s + 20
        sheet.save(out('build', f'.preview-{name}.png'))
    print('icons written')


if __name__ == '__main__':
    main()
