# Browser mode (experimental)

The real `apps/server` and the real pi-rp CLI (with the repo's extensions) run
**unmodified** inside one Web Worker in the player's tab, on Node platform shims
(`src/platform/*`). The LivingCanvas web app talks to that in-tab server instead
of a host. Default OFF; with the flag off the app is unchanged.

## Try it

```sh
pnpm --filter @airp/server build          # apps/server/dist (also bundled into the runtime)
pnpm --filter @airp/web build             # apps/web/dist
node apps/browser-runtime/build.mjs       # apps/browser-runtime/dist (minified; MINIFY=0 for readable bundles)
node apps/browser-runtime/e2e/ui-host.mjs # dev host on http://127.0.0.1:3197
```

Open <http://127.0.0.1:3197/?mode=browser> (or tick 「浏览器模式（实验）」 at the bottom of the
character-voice settings panel and reload). `?mode=network` forces it off for one load.
Worlds come from the catalog (below); `?templates=a,b` still packs whole templates into the image (old checks).

Headless checks:

```sh
node apps/browser-runtime/e2e/ui.mjs --reload     # real UI: launcher (every edition per language) → Holmes → canvas → one action → writer frames; saves survive reload
node apps/browser-runtime/e2e/perf.mjs --reload   # where it stalls: boot / launcher / open→ready, page long tasks, Worker RTT, relay, peak RSS (--trace | --profile-page | --profile-worker <phase>; --turn is paid)
node apps/browser-runtime/e2e/ui.mjs --network-mode  # flag off: no Service Worker, /api from the host
node apps/browser-runtime/e2e/ambient.mjs           # real UI, no model call: The Last Train → ambient pointers unpaused and moving, /api/ambient read with the world open (--network-mode: same on Node)
node apps/browser-runtime/e2e/perf-site.mjs --url https://canvas.worldlines.gg/ [--browser webkit] [--play --sim-signin] [--node]  # lobby / runtime ready / open world / layer / turns, cold then warm; reads the page's ?perf=1 table
node apps/browser-runtime/e2e/run.mjs --max-calls 25 # bare runtime, one writer turn
node apps/browser-runtime/e2e/run.mjs --persist-test # VFS survives a page reload
node apps/browser-runtime/e2e/account.mjs         # account sign-in from the tab: Google start + callback round trip (add --send-mail for one real OTP mail to browser-mode-test@example.com)
node --test apps/browser-runtime/test/*.test.mjs
```

Screenshots and logs land in `e2e/out/` (ignored).

## 浏览器要求 (minimum browsers)

**Safari / iOS 16.4, Chrome / Edge 98, Firefox 125** (or newer). Below that the page shows
「你的浏览器版本太旧，请更新 Safari / Chrome」 with a 「重新加载」 button instead of starting a Worker
(`apps/web/src/lib/browser-support.ts`, feature tests only; `index.html` skips the early Worker too).

| Needs | Why | Floor |
|---|---|---|
| regex lookbehind `(?<=…)` | literals inside the bundled server / pi-ai: below this server.js does not parse | Safari 16.4 |
| `Intl.Segmenter` at module level | pi-rp TUI width, the zh word segmenter | Firefox 125 (Safari 14.1, Chrome 87) |
| `structuredClone`, `Array.prototype.at`, `Object.hasOwn` | server / pi-ai | Safari 15.4, Chrome 98 |
| module Worker, WebAssembly, Service Worker | the runtime itself, SQLite-WASM, `/api` relay | older than the rows above |
| OPFS (`createSyncAccessHandle`), Web Locks | persistence | optional: IndexedDB fallback |

No COOP / COEP is needed: nothing uses `SharedArrayBuffer` (SQLite runs in memory; persistence is our own overlay).

Not required (handled in the build / Worker):

