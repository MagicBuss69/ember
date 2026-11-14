"""Draw Ember's PWA icons and monochrome Android notification badge."""

import math
from pathlib import Path

from PIL import Image, ImageDraw

ROOT = Path(__file__).resolve().parents[1] / "public" / "icons"
BG = (16, 14, 12, 255)
ACCENT = (255, 138, 61, 255)
TRACK = (70, 48, 36, 255)
GEM = (110, 224, 197, 255)
GEM_DARK = (8, 66, 56, 255)


def gem_points(cx, cy, s):
    return [
        (cx, cy - s),
        (cx + s * 0.92, cy - s * 0.28),
        (cx + s * 0.62, cy + s * 0.42),
        (cx, cy + s * 0.98),
        (cx - s * 0.62, cy + s * 0.42),
        (cx - s * 0.92, cy - s * 0.28),
    ]


def gem(draw, cx, cy, s):
    pts = gem_points(cx, cy, s)
    draw.polygon(pts, fill=GEM)
    draw.line([(cx, cy - s), (cx, cy + s * 0.98)], fill=GEM_DARK, width=max(1, int(s * 0.08)))
    draw.line(
        [(cx - s * 0.92, cy - s * 0.28), (cx, cy + s * 0.15), (cx + s * 0.92, cy - s * 0.28)],
        fill=(186, 255, 236, 180),
        width=max(1, int(s * 0.06)),
    )


def draw_mark(size, maskable=False):
    # Opaque square. Transparent corners make Chrome fall back to a shortcut.
    image = Image.new("RGB", (size, size), BG[:3])
    draw = ImageDraw.Draw(image)
    if maskable:
        inset = int(size * 0.22)
    else:
        inset = int(size * 0.14)
    box = (inset, inset, size - inset - 1, size - inset - 1)
    width = max(4, int(size * 0.045))
    draw.ellipse(box, outline=TRACK, width=width)
    draw.arc(box, start=128, end=400, fill=ACCENT, width=width)
    gem(draw, size * 0.68, size * 0.66, size * 0.075)
    return image


def draw_badge(size):
    """
    Monochrome (pure white #FFFFFF on transparent) silhouette of the Ember logo:
    the bold open Ember ring arc with rounded caps + crystal gem in the lower-right gap.
    Supersampled 4x so curves are crisp at Android status-bar sizes (24dp / 96px @ 4x).
    """
    scale = 4
    hi = size * scale
    alpha = Image.new("L", (hi, hi), 0)
    draw = ImageDraw.Draw(alpha)

    cx = hi * 0.5
    cy = hi * 0.5
    radius = hi * 0.36
    stroke = hi * 0.105
    half_stroke = stroke * 0.5
    box = (cx - radius, cy - radius, cx + radius, cy + radius)

    start_deg = 126
    end_deg = 362
    draw.arc(box, start=start_deg, end=end_deg, fill=255, width=int(round(stroke)))

    # Rounded end-caps on the Ember arc
    mid_r = radius - stroke * 0.5
    for deg in (start_deg, end_deg):
        rad = math.radians(deg)
        ex = cx + math.cos(rad) * mid_r
        ey = cy + math.sin(rad) * mid_r
        r_cap = half_stroke * 0.98
        draw.ellipse((ex - r_cap, ey - r_cap, ex + r_cap, ey + r_cap), fill=255)

    # Place the crystal gem centered in the lower-right opening with clean clearance on both sides
    gem_rad = math.radians(64)
    gx = cx + math.cos(gem_rad) * (mid_r * 1.02)
    gy = cy + math.sin(gem_rad) * (mid_r * 1.02)
    gs = hi * 0.125
    draw.polygon(gem_points(gx, gy, gs), fill=255)

    alpha_96 = alpha.resize((size, size), Image.LANCZOS)
    white = Image.new("L", (size, size), 255)
    return Image.merge("RGBA", (white, white, white, alpha_96))


def main():
    ROOT.mkdir(parents=True, exist_ok=True)
    draw_mark(192).save(ROOT / "icon-192.png")
    draw_mark(512).save(ROOT / "icon-512.png")
    draw_mark(512, maskable=True).save(ROOT / "icon-maskable-512.png")
    draw_mark(180).save(ROOT / "apple-touch-icon.png")
    draw_mark(32).save(ROOT / "favicon-32.png")
    draw_badge(96).save(ROOT / "badge-96.png")


if __name__ == "__main__":
    main()
