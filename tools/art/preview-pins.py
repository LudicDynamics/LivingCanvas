#!/usr/bin/env python3
"""Draw a layer's `map.plan.pins` on its picture, so you can see whether every
pin sits on the thing it names before you commit the coordinates.

Spec: assets/skills/world-art/SKILL.md §5 (placing pins).

    preview-pins.py templates/<world>/world/<layer>/README.md [-o preview.jpg]
                    [--pins '{"harbor": [0.3, 0.5]}']   # try coordinates without editing

Draws: the edge fade the map applies (7% each side), the caption band (top 15%),
the right rail (last 8%), a 0.1 grid with labels, and each pin as a numbered
dot with its key. Then lists problems:
  - a pin inside the outer 8% margin or the top caption band,
  - two pins closer than 0.07 (the map merges them visually),
  - a child place folder with no pin (it will fall back to a generic spot),
  - a pin key that names nothing on the layer (no child folder, no card stem,
    no character id, not `player`).
Exits 1 when there are problems. Needs Pillow and PyYAML only.
"""
import argparse
import json
import os
import re
import sys

import yaml
from PIL import Image, ImageDraw, ImageFont

MARGIN = 0.08
CAPTION = 0.15
CLEARANCE = 0.07


def frontmatter(path):
    text = open(path, encoding="utf-8").read()
    m = re.match(r"^---\n(.*?)\n---\n", text, re.S)
    return yaml.safe_load(m.group(1)) if m else {}


def world_root(layer_dir):
    d = os.path.abspath(layer_dir)
    while d != "/" and not os.path.exists(os.path.join(d, "world.json")):
        d = os.path.dirname(d)
    return d


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("readme")
    ap.add_argument("-o", "--out", default="pins-preview.jpg")
    ap.add_argument("--pins", help="JSON object of pins to draw instead of the README's")
    args = ap.parse_args()

    layer = os.path.dirname(os.path.abspath(args.readme))
    root = world_root(layer)
    plan = ((frontmatter(args.readme).get("map") or {}).get("plan") or {})
    picture = plan.get("picture")
    if not picture:
        print(f"{args.readme}: no map.plan.picture", file=sys.stderr)
        return 1
    pins = json.loads(args.pins) if args.pins else (plan.get("pins") or {})

    img = Image.open(os.path.join(root, picture)).convert("RGB")
    W, H = img.size
    over = Image.new("RGBA", img.size, (0, 0, 0, 0))
    d = ImageDraw.Draw(over)
    try:
        font = ImageFont.truetype("/System/Library/Fonts/Supplemental/Arial.ttf", max(14, W // 90))
    except OSError:
        font = ImageFont.load_default()

    fade = 0.07
    d.rectangle([0, 0, W, H * CAPTION], fill=(0, 0, 0, 110))
    d.rectangle([W * (1 - MARGIN), 0, W, H], fill=(0, 0, 0, 90))
    for box in ([0, 0, W * fade, H], [W * (1 - fade), 0, W, H], [0, 0, W, H * fade], [0, H * (1 - fade), W, H]):
        d.rectangle(box, fill=(20, 20, 30, 70))
    d.rectangle([W * MARGIN, H * MARGIN, W * (1 - MARGIN), H * (1 - MARGIN)], outline=(255, 220, 0, 200), width=2)
    for i in range(1, 10):
        d.line([W * i / 10, 0, W * i / 10, H], fill=(255, 255, 255, 40))
        d.line([0, H * i / 10, W, H * i / 10], fill=(255, 255, 255, 40))
        d.text((W * i / 10 + 3, 3), f".{i}", fill=(255, 255, 255, 160), font=font)
        d.text((3, H * i / 10 + 3), f".{i}", fill=(255, 255, 255, 160), font=font)

    r = max(8, W // 120)
    for n, (key, (x, y)) in enumerate(pins.items(), 1):
        cx, cy = x * W, y * H
        color = (80, 200, 255, 255) if key == "player" else (255, 90, 60, 255)
        d.ellipse([cx - r, cy - r, cx + r, cy + r], fill=color, outline=(255, 255, 255, 255), width=2)
        d.text((cx + r + 4, cy - r), f"{n} {key} ({x:.2f},{y:.2f})", fill=(255, 255, 255, 255), font=font,
               stroke_width=2, stroke_fill=(0, 0, 0, 255))
    Image.alpha_composite(img.convert("RGBA"), over).convert("RGB").save(args.out, quality=88)
    print(f"{args.out}: {W}x{H}, {len(pins)} pins on {picture}")

    problems = []
    for key, (x, y) in pins.items():
        if not (MARGIN <= x <= 1 - MARGIN and MARGIN <= y <= 1 - MARGIN):
            problems.append(f"{key} ({x}, {y}) is inside the outer {MARGIN:.0%} margin (fogged / under the rail)")
        elif y < CAPTION:
            problems.append(f"{key} ({x}, {y}) is under the caption band (top {CAPTION:.0%})")
    keys = list(pins)
    for i, a in enumerate(keys):
        for b in keys[i + 1:]:
            (ax, ay), (bx, by) = pins[a], pins[b]
            if ((ax - bx) ** 2 + (ay - by) ** 2) ** 0.5 < CLEARANCE:
                problems.append(f"{a} and {b} are closer than {CLEARANCE}")

    children = {e for e in os.listdir(layer) if os.path.isfile(os.path.join(layer, e, "README.md"))}
    stems = {e[:-3] for e in os.listdir(layer) if e.endswith(".md") and e != "README.md"}
    try:
        people = {c["id"] for c in json.load(open(os.path.join(root, "world.json"), encoding="utf-8")).get("characters", [])}
    except (OSError, ValueError, KeyError):
        people = set()
    for child in sorted(children - set(pins)):
        problems.append(f"place '{child}' has no pin (falls back to a generic spot)")
    for key in keys:
        if key != "player" and key not in children | stems | people:
            problems.append(f"pin '{key}' names nothing on this layer")
    if "player" not in pins:
        problems.append("no 'player' pin")
    for p in problems:
        print(f"  WARN {p}")
    return 1 if problems else 0


if __name__ == "__main__":
    sys.exit(main())
