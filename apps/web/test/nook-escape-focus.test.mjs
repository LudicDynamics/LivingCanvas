import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFile } from 'node:fs/promises';

const app = await readFile(new URL('../src/App.tsx', import.meta.url), 'utf8');
const nook = await readFile(new URL('../src/components/nook/NookView.tsx', import.meta.url), 'utf8');
// Structural counts must ignore prose: the header comment says "the layer
// `<Canvas>`" in backticks, which is not a rendered element.
const nookCode = nook.replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, '');

let focus = null;
try {
  const { createJiti } = await import('../../../vendor/pi-rp/node_modules/jiti/lib/jiti.mjs');
  const jiti = createJiti(import.meta.url, { moduleCache: false, tryNative: true });
  focus = await jiti.import('../src/lib/focus-coordinator.ts');
} catch (err) {
  console.error('jiti/bootstrap unavailable, skipping focus/overlay tests:', err?.message ?? err);
}
const skip = focus ? false : 'jiti or pi-rp submodule unavailable';

/**
 * the design notes §「dialogue 内 Escape 归属」: App owns ONE Escape router and the
 * `FocusSurface` lease is how a dialog joins it. App passes the coordinator to
 * the layer `<Canvas>`; the nook reuses that same `<Canvas>`, so it MUST forward
 * the SAME coordinator too.
 *
 * The regression this defends: NookView rendered two `<Canvas>` instances and
 * forwarded none, so every reading dialog inside the nook skipped its
 * `registerSurface` lease (the dialogs guard on `if (!focus) return`).
 * `closeTopmostSurface()` then found no surface, fell through to `peek()` —
 * which is the `nook` owner — and the FIRST Escape tore down the whole nook
 * instead of just the dialog. Cards in the nook were unreadable-by-Escape.
 */
test('NookView forwards the host focus coordinator to every Canvas it renders', () => {
  const canvases = (nookCode.match(/<Canvas\b/g) ?? []).length;
  const forwarded = (nookCode.match(/focus=\{focus\}/g) ?? []).length;
  assert.ok(canvases > 0, 'NookView is expected to render the shared Canvas');
  // Equality, not `>= 1`: a NEW Canvas added without `focus` must fail here.
  assert.equal(forwarded, canvases, 'every nook Canvas must receive the focus coordinator');

  // The value must be the HOST's coordinator, not a locally created one: a
  // second coordinator would keep its own surface table and the router in App
  // would never see the dialog's lease.
  assert.match(nook, /focus: FocusCoordinator;/);
  assert.doesNotMatch(nook, /createFocusCoordinator\s*\(/);
});

test('App wires the focus coordinator into the nook projection', () => {
  // Slice the NookView element itself — from its tag to its OWN `/>` — then look
  // inside. A `[\s\S]*?` straight to `focus={focusCoordinator}` would run past
  // this element into the layer `<Canvas>` and pass even after the prop here was
  // deleted (observed). `[^>]*` is wrong too: the props contain `=>` arrows.
  const element = app.match(/<NookView\b[\s\S]*?\/>/)?.[0] ?? '';
  assert.ok(element, 'NookView element not found in App.tsx');
  assert.match(element, /\bfocus=\{focusCoordinator\}/);
});

/**
 * The behavioral half: with `nook` on the owner stack (App does
 * `syncFocus('nook', nookChar !== null)`), a dialog registered as a surface must
 * win the first Escape. This is the semantics the wiring above buys — one Escape
 * closes the dialog, the nook survives, a second Escape leaves the nook.
 */
test('an Escape closes a registered dialog surface before the nook owner', { skip }, () => {
  const coordinator = focus.createFocusCoordinator();
  const nookToken = coordinator.acquire('nook');
  const lease = coordinator.registerSurface({
    key: 'html:characters/elias/page.html',
    owner: 'workspace',
    priority: 340,
    root: null,
    close: () => {},
  });

  // First Escape: the dialog surface closes; the nook owner is untouched. The
  // `workspace` stack entry LINGERS until the dialog actually unmounts — that
  // window is why App consumes a second Escape without falling through
  // (App.tsx "A closing surface retains its owner until its commit/unmount").
  const closed = coordinator.closeTopmostSurface();
  assert.equal(closed?.key, 'html:characters/elias/page.html');
  assert.equal(coordinator.peekSurface(), null, 'the closed surface must not be topmost again');
  assert.equal(coordinator.peek(), 'workspace');

  // Unmount releases the lease; only then does the nook owner become the target.
  lease.unregister();
  assert.equal(coordinator.closeTopmostSurface(), null);
  assert.equal(coordinator.peek(), 'nook');
  assert.deepEqual(coordinator.handleEscape(), { owner: 'nook', token: nookToken });
});

/**
 * Without the shared coordinator the dialogs never register, so the FIRST Escape
 * lands on the nook owner directly — the exact observed bug. Pinned so the
 * failing shape stays described, not just the fixed one.
 */
test('an unregistered dialog leaves the nook as the first Escape target', { skip }, () => {
  const coordinator = focus.createFocusCoordinator();
  coordinator.acquire('nook');
  assert.equal(coordinator.closeTopmostSurface(), null);
  assert.equal(coordinator.handleEscape()?.owner, 'nook');
});