- **RegExp `v` flag** (Safari 17, Chrome 112, Firefox 116). pi-rp's TUI width regexes
  (`vendor/pi-rp/packages/tui/src/utils.ts`: `\p{RGI_Emoji}`, `[\p{Spacing_Mark}--[…]]`) are bundled into server.js and
  pi.js; esbuild turns a `v` literal it cannot lower into `new RegExp("…", "v")`, which threw at module evaluation
  on Safari 16 — "server exited before listen(): SyntaxError: Invalid flags supplied to RegExp constructor 'v'"
  (chronicle 2026-10-06 / 10-07). `regex-v.mjs` rewrites each to an equivalent `u` regex after the build and the
  build fails if a `v` regex is left (`test/regex-v.test.mjs` scans the bundles).
- `Promise.withResolvers`, `AbortSignal.any` (Safari 17.4): filled in by `src/platform/inject-early.ts`.

esbuild `target` = `['es2022', 'safari16.4', 'chrome98', 'firefox125']` (build.mjs). Raising the floor = change
`TARGET`, `MIN_BROWSERS` (browser-support.ts) and this table together.

## How it fits together

| Piece | Where |
| --- | --- |
| Worker "machine": memfs VFS, SQLite-WASM `node:sqlite`, `node:*` registry, program runner | `src/worker.ts`, `src/platform/` |
| Programs: `server.js` (apps/server/dist) and `pi.js` (pi-rp CLI + extensions), each spawn re-evaluated with its own `process` | `build.mjs` |
| Worlds: a catalog (list / cover / world files by sha256); stubs at boot, files fetched into the VFS when a world is opened | `src/catalog.ts`, `src/worlds.ts`, host stand-in `apps/server/src/routes/browser-catalog.ts` |
| Persistence: base image from the network each boot; everything written on top (saves, sessions, `.db` files) is an overlay in OPFS (IndexedDB fallback). Incremental: the paths memfs reports on its change bus, flushed ~400 ms later with async writes; files equal to a catalog blob are stored as a sha256 reference. One tab owns it (Web Lock) | `src/platform/persist.ts` |
| No shell: every pi spawn gets `--exclude-tools bash`; `fd` / `rg` for find / grep are in-process over the VFS | `src/worker.ts`, `src/platform/native-tools.ts` |
| Page transport: `/api/…` (fetch **and** `<img>`/`<audio>` loads) → Service Worker → page → Worker; `WebSocket('/ws')` → message shim | `apps/web/public/airp-runtime-sw.js`, `apps/web/src/lib/browser-mode.ts` |
| Host routes (localhost-only): bundles, VFS image, world catalog, model proxy, net forwarding for the identity service / remote | `apps/server/src/routes/browser-runtime.ts` |

## Worlds: the catalog

The image carries no world bodies. The runtime reaches worlds through one
interface (`src/catalog.ts`), shaped on the Worldlines services so the base URL
can move without touching the runtime:

| Call | Services (`{ kind: 'services' }`) | Dev host (`{ kind: 'host' }`, default) |
| --- | --- | --- |
| `listWorlds()` | identity `GET /v1/resources?scope=public&product=livingcanvas&kind=world` (+ `scope=mine` signed in), each enriched with its `world.json` and cover refs | `/api/browser-runtime/catalog/v1/resources…` — same shape, manifest inlined in `meta.world` |
| `getWorld(id, rev)` | storage `GET /v1/objects/livingcanvas/world/<id>/download-url?revision=` → `{revision, hash, files:[{path,size,sha256,url}]}` | `/catalog/v1/objects/…/download-url` — same shape, `url` = `/catalog/blob/<sha256>` |
| `getImage(ref)` | the cover object of that revision | the same blob route |

`?catalog=services` (or localStorage `airp.browserCatalog`) switches to
`auth.worldlines.gg` + `storage.worldlines.gg`; the host stand-in lists every
template edition in `templates/` and the host's published root, hashes files
once in the background (storage §2 content hash), revision 1.

