// Esc closes the 「账号」 popup (smoke test 2026-10-05). App.tsx routes Escape ONCE (document capture phase,
// dispatchEscape → focusCoordinator.closeTopmostSurface()) and stops it; the popup listened on window and was not
// a surface, so the router closed whatever lay below it (or nothing) and the popup never saw the key. The popup
// is now a surface, and its nested views (large CG view, share-card dialog) are surfaces above it.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { test } from 'node:test';
import { createJiti } from '../../../vendor/pi-rp/node_modules/jiti/lib/jiti.mjs';

const read = (rel) => fs.readFileSync(new URL(rel, import.meta.url), 'utf8');
const dialog = read('../src/components/account/AccountDialog.tsx');
const layer = read('../src/components/account/account-layer.ts');
const tabs = read('../src/components/profile/ProfileTabs.tsx');
const share = read('../src/components/chrome/ShareCardDialog.tsx');
const panel = read('../src/components/chrome/AccountPanel.tsx');
const app = read('../src/App.tsx');
const launcher = read('../src/components/WorldLauncher.tsx');

const jiti = createJiti(import.meta.url, { moduleCache: false, tryNative: true });
const { createFocusCoordinator } = await jiti.import('../src/lib/focus-coordinator.ts');

test('the popup registers with the focus coordinator and provides it to nested views', () => {
  assert.match(dialog, /focus\.registerSurface\(\{\s*key: 'account-dialog',[^}]*priority: ACCOUNT_DIALOG_PRIORITY,[^}]*close: \(\) => closeRef\.current\(\),/);
  assert.match(dialog, /<AccountLayerContext\.Provider value=\{focus \?\? null\}>/);
  assert.match(panel, /onClose=\{close\} focus=\{focus\}/);
  assert.match(app, /<AccountPanel focus=\{focusCoordinator\} \/>/);
  assert.match(launcher, /<AccountPanel variant="launcher" focus=\{focus\} \/>/);
  assert.match(tabs, /useAccountLayer\('cg-view'/);
  assert.match(share, /useAccountLayer\('share-card', true, props\.onClose\)/);
});

test('priorities: popup above every other surface; nested views above the popup', () => {
  const num = (name) => Number(layer.match(new RegExp(`${name} = (\\d+)`))[1]);
  const popup = num('ACCOUNT_DIALOG_PRIORITY');
  const nested = num('ACCOUNT_LAYER_PRIORITY');
  assert.ok(nested > popup);
  const src = fs.readdirSync(new URL('../src/components/', import.meta.url), { recursive: true })
    .filter((f) => f.endsWith('.tsx')).map((f) => read(`../src/components/${f}`)).join('\n') + app;
  const others = [...src.matchAll(/priority: (\d+)/g)].map((m) => Number(m[1]));
  assert.ok(others.length > 5);
  for (const p of others) assert.ok(p < popup, `surface priority ${p} must stay below the account popup (${popup})`);
});

test('Esc order through the router: nested view, then the popup, then what lay below', () => {
  const focus = createFocusCoordinator();
  const closed = [];
  const launcherLease = focus.registerSurface({ key: 'world-launcher', owner: 'workspace', priority: 400, root: null, close: () => closed.push('launcher') });
  const popup = focus.registerSurface({ key: 'account-dialog', owner: 'workspace', priority: 530, root: null, close: () => closed.push('popup') });
  const cg = focus.registerSurface({ key: 'account-layer:cg-view', owner: 'workspace', priority: 540, root: null, close: () => closed.push('cg-view') });
  assert.equal(focus.closeTopmostSurface().key, 'account-layer:cg-view');
  cg.unregister();
  assert.equal(focus.closeTopmostSurface().key, 'account-dialog');
  popup.unregister();
  assert.deepEqual(closed, ['cg-view', 'popup'], 'the lobby stays open');
  assert.equal(focus.peekSurface().key, 'world-launcher');
  launcherLease.unregister();
});
