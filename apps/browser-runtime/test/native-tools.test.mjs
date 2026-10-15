// fd / rg stand-ins over the VFS, with the exact argument shapes pi-rp's
// find.ts / grep.ts pass.
import test from 'node:test';
import assert from 'node:assert/strict';
import * as esbuild from 'esbuild';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import fs from 'node:fs';
import os from 'node:os';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const r = await esbuild.build({
  stdin: { contents: `export * from './src/platform/native-tools.ts'; export * from './src/platform/native-zip.ts'; export { writeTree } from './src/platform/fs.ts';`, resolveDir: path.join(HERE, '..'), loader: 'ts' },
  bundle: true, format: 'esm', platform: 'node', write: false, logLevel: 'error',
});
const tmp = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'airp-nt-')), 'nt.mjs');
fs.writeFileSync(tmp, `import { createRequire as __airpCreateRequire } from 'node:module'; const require = __airpCreateRequire(import.meta.url);\n${r.outputFiles[0].text}`);
const m = await import(pathToFileURL(tmp).href);
m.writeTree({
  '/w/a.md': 'alpha\nBeta line\n', '/w/sub/b.md': 'gamma beta\n', '/w/sub/c.json': '{"beta":1}', '/w/.hidden/d.md': 'beta', '/w/node_modules/x.md': 'beta',
});
const run = (tool, args, cwd = '/') => { let out = '', err = ''; const code = m[tool]({ args, cwd, out: (s) => { out += s; }, err: (s) => { err += s; } }); return { code, out: out.trim().split('\n').filter(Boolean).sort(), err }; };

test('glob translation', () => {
  assert.ok(m.globToRegExp('**/*.md').test('x/y/z.md'));
  assert.ok(m.globToRegExp('**/*.md').test('z.md'));
  assert.ok(!m.globToRegExp('*.md').test('x/z.md'));
  assert.ok(m.globToRegExp('*.{md,json}').test('c.json'));
});

test('fd: basename glob, full-path glob, hidden, max-results', () => {
  assert.deepEqual(run('runFd', ['--glob', '--color=never', '--hidden', '--no-require-git', '--max-results', '100', '--', '*.md', '/w']).out, ['/w/.hidden/d.md', '/w/a.md', '/w/sub/b.md']);
  assert.deepEqual(run('runFd', ['--glob', '--full-path', '--', '**/sub/*.json', '/w']).out, ['/w/sub/c.json']);
  assert.equal(run('runFd', ['--glob', '--max-results', '1', '--', '*', '/w']).out.length, 1);
  assert.equal(run('runFd', ['--', '*', '/missing']).code, 1);
});

test('rg --json: matches, ignore-case, glob, no-match exit 1', () => {
  const r1 = run('runRg', ['--json', '--line-number', '--color=never', '--hidden', '--ignore-case', '--', 'beta', '/w']);
  assert.equal(r1.code, 0);
  const hits = r1.out.map((l) => JSON.parse(l)).map((e) => `${e.data.path.text}:${e.data.line_number}`).sort();
  assert.deepEqual(hits, ['/w/.hidden/d.md:1', '/w/a.md:2', '/w/sub/b.md:1', '/w/sub/c.json:1']);
  assert.equal(run('runRg', ['--json', '--glob', '*.json', '--', 'beta', '/w']).out.length, 1);
  assert.equal(run('runRg', ['--json', '--', 'zzz', '/w']).code, 1);
});

test('zip / unzip: the snapshot + rollback forms from packages/shared actions/world.ts', () => {
  m.writeTree({ '/snap/world/README.md': 'hello', '/snap/player/a.md': 'a', '/snap/.airpworld/snapshots/old.zip': 'x', '/snap/.airpworld/assets/p.webp': 'img' });
  assert.equal(run('runZip', ['-r', '-q', '/snap/.airpworld/snapshots/s1.zip', '.', '-x', '.airpworld/snapshots/*'], '/snap').code, 0);
  const listed = run('runUnzip', ['-Z1', '/snap/.airpworld/snapshots/s1.zip'], '/snap').out;
  assert.ok(listed.includes('world/README.md') && listed.includes('.airpworld/assets/p.webp'));
  assert.ok(!listed.some((l) => l.startsWith('.airpworld/snapshots/')), 'the snapshot store is excluded');
  m.writeTree({ '/snap/world/README.md': 'clobbered' });
  assert.equal(run('runUnzip', ['-o', '-q', '/snap/.airpworld/snapshots/s1.zip', 'world/README.md', '-d', '/snap'], '/snap').code, 0);
  const got = run('runRg', ['--json', '--', 'hello', '/snap/world']).out;
  assert.equal(got.length, 1);
  assert.equal(run('runUnzip', ['-Z1', '/snap/missing.zip'], '/snap').code, 9);
});
