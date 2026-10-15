#!/usr/bin/env bash
# `pnpm preview:local` — the LOCAL (open-source, Node) edition as a player gets it: a full production build
# (AIRP_DEPLOY=local, config/.env.local) served by the built server on http://localhost:3001 — the same thing
# Start-AIRP.cmd does on Windows, minus the install step. The browser build is described in
# apps/browser-runtime/README.md.
#
#   pnpm preview:local              # build, then serve (Ctrl+C stops)
#   pnpm preview:local --no-build   # serve the existing build
#   PREVIEW_LOCAL_PORT=3002 pnpm preview:local
set -euo pipefail
cd "$(dirname "$0")/.."
export AIRP_DEPLOY=local
PORT="${PREVIEW_LOCAL_PORT:-3001}"
BUILD=1
for a in "$@"; do case "$a" in --no-build) BUILD=0 ;; *) echo "unknown argument $a"; exit 2 ;; esac; done

[ -n "$(ls -A vendor/pi-rp 2>/dev/null)" ] || { echo "STOP: vendor/pi-rp is empty: git submodule update --init vendor/pi-rp"; exit 1; }
if [ "$BUILD" = 1 ]; then pnpm build; fi
[ -f apps/server/dist/index.js ] && [ -f apps/web/dist/index.html ] || { echo "STOP: no build — run without --no-build"; exit 1; }
if curl -s -o /dev/null -m 2 "http://127.0.0.1:$PORT/"; then echo "STOP: something already listens on $PORT (pnpm dev? PREVIEW_LOCAL_PORT=… to pick another)"; exit 1; fi

cat <<EOF

  local preview: $(node tools/deploy-mode.mjs label local 2>/dev/null || echo local)
  open http://localhost:$PORT/

  checklist
    1. lobby loads; account dialog's last line says "local · …"
    2. sign in (WORLDLINES_LOGIN=on) or set your own key (off) and open a world
    3. one character reply, one writer turn ("What do you do?")
    4. Ctrl+C here stops the server

EOF
PORT="$PORT" exec node apps/server/dist/index.js
