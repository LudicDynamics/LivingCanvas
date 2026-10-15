#!/usr/bin/env python3
"""Put one finished image into every edition of a world, byte-identical, and
refresh every hash that records it.

Spec: assets/skills/world-art/SKILL.md §6 (mirror + hashes).

    publish-asset.py FILE <family> assets/characters/old-mo.webp [--dry-run]

Editions: templates/<family> and every templates/<family>-* that has a
world.json (e.g. wuwu, wuwu-jp, wuwu-zh, wuwu-tide). The file is copied to
<edition>/<target>. Then, in each edition, every JSON under assets/ is scanned
for an object whose "target" equals <target>; its "targetSha256" / "sha256"
is set to the new digest (source-manifest.json, three-times-media.json, ...).
JSON is rewritten with 2-space indent and a trailing newline, like the files
in the repo. No network. Standard library only.
"""
import argparse
import glob
import hashlib
import json
import os
import shutil
import sys

REPO = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))


def editions(family):
    base = os.path.join(REPO, "templates")
    names = [family] + sorted(n for n in os.listdir(base) if n.startswith(family + "-"))
    return [os.path.join(base, n) for n in names if os.path.isfile(os.path.join(base, n, "world.json"))]


def refresh(node, target, digest):
    hits = 0
    if isinstance(node, dict):
        if node.get("target") == target:
            for key in ("targetSha256", "sha256"):
                if key in node and node[key] != digest:
                    node[key] = digest
                    hits += 1
        for v in node.values():
            hits += refresh(v, target, digest)
    elif isinstance(node, list):
        for v in node:
            hits += refresh(v, target, digest)
    return hits


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("file")
    ap.add_argument("family")
    ap.add_argument("target", help="world-relative path, e.g. assets/maps/city.webp")
    ap.add_argument("--dry-run", action="store_true")
    args = ap.parse_args()
    if not args.target.startswith("assets/") or ".." in args.target:
        print("target must be a world-relative assets/... path", file=sys.stderr)
        return 1
    data = open(args.file, "rb").read()
    digest = hashlib.sha256(data).hexdigest()
    roots = editions(args.family)
    if not roots:
        print(f"no editions for {args.family}", file=sys.stderr)
        return 1
    for root in roots:
        dest = os.path.join(root, args.target)
        if not args.dry_run:
            os.makedirs(os.path.dirname(dest), exist_ok=True)
            if os.path.abspath(dest) != os.path.abspath(args.file):
                shutil.copyfile(args.file, dest)
        for manifest in glob.glob(os.path.join(root, "assets", "**", "*.json"), recursive=True):
            text = open(manifest, encoding="utf-8").read()
            doc = json.loads(text)
            hits = refresh(doc, args.target, digest)
            if hits and not args.dry_run:
                with open(manifest, "w", encoding="utf-8") as f:
                    f.write(json.dumps(doc, ensure_ascii=False, indent=2) + ("\n" if text.endswith("\n") else ""))
            if hits:
                print(f"  {os.path.relpath(manifest, REPO)}: {hits} hash(es)")
        print(f"{'would copy' if args.dry_run else 'copied'} -> {os.path.relpath(dest, REPO)}")
    print(f"sha256 {digest}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
