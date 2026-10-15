// Safari / WebKit (iPhone, 2026-10-04): the in-tab server died at startup because
// depd (express / body-parser) reads call sites through V8's Error.prepareStackTrace
// CallSite API, which WebKit lacks — lobby empty, every /api/* 500. And WebKit's
// Error.stack has no "Name: message" line, so the worker's log showed only frames.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { test } from 'node:test';

const read = (p) => fs.readFile(new URL(p, import.meta.url), 'utf8');

test('depd is replaced by a no-op in every bundled program', async () => {
  const build = await read('../build.mjs');
  assert.match(build, /b\.onResolve\(\{ filter: \/\^depd\$\/ \}/);
  assert.match(build, /plugins: \[programPlugin, stubPlugin, depdPlugin\]/);
  assert.match(build, /deprecate\.function = \(fn\) => fn; deprecate\.property = \(\) => \{\}/);
});

test('worker errors keep the message on engines whose stack omits it', async () => {
  const worker = await read('../src/worker.ts');
  assert.ok(!/String\(e\?\.stack \?\? e\)/.test(worker) && !/\$\{e\?\.stack \?\? e\}/.test(worker), 'no stack-only error text');
  assert.match(worker, /function errorText\(e: any\): string \{[\s\S]*?stack\.startsWith\(head\) \? stack : `\$\{head\}/);
});
