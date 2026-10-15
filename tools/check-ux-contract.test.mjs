import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { compare, scanRepo, scanSource, validateContract } from './check-ux-contract.mjs';

const registry = JSON.parse(fs.readFileSync(new URL('./ux-contract.json', import.meta.url), 'utf8'));
const rule = (kind, target, expect, overrides = {}) => ({
  id: `${kind}-fixture`, kind, doc: { path: 'docs/ux/00-共同上下文.md', anchor: 'fixture' }, owner: 'fixture', scope: 'fixture', target, expect, allow: [], forbid: [], reason: 'synthetic fixture', ...overrides,
});
const run = (source, r, file = r.target) => scanSource(source, { file, rules: [r] });

for (const [id, group, status] of registry.fixtures.map((f) => [f.id, f.group, f.status])) {
  test(`registered fixture ${id} (${group}/${status})`, () => assert.ok(status === 'clean' || status === 'failure'));
}

test('protected sentinel clean and missing fixtures are non-empty', () => {
  const r = rule('no-delete', 'fixture.ts', { sentinel: 'KEEP_ME' });
  assert.deepEqual(run('const KEEP_ME = true;', r), []);
  assert.equal(run('const changed = true;', r).length, 1);
});

test('unique-call excludes declaration but catches duplicate runtime calls', () => {
  const r = rule('unique-call', 'fixture.ts', { name: 'appearanceViewOf', count: 1 });
  const clean = 'export function appearanceViewOf(value) { return value; }\nconst view = appearanceViewOf(item);';
  const duplicate = `${clean}\nconst again = appearanceViewOf(item);`;
  assert.deepEqual(run(clean, r), []);
  assert.equal(run(duplicate, r).length, 1);
});

test('unique listener is event-specific and permits unrelated relays', () => {
  const r = rule('unique-listener', 'fixture.ts', { event: 'airp:character-frame', count: 1, mode: 'event-listener' });
  const clean = "window.addEventListener('airp:character-frame', route); window.dispatchEvent(new CustomEvent('airp:agent-frame'));";
  assert.deepEqual(run(clean, r), []);
  assert.equal(run(`${clean}; window.addEventListener('airp:character-frame', other);`, r).length, 1);
});

test('ghost producers and CSS guard have clean and pointer override fixtures', () => {
  const producer = rule('required-source', 'fixture.tsx', { literals: ['className="object--ghost"', 'aria-hidden'] }, { forbid: ["pointerEvents: 'auto'"] });
  assert.deepEqual(run('<div className="object--ghost" aria-hidden />', producer), []);
  assert.equal(run('<div className="object--ghost" aria-hidden style={{ pointerEvents: \'auto\' }} />', producer).length, 1);
  const css = rule('css-declaration', 'fixture.css', { selector: '.object--ghost', property: 'pointer-events', value: 'none' });
  assert.deepEqual(run('.object--ghost { pointer-events: none; }', css), []);
  assert.equal(run('.object--ghost { pointer-events: none; }\n.object--ghost:hover { pointer-events: auto; }', css).length, 1);
});

test('projection checks explicit mutually-exclusive branches, not Canvas count', () => {
  const r = rule('projection', 'fixture.tsx', { ownerLiteral: 'App', routeLiteral: 'nookChar', markerLiteral: 'prototype-nook', branches: ['!nookChar &&', 'nookChar &&'] });
  const clean = 'function App() { return <div className="prototype-nook"><>{!nookChar && <Canvas />}</>{nookChar && <NookView />}</div>; }';
  assert.deepEqual(run(clean, r), []);
  assert.ok(run('function App() { return <><Canvas /><Canvas />{nookChar && <NookView />}</>; }', r).length > 0);
});

test('depth registration accepts semantic tokens and rejects numeric declarations', () => {
  const r = rule('depth', 'fixture.css', { registration: 'owner/context/doc-anchor only; numeric bands remain in Depth document' });
  assert.deepEqual(run('.stage { z-index: var(--ux-depth-stage); }', r), []);
  assert.equal(run('.stage { z-index: 42; }', r).length, 1);
});

test('forbidden character bypass catches both generic and typed raw listeners', () => {
  const r = rule('forbidden-source', 'CharacterModal.tsx', { literals: ['airp:agent-frame', 'airp:character-frame'] });
  assert.deepEqual(run('function CharacterModal() { return null; }', r), []);
  assert.equal(run("window.addEventListener('airp:agent-frame', receive);", r).length, 1);
  assert.equal(run("window.addEventListener('airp:character-frame', receive);", r).length, 1);
});
test('visual literal gate has clean and non-empty failure fixtures', () => {
  const r = rule('visual-literal', 'fixture.css', {
    canonicalTokenFile: 'tokens.css',
    tokenPrefix: '--ux-',
    appearancePrefix: '--appearance-',
    legacyAliases: ['--canvas-bg'],
    literalKinds: ['color', 'gradient', 'shadow', 'radius', 'font', 'motion'],
    exceptionRegistry: 'visualExceptions',
  });
  assert.deepEqual(run('.button { color: var(--ux-color-ink); }', r), []);
  const findings = run('.button { color: #123456; }', r);
  assert.equal(findings.length, 1);
  assert.equal(findings[0].line, 1);
  assert.match(findings[0].message, /unregistered color literal/);
});

