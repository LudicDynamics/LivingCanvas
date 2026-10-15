// A server program that dies before listen() must fail the boot with why, never answer 'ready' (2026-10-06: every
// /api request and /ws open then failed with "server has not called listen()", ×18 in one session).
import test from 'node:test';
import assert from 'node:assert/strict';
import * as esbuild from 'esbuild';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import fs from 'node:fs';
import os from 'node:os';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const r = await esbuild.build({ entryPoints: [path.join(HERE, '../src/server-start.ts')], bundle: true, format: 'esm', platform: 'node', write: false, logLevel: 'error' });
const tmp = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'airp-start-')), 's.mjs');
fs.writeFileSync(tmp, r.outputFiles[0].text);
const { serverStartFailure } = await import(pathToFileURL(tmp).href);

test('listening server = started', () => {
  assert.equal(serverStartFailure({}, null), null);
  assert.equal(serverStartFailure({}, 'process.exit(0)'), null, 'listened, then exited: not a boot failure here');
});

test('no server = boot error carrying the reason', () => {
  assert.equal(serverStartFailure(null, 'TypeError: x is not a function\n    at server.js:1:2'), 'server exited before listen(): TypeError: x is not a function\n    at server.js:1:2');
  assert.equal(serverStartFailure(undefined, 'process.exit(1)'), 'server exited before listen(): process.exit(1)');
  assert.match(serverStartFailure(null, null), /^server exited before listen\(\) \(/);
});

test('worker.ts checks the server before posting ready, and closes sockets when there is none', () => {
  const src = fs.readFileSync(path.join(HERE, '../src/worker.ts'), 'utf8');
  assert.doesNotMatch(src, /serverStartFailure\(httpServer\(\), await/, 'httpServer() would be read before the top level ran');
  const awaited = src.indexOf('const stopped = await main;');
  const check = src.indexOf('serverStartFailure(httpServer(), stopped)');
  assert.ok(awaited > 0 && check > awaited, 'the server is looked up after its top level ran');
  const ready = src.indexOf("post({ type: 'ready'");
  assert.ok(check > 0 && ready > check, 'the check runs before ready');
  assert.match(src, /if \(!httpServer\(\)\) \{ post\(\{ type: 'ws-closed'/);
});
