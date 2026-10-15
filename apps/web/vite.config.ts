import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { fileURLToPath } from 'node:url';
import { buildInfo, loadDeployMode, modeLabel, viteEnvOf } from '@airp/shared/deploy-mode/node';
import { injectBootScreens } from './src/lib/boot-copy';

// The build mode (packages/shared/src/deploy-mode): config/.env.<AIRP_DEPLOY>, handed to the app as VITE_*
// (lib/build-mode.ts). Local development falls back to `local`; deploy/canvas/build-browser.sh always says
// AIRP_DEPLOY=remote. Throws (the build fails) on a missing or half-set mode.
const REPO_ROOT = fileURLToPath(new URL('../..', import.meta.url));
const MODE = loadDeployMode({ repoRoot: REPO_ROOT, env: process.env, fallback: 'local' });
const BUILD = buildInfo(REPO_ROOT);
for (const [k, v] of Object.entries(viteEnvOf(MODE, BUILD))) if (!process.env[k]) process.env[k] = v;
console.log(`[vite] mode: ${modeLabel(MODE, BUILD)}`);

export default defineConfig({
  // A deploy under a URL prefix sets e.g. AIRP_WEB_BASE=/airp-infini-canvas/;
  // src/lib/base-path.ts then prefixes the app's /api and /ws URLs.
  base: process.env.AIRP_WEB_BASE ?? '/',
  plugins: [react(), {
    // index.html's first-paint boot screen (static site): every language's markup from src/lib/boot-copy.ts, so the
    // page shows it in the visitor's language before the bundle runs.
    name: 'airp-boot-screens',
    transformIndexHtml: (html: string) => injectBootScreens(html),
  }],
  server: {
    host: true,
    port: 5173,
    proxy: {
      '/api': 'http://localhost:3001',
      // Covers `/ws`, `/ws/stt` and `/ws/voice-live` alike: the key is a prefix
      // match, so the voice-live call reaches the canvas server's reverse proxy
      // with no extra dev setup.
      '/ws': {
        target: 'ws://localhost:3001',
        ws: true
      }
    }
  }
});