test('visual exception requires exact selector, property, literal, and expiry', () => {
  const r = rule('visual-literal', 'fixture.css', {
    canonicalTokenFile: 'tokens.css',
    tokenPrefix: '--ux-',
    appearancePrefix: '--appearance-',
    legacyAliases: [],
    literalKinds: ['color'],
    exceptionRegistry: 'visualExceptions',
  });
  const contract = {
    schemaVersion: 1,
    docs: [{ path: 'docs.md', anchor: 'x' }],
    protectedPaths: [],
    visualExceptions: [{
      id: 'fixture.paint',
      target: 'fixture.css',
      selectorOrSymbol: '.prop',
      kind: 'illustration',
      literals: ['#123456'],
      properties: ['background'],
      owner: 'fixture',
      reason: 'bounded paint',
      expiresAfter: '2099-12-31',
    }],
    visual: [r],
    depth: [],
    projection: [],
    fixtures: [],
  };
  assert.deepEqual(compare({ sources: new Map([['fixture.css', '.prop { background: #123456; }']]) }, contract), []);
  const expired = { ...contract, visualExceptions: [{ ...contract.visualExceptions[0], expiresAfter: '2020-01-01' }] };
  assert.ok(validateContract(expired).length > 0);
});

test('compare scans source maps and returns findings without side effects', () => {
  const contract = { schemaVersion: 1, docs: [{ path: 'docs.md', anchor: 'x' }], protectedPaths: [], visualExceptions: [], visual: [rule('unique-call', 'fixture.ts', { name: 'adapt', count: 1 })], depth: [], projection: [], fixtures: [] };
  assert.deepEqual(compare({ sources: new Map([['fixture.ts', 'adapt(); adapt();']]) }, contract).map((f) => f.check), ['unique-call']);
});

test('closed schema rejects malformed JSON shapes, unknown keys/kinds, and unsafe paths', () => {
  const base = { schemaVersion: 1, docs: [{ path: 'docs.md', anchor: 'x' }], protectedPaths: [], visualExceptions: [], visual: [], depth: [], projection: [], fixtures: [] };
  assert.equal(validateContract({ ...base, typo: true }).length, 1);
  assert.equal(validateContract({ ...base, visual: [rule('mystery', 'fixture.ts', {})] }).some((f) => f.message.includes('unknown kind')), true);
  assert.equal(validateContract({ ...base, visual: [rule('exists', '../escape.ts', { sentinel: 'x' })] }).some((f) => f.message.includes('path')), true);
  assert.equal(scanSource('x', { file: 'fixture.ts', rules: [rule('mystery', 'fixture.ts', {})] })[0].check, 'contract-schema');
  assert.equal(validateContract({ ...base, visual: [rule('exists', 'fixture.ts', { sentinel: 'x', typo: true })] }).some((f) => f.message.includes('unknown key')), true);
  assert.equal(compare({}, null)[0].check, 'contract-schema');
});

test('scanRepo fails closed when requested baseline is unavailable', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ux-contract-'));
  fs.writeFileSync(path.join(root, 'fixture.ts'), 'KEEP_ME');
  const contract = { schemaVersion: 1, docs: [{ path: 'docs.md', anchor: 'x' }], protectedPaths: [{ path: 'fixture.ts', sentinel: 'KEEP_ME' }], visualExceptions: [], visual: [rule('no-delete', 'fixture.ts', { sentinel: 'KEEP_ME' })], depth: [], projection: [], fixtures: [] };
  const result = scanRepo({ repoRoot: root, baseRef: 'definitely-not-a-commit', contract });
  assert.ok(result.findings.some((f) => f.message.includes('baseline')));
  fs.rmSync(root, { recursive: true, force: true });
});

test('CLI supports JSON and text reports and stays clean after P0 seams land', () => {
  const json = spawnSync(process.execPath, ['tools/check-ux-contract.mjs', '--json'], { encoding: 'utf8' });
  assert.equal(json.status, 0);
  const parsed = JSON.parse(json.stdout);
  assert.deepEqual(parsed.findings, []);
  const text = spawnSync(process.execPath, ['tools/check-ux-contract.mjs'], { encoding: 'utf8' });
  assert.equal(text.status, 0);
  assert.match(text.stdout, /check-ux-contract: clean/);
});

test('per-character call gates fail both ways (missing seam and global gate)', () => {
  const nook = rule('required-source', 'NookView.tsx', { literals: ['call.characterId === characterId'] }, { forbid: ['void stopCall();'] });
  assert.deepEqual(run('<div>{call.characterId === characterId && <button />}</div>', nook), []);
  // Missing ownership judgement: the gate cannot see who the call belongs to.
  const missing = run('<div><button /></div>', nook);
  assert.ok(missing.some((f) => f.message.includes('required source literal')));
  // An unowned hang-up is the forbidden parallel path even when the seam is present.
  const unowned = run('<div>{call.characterId === characterId && <button />}</div>; } else void stopCall();', nook);
  assert.ok(unowned.some((f) => f.message.includes('forbidden source literal')));
  const modal = rule('required-source', 'CharacterModal.tsx', { literals: ['disabled={callActive && call.characterId === characterId}'] }, { forbid: ['disabled={callActive}'] });
  assert.deepEqual(run('<button disabled={callActive && call.characterId === characterId} />', modal), []);
  assert.ok(run('<button disabled={callActive} />', modal).length > 0);
});

test('css-declaration matches the canonical value as a substring, including !important', () => {
  const r = rule('css-declaration', 'fixture.css', { selector: '.is-immersive .prototype-chrome', property: 'opacity', value: '0 !important' });
  assert.deepEqual(run('.is-immersive .prototype-chrome { opacity: 0 !important; }', r), []);
  // Control: a plain `opacity: 0` is NOT the frozen declaration.
  assert.ok(run('.is-immersive .prototype-chrome { opacity: 0; }', r).length > 0);
});