At boot every listed world gets a stub in the VFS (world.json + 0-byte cover
placeholders) so the in-tab server renders the whole shelf; its covers are
answered from the catalog. `POST /api/worlds/load` of `templates/<id>` or
`published/<id>` first fetches that world's files (8 at a time, verified,
cached by sha256 in Cache Storage — editions sharing art download it once, a
new revision fetches only changed files) and writes them over the stub, then
the server's load proceeds. No default world is opened at boot.

## Model calls

Dev host: pi-ai's `models.json` points every provider at
`<origin>/api/browser-runtime/model/<provider>/v1` with a dummy key; that route
(inside `apps/server`) holds `OPENAI_API_KEY` / `DEEPSEEK_API_KEY` and refuses
non-loopback callers.

Static site: every provider points at `VITE_AIRP_MODEL_BASE` (default
`https://ai.worldlines.gg/v1`, the Worldlines model gateway — NOT
`api.worldlines.gg`, the legacy hub). `src/platform/model-gateway.ts` wraps the
Worker's `fetch` for that base only: the signed-in account's access token
(refreshed by the in-tab server, `accountAccessToken`), `X-Worldlines-Product:
livingcanvas`, `X-Worldlines-World: <world id>` while a world is open (the
in-tab server's `__airpGatewayWorld`, `apps/server/src/gateway-world.ts`: the
bare id chronicle counts as `livingcanvas/world/<id>`, so billing counts play
from the calls it served; left out when no world is open or the id does not fit
`^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$`), and only CORS-safe headers. 401 → one refresh + retry, then the
「账号」 panel opens; 429 `quota_exceeded` → a friendly, non-retried message
(toast); other 429 / a stream cut mid-way (the gateway host ends requests at
120 s) → pi's own retry. `VITE_AIRP_MODEL_MAP` (JSON) renames model ids if the
gateway's catalog differs from what the server asks for (`deepseek-v4-flash`).

「使用本机密钥」: `src/platform/local-key.ts` wraps
the gateway fetch. For the capabilities the player moved to their own key —
`/chat/completions`, `/images/generations|edits`, `/audio/speech` (not the
studio `local-tts` model), `/audio/transcriptions` under the gateway base — it
sends the request from the tab straight to the player's provider with their key
(fresh headers, `credentials: 'omit'`, `redirect: 'error'`, body adapted per
provider) and never to `*.worldlines.gg`; everything else keeps the account
token. The page sends the routes in `init.localKey` and `{ type: 'local-key' }`
messages; the Worker keeps them in memory only (models.json keeps the
placeholder key; only a known context window is written).

## Production switches (canvas.worldlines.gg)

All Vite env, all public; unset = today's local behaviour. Layout and the
build: `deploy/canvas/` (storage-migration branch).

| switch | effect |
|---|---|
| `VITE_AIRP_RUNTIME_BASE=/runtime/<rid>/` | worker.js / server.js / pi.js / sqlite3.wasm / image.bin as static files; also marks a **static site**: no `/net` forwarder, no model proxy, play gate ON, audio static, catalog `services` |
| `VITE_AIRP_BROWSER_MODE=always` | browser mode without `?mode=browser`; the settings toggle is hidden |
| `VITE_AIRP_CATALOG` | `services` (static default) / `host` (dev default) |
| `VITE_AIRP_ID_BASE` / `VITE_AIRP_STORAGE_BASE` | default `https://auth.worldlines.gg` / `https://storage.worldlines.gg` |
| `VITE_AIRP_MODEL_BASE` | default on a static site `https://ai.worldlines.gg/v1` |
| `VITE_AIRP_AUDIO_BASE` | default on a static site `<base>/audio/`: the SW answers `/api/audio?path=x` from `<base>/audio/x` (the site must ship `assets/audio` there) |

