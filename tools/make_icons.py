"""Draw the app icon (a geometric "C" on a teal tile) as PNGs, stdlib only.

Usage: python tools/make_icons.py
"""
import math
import struct
import zlib
from pathlib import Path

OUT = Path(__file__).resolve().parent.parent / "docs" / "icons"
TEAL = (14, 107, 107)
CREAM = (246, 244, 239)
GAP_DEG = 50          # half-opening of the C, centred on the right
R_OUT, R_IN = 0.30, 0.19  # ring radii as a fraction of the size


def in_c(x, y, scale):
    """Is the point (in units of the icon size, centred at 0) on the C?"""
    x, y = x / scale, y / scale
    r = math.hypot(x, y)
    mid, half = (R_OUT + R_IN) / 2, (R_OUT - R_IN) / 2
    ang = math.degrees(math.atan2(-y, x))
    if R_IN <= r <= R_OUT and abs(ang) >= GAP_DEG:
        return True
    for sign in (1, -1):  # rounded ends
        a = math.radians(sign * GAP_DEG)
        cx, cy = mid * math.cos(a), -mid * math.sin(a)
        if math.hypot(x - cx, y - cy) <= half:
            return True
    return False


def in_tile(x, y, radius):
    ax, ay = abs(x), abs(y)
    edge = 0.5 - radius
    if ax <= edge or ay <= edge:
        return ax <= 0.5 and ay <= 0.5
    return math.hypot(ax - edge, ay - edge) <= radius


def render(size, corner, scale=1.0, ss=3):
    rows = []
    for py in range(size):
        row = bytearray([0])
        for px in range(size):
            tile = cee = 0
            for sy in range(ss):
                for sx in range(ss):
                    x = (px + (sx + 0.5) / ss) / size - 0.5
                    y = (py + (sy + 0.5) / ss) / size - 0.5
                    if in_tile(x, y, corner):
                        tile += 1
                        if in_c(x, y, scale):
                            cee += 1
            n = ss * ss
            a = tile / n
            t = cee / tile if tile else 0
            rgb = [round(TEAL[i] * (1 - t) + CREAM[i] * t) for i in range(3)]
            row += bytes(rgb + [round(a * 255)])
        rows.append(bytes(row))
    raw = b"".join(rows)

    def chunk(tag, data):
        return struct.pack(">I", len(data)) + tag + data + struct.pack(">I", zlib.crc32(tag + data) & 0xFFFFFFFF)

    return (b"\x89PNG\r\n\x1a\n" + chunk(b"IHDR", struct.pack(">IIBBBBB", size, size, 8, 6, 0, 0, 0))
            + chunk(b"IDAT", zlib.compress(raw, 9)) + chunk(b"IEND", b""))


OUT.mkdir(parents=True, exist_ok=True)
(OUT / "icon-192.png").write_bytes(render(192, corner=0.22))
(OUT / "icon-512.png").write_bytes(render(512, corner=0.22))
(OUT / "icon-maskable-512.png").write_bytes(render(512, corner=0.0, scale=0.8))  # full bleed, safe zone
(OUT / "apple-touch-icon.png").write_bytes(render(180, corner=0.0))               # iOS rounds it itself
mid = (R_OUT + R_IN) / 2 * 100
w = (R_OUT - R_IN) * 100
g = math.radians(GAP_DEG)
x1, y1 = 50 + mid * math.cos(g), 50 - mid * math.sin(g)
x2, y2 = 50 + mid * math.cos(g), 50 + mid * math.sin(g)
(OUT / "icon.svg").write_text(
    f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100">'
    f'<rect width="100" height="100" rx="22" fill="rgb{TEAL}"/>'
    f'<path d="M{x1:.2f} {y1:.2f} A{mid:.2f} {mid:.2f} 0 1 0 {x2:.2f} {y2:.2f}" fill="none" '
    f'stroke="rgb{CREAM}" stroke-width="{w:.2f}" stroke-linecap="round"/></svg>\n',
    encoding="utf-8")
print("icons written:", sorted(p.name for p in OUT.iterdir()))
