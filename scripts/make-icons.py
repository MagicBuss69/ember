"""Draw Ember's PWA icons. No photos, no remote assets."""

from pathlib import Path

from PIL import Image, ImageDraw

ROOT = Path(__file__).resolve().parents[1] / "public" / "icons"
BG = (16, 14, 12, 255)
ACCENT = (255, 138, 61, 255)
TRACK = (70, 48, 36, 255)
GEM = (110, 224, 197, 255)
GEM_DARK = (8, 66, 56, 255)


def gem(draw, cx, cy, s):
    pts = [
        (cx, cy - s),
        (cx + s * 0.92, cy - s * 0.28),
        (cx + s * 0.62, cy + s * 0.42),
        (cx, cy + s * 0.98),
        (cx - s * 0.62, cy + s * 0.42),
        (cx - s * 0.92, cy - s * 0.28),
    ]
    draw.polygon(pts, fill=GEM)
    draw.line([(cx, cy - s), (cx, cy + s * 0.98)], fill=GEM_DARK, width=max(1, int(s * 0.08)))
    draw.line([(cx - s * 0.92, cy - s * 0.28), (cx, cy + s * 0.15), (cx + s * 0.92, cy - s * 0.28)], fill=(186, 255, 236, 180), width=max(1, int(s * 0.06)))


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
    image = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    draw = ImageDraw.Draw(image)
    gem(draw, size / 2, size / 2, size * 0.34)
    return image


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