Catalog `services`: the lobby lists storage's public
`GET /v1/public/livingcanvas/worlds` **without a token** (browsable signed out;
covers from `…/:id/cover?rev=`, cached by URL); opening a world needs an
account — the play gate opens the 「账号」 panel, then the pick continues and
the bundle comes from `download-url` with the token. The in-tab server signs
in straight at `VITE_AIRP_ID_BASE` (`AIRP_AUTH_PROVIDER=worldlines`) and the
sign-in may return to the page's own origin (`AIRP_LOGIN_ORIGIN`).
All media the page renders is same-origin (`/api/*` through the SW, bytes
fetched by the Worker with CORS), so COEP `require-corp` holds.

Simulation (no deploy): `node e2e/prod-sim.mjs` builds the web app with these
switches into `e2e/out/prod-sim-web`, serves it with COOP/COEP next to local
fakes of storage (public list, covers, download-url needing a Bearer), identity
(email code `123456`) and the model gateway (Bearer + product header → the dev
host's model proxy), and walks: lobby signed out → Start → account panel →
code → world → platform audio. `--quota` makes the gateway answer 429
`quota_exceeded`; `--turn` plays one real turn (paid; `--max-calls`, default 8,
then 429); `--serve` keeps it running at http://127.0.0.1:3199/.

## Account sign-in from the tab

The in-tab server's remote-client (「账号」→ 用账号登录, sync, publish) talks to the
hosted remote (`/auth/config`, sync API) and to the identity service
(`auth.worldlines.gg`). Neither sends CORS headers, so from a Worker the browser
blocks them. The host forwards exactly two targets at
`/api/browser-runtime/net/<auth|remote>/…` (`GET /net` lists them; anything else
is 403; `AIRP_BROWSER_NET_AUTH` / `AIRP_BROWSER_NET_REMOTE` or `AIRP_REMOTE_URL`
override them). It adds nothing — no keys, no cookies — and strips cookies,
`Origin`/`Referer`, forwarding and hop-by-hop headers both ways; redirects that
stay inside the allowlist are rewritten back onto the proxy. In the Worker a
`fetch` wrapper (`src/platform/net.ts`) rewrites only URLs under those two bases;
the server code is unchanged. A remote address edited under 「高级」 to something
else is not forwarded (and so fails from the tab). Like `/model`, this route is a
local stand-in: a public deployment needs the identity service and remote to
send CORS headers for the page's origin, or a hosted equivalent.

- **Email code**: start and verify are plain POSTs through the proxy.
- **Google (PKCE)**: the callback `…/api/remote/login/callback/<state>` opens as a
  navigation in a new tab, which has no runtime of its own. The Service Worker
  offers that one path to every open window; only the tab whose in-Worker server
  started the sign-in knows the state (the others answer "expired" without side
  effects), exchanges the code through the proxy and saves the session.
- **Trade-off**: the session (access + refresh token) is written to the VFS at
  `/home/web/.config/airp/remote.json` and therefore persisted in this origin's
  OPFS (IndexedDB fallback) — readable by any script on the origin, unlike the
  native server's file outside every world root. Clearing site data signs out. A
  second tab runs volatile (no store lock), so a sign-in made there is lost on close.

## Known gaps

- The `services` catalog is written against the identity / storage specs but not run against them yet (storage is not deployed); both send no CORS headers today, so from a Worker they need CORS for the page origin or the host `/net` forwarder.
- Opening a world spends ~250 ms of Worker CPU in the server's own layer scan (YAML front matter of every layer README); /api and socket frames wait behind it.
- Tools that need a real browser or binaries (`screenshot_canvas`, TTS/STT relays, ffmpeg) fail cleanly.
- One Service Worker per origin scope: merging with another root-scoped SW (e.g. a media cache SW) needs one file that does both.
- `server.js` and `pi.js` share most of their modules; they are not deduplicated (each spawn must re-evaluate its own module state, and the server entry uses top-level await, so esbuild's lazy `require` wrappers cannot split them). Bundles are minified by default, and pi.js is warmed with one `pi --version` run ~1.5 s after boot, so the first agent spawn costs ~35 ms instead of ~155 ms.
