// the design notes (M11) — the belongings rail's `.html` behaviour.
//
// The repository has no jsdom (apps/web/test/character-rail.test.mjs:8-10), so
// interactive assertions degrade to SOURCE CONTRACTS, the same technique as
// tools/bag-item.test.mjs. Every slice/offset assertion below pins its anchors
// first: an unguarded `indexOf(a) < indexOf(b)` is TRUE whenever BOTH are
// missing (-1 < -1 is false, but -1 < +N passes), which would turn a moved
// anchor into a silently green test.
// Run: node --test apps/web/test/html-bag.test.mjs
import assert from 'node:assert/strict';
import { test } from 'node:test';
import fs from 'node:fs/promises';

test('a carried .html opens the second layer instead of the markdown reader', async () => {
  const app = await fs.readFile('apps/web/src/App.tsx', 'utf8');
  // The bag branch must key off the FROZEN virtual-frontmatter marker (§5.1) —
  // `isHtmlPath` is unreachable from the web bundle (the shared barrel pulls
  // `node:crypto`; lib/airp-gateway.ts:8-10).
  assert.match(app, /selectedBagItem\.frontmatter\?\.type === 'html'/);
  assert.match(app, /<HtmlDetailDialog/);
  assert.match(app, /from '\.\/components\/html\/HtmlDetailDialog\.js'/);
  // The markdown reader is still the fallback — not replaced.
  assert.match(app, /<BagItemDialog/);
  // Named export, matching the photo family precedent — never a default export.
  assert.doesNotMatch(app, /import HtmlDetailDialog from/);
});

test('the bag list item never mounts an iframe (contract §6.1: list only)', async () => {
  const app = await fs.readFile('apps/web/src/App.tsx', 'utf8');
  const a = app.indexOf('prototype-bag-content');
  const b = app.indexOf('prototype-player-orb');
  assert.ok(a !== -1 && b !== -1 && a < b, 'bag markers moved — fix the slice bounds');
  const list = app.slice(a, b);
  assert.doesNotMatch(list, /<iframe/, 'the belongings rail is a permanent surface');
  assert.doesNotMatch(list, /HtmlMedia/, 'no card previews in the bag');
});

test('the bag list item strips .html as well as .md from the fallback label', async () => {
  const app = await fs.readFile('apps/web/src/App.tsx', 'utf8');
  // Two call sites, ONE helper — a second inline `.md`-only strip is the bug.
  // Plain substring, not a regex: the assertion is about the character class,
  // and a doubly-escaped regex literal here is its own source of typos.
  assert.ok(app.includes('(?:md|html)$/i'), 'the extension strip must cover .html');
  assert.equal((app.match(/labelOf\(stripExt\(item\.filename\)\)/g) ?? []).length, 2);
  // The helper is module-level (next to `labelOf`), not an inline lambda: a
  // lambda would let the two sites drift apart again.
  assert.match(app, /function stripExt\(name: string\): string \{/);
});

test('ItemArtwork gives html a window glyph, not the shipping-parcel fallback', async () => {
  const src = await fs.readFile('apps/web/src/components/ItemArtwork.tsx', 'utf8');
  assert.match(src, /import \{[^}]*\bAppWindow\b[^}]*\} from 'lucide-react'/);
  // The branch must sit in the ternary CHAIN, ahead of the fallthrough. Assert
  // on the chain expression, not on file offsets: `AppWindow` appears in the
  // import statement (line 2), so `indexOf('AppWindow') < indexOf('Mail')`
  // would pass even with the branch missing — a test that cannot fail.
  const chainStart = src.indexOf('const Icon =');
  const chainEnd = src.indexOf('return <span');
  assert.ok(chainStart !== -1 && chainEnd !== -1 && chainStart < chainEnd, 'icon chain moved');
  const chain = src.slice(chainStart, chainEnd);
  assert.match(chain, /fm\.type === 'html'/, 'html must be matched by type');
  // The filename fallback MUST call the shared judgement, not a local regex
  // (contract §6.6: consumers MUST NOT each write their own `/\.html$/i`);
  // `@airp/shared/html-head` is the web-safe subpath (zero imports).
  assert.match(chain, /isHtmlPath\(item\.filename\)/, 'filename fallback for null frontmatter');
  assert.doesNotMatch(src, /\/\\\.html\$\/i/, 'no second extension judgement in the web bundle');
  assert.match(src, /from '@airp\/shared\/html-head'/, 'imports the shared judgement by subpath');
  const i = chain.indexOf("fm.type === 'html'");
  const j = chain.indexOf('/letter|envelope|mail/');
  assert.ok(i !== -1 && j !== -1 && i < j, 'the html branch must precede the icon chain');
  // Guards the fallthrough: html must not resolve to the parcel `Package`.
  // Anchored on the LAST occurrence — `Package` is both the import name and the
  // fallthrough arm, so a bare `indexOf('Package')` would pass on the import
  // even if the arm were deleted (the same false-green shape as above).
  const pkg = chain.lastIndexOf('Package');
  assert.ok(pkg !== -1 && pkg > i, 'Package stays the last resort');
});
