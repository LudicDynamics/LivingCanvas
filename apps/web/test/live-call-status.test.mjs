// The in-call state line (LiveCallStatus): listening / thinking / speaking, the
// one-turn notice, the minutes left, and the upgrade link on a refusal
// (voice-live audit #3 #7). Props-driven, so a static render is the test.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createRequire } from 'node:module';

const here = path.dirname(fileURLToPath(import.meta.url));
const webRoot = path.resolve(here, '..');
const repoRoot = path.resolve(webRoot, '../..');
const require = createRequire(pathToFileURL(path.join(webRoot, 'test/x.mjs')));
const esbuild = require(path.join(repoRoot, 'node_modules/.pnpm/esbuild@0.25.12/node_modules/esbuild/lib/main.js'));
const React = await import('react');
const { renderToStaticMarkup } = await import('react-dom/server');

const out = await esbuild.build({
  stdin: {
    contents: "export { LiveCallStatus } from './src/components/live/LiveCallStatus.tsx'; ",
    resolveDir: webRoot,
    loader: 'ts',
  },
  bundle: true,
  write: false,
  format: 'esm',
  jsx: 'automatic',
  external: ['react', 'react/jsx-runtime'],
  loader: { '.css': 'empty' },
  platform: 'node',
  absWorkingDir: webRoot,
});
const cacheDir = path.join(webRoot, 'node_modules/.cache');
fs.mkdirSync(cacheDir, { recursive: true });
const dir = fs.mkdtempSync(path.join(cacheDir, 'airp-call-status-'));
const file = path.join(dir, 'LiveCallStatus.mjs');
fs.writeFileSync(file, out.outputFiles[0].text, 'utf-8');
const { LiveCallStatus } = await import(pathToFileURL(file).href);
fs.rmSync(dir, { recursive: true, force: true });

const NOW = 1_000_000;
const render = (call) => renderToStaticMarkup(React.createElement(LiveCallStatus, { call, now: () => NOW }));

test('thinking reads as thinking; listening and speaking too', () => {
  assert.match(render({ phase: 'live', bot: 'thinking' }), /live-call-status__bot--thinking[^>]*>.*Thinking/);
  assert.match(render({ phase: 'live', bot: 'listening' }), />Listening</);
  assert.match(render({ phase: 'live', bot: 'speaking' }), />Speaking</);
  // A static render is always English (useLocale's server snapshot); the
  // Chinese labels are the messages.json entries the team asked for.
  const messages = JSON.parse(fs.readFileSync(path.join(webRoot, 'src/lib/messages.json'), 'utf8'));
  assert.equal(messages.Thinking['zh-CN'], '在想');
  assert.equal(messages.Listening['zh-CN'], '在听');
});

test('what voice-live heard is on the line until she thinks; GPT Live (no bot state) gets no badge', () => {
  assert.match(render({ phase: 'live', bot: 'listening', heard: '你是谁？' }), /live-call-status__bot--heard[^>]*>.*Heard “你是谁？”/);
  assert.match(render({ phase: 'live', bot: 'thinking', heard: '你是谁？' }), /live-call-status__bot--thinking[^>]*>.*Thinking/);
  assert.doesNotMatch(render({ phase: 'live' }), /live-call-status__bot/);
});

test('the one-turn notice is shown as a status, not an alert', () => {
  const html = render({ phase: 'live', bot: 'listening', notice: 'Say it again.' });
  assert.match(html, /role="status"[^>]*>Say it again\.</);
  assert.doesNotMatch(html, /role="alert"/);
});

test('minutes left, and a warning under two minutes; nothing when unlimited', () => {
  assert.match(render({ phase: 'live', endsAt: NOW + 10 * 60_000 }), /10 min left this month/);
  const low = render({ phase: 'live', endsAt: NOW + 90_000 });
  assert.match(low, /live-call-status__minutes--low[^>]*>Less than 2 minutes left/);
  assert.doesNotMatch(render({ phase: 'live', endsAt: null }), /min left/);
});

test('a refusal with a billing link offers it; without one, nothing renders', () => {
  const html = render({ phase: 'error', billingUrl: 'https://worldlines.gg/billing' });
  assert.match(html, /href="https:\/\/worldlines\.gg\/billing"[^>]*>Get more minutes</);
  assert.match(html, /rel="noopener noreferrer"/);
  assert.equal(render({ phase: 'error' }), '');
  assert.equal(render({ phase: 'idle' }), '');
});
