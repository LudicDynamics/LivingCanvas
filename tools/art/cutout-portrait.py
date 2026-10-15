#!/usr/bin/env python3
"""Cut a character standing portrait (立绘) out of its plain background.

Spec: assets/skills/world-art/SKILL.md §4 (portrait cutout).

    cutout-portrait.py IN OUT.webp --model anime|general [--min-fragment 0.03]
                       [--quality 88] [--max-height 1536] [--preview PREVIEW.jpg]

--model anime    isnet-anime        anime / cel-shaded / clean line art
--model general  isnet-general-use  painterly, semi-realistic, photographic

Steps: rembg (post_process_mask) -> drop alpha islands smaller than
--min-fragment x the largest island -> optional downscale -> WebP with alpha.
Prints a short report and exits 1 when the result looks wrong (no alpha,
figure too small, figure cut by the frame on several sides).

Needs rembg + onnxruntime + numpy + scipy + Pillow. Models are read from the
local ~/.u2net cache; nothing here fetches from the network by itself (rembg
downloads a missing model on first use, so warm the cache once on purpose).
e.g. ~/miniforge3/bin/python tools/art/cutout-portrait.py ...
"""
import argparse
import io
import sys

from PIL import Image

MODELS = {"anime": "isnet-anime", "general": "isnet-general-use"}


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("src")
    ap.add_argument("out")
    ap.add_argument("--model", required=True, choices=sorted(MODELS))
    ap.add_argument("--min-fragment", type=float, default=0.03, help="drop islands below this share of the largest (default 0.03)")
    ap.add_argument("--quality", type=int, default=88)
    ap.add_argument("--max-height", type=int, default=1536)
    ap.add_argument("--preview", help="also write a JPEG of the cutout on magenta, to eyeball halos")
    args = ap.parse_args()

    import numpy as np
    from rembg import new_session, remove
    from scipy import ndimage

    src = Image.open(args.src).convert("RGB")
    cut = remove(src, session=new_session(MODELS[args.model]), post_process_mask=True)
    if not isinstance(cut, Image.Image):
        cut = Image.open(io.BytesIO(cut))
    cut = cut.convert("RGBA")

    alpha = np.array(cut.getchannel("A"))
    labels, count = ndimage.label(alpha > 16)
    dropped = 0
    if count > 1:
        sizes = ndimage.sum(np.ones_like(alpha), labels, index=range(1, count + 1))
        keep = {i + 1 for i, s in enumerate(sizes) if s >= args.min_fragment * sizes.max()}
        dropped = count - len(keep)
        alpha[~np.isin(labels, list(keep))] = 0
        cut.putalpha(Image.fromarray(alpha))

    if cut.height > args.max_height:
        w = round(cut.width * args.max_height / cut.height)
        cut = cut.resize((w, args.max_height), Image.LANCZOS)
    cut.save(args.out, "WEBP", quality=args.quality, method=6, exact=False)

    a = np.array(Image.open(args.out).getchannel("A"))
    cover = float((a > 16).mean())
    edges = {"top": a[0], "bottom": a[-1], "left": a[:, 0], "right": a[:, -1]}
    touching = [k for k, row in edges.items() if (row > 16).mean() > 0.02]
    print(f"{args.out}: {cut.width}x{cut.height}  model={MODELS[args.model]}  islands={count} dropped={dropped}  figure={cover:.0%}  touches={','.join(touching) or 'none'}")

    if args.preview:
        bg = Image.new("RGB", cut.size, (255, 0, 255))
        bg.paste(cut, mask=cut.getchannel("A"))
        bg.save(args.preview, "JPEG", quality=85)

    problems = []
    if a.min() > 0:
        problems.append("no transparent pixels: the background was not removed")
    if cover < 0.08:
        problems.append("figure covers <8% of the frame: wrong subject or model, try the other --model")
    if len([k for k in touching if k != "bottom"]) >= 2:
        problems.append("figure touches 2+ non-bottom edges: regenerate with the whole figure in frame")
    for p in problems:
        print(f"  FAIL {p}", file=sys.stderr)
    return 1 if problems else 0


if __name__ == "__main__":
    sys.exit(main())
