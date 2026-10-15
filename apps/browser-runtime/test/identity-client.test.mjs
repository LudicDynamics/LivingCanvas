// The in-tab server must carry the Worldlines identity client. When it was loaded
// from a URL computed at run time (canvas-20261007-0455..), esbuild could not
// bundle it, the Worker's import failed, and a signed-in player's tab answered
// 401 to worlds/load and every model call once the first access token expired.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, '../../..');
const SYNC = path.join(REPO, 'apps/server/src/sync');

test('the server imports the identity client statically (a literal specifier esbuild bundles)', () => {
  const users = fs.readdirSync(SYNC).filter((f) => f.endsWith('.ts'))
    .map((f) => [f, fs.readFileSync(path.join(SYNC, f), 'utf8')])
    .filter(([, s]) => s.includes('worldlines-identity-client'));
  assert.ok(users.length > 0, 'no server module imports the identity client');
  for (const [f, s] of users) {
    assert.match(s, /^import \* as identity from '\.\.\/\.\.\/\.\.\/\.\.\/vendor\/worldlines-identity-client\/index\.mjs';$/m, `${f}: static import expected`);
    assert.doesNotMatch(s, /new URL\([^)]*worldlines-identity-client/, `${f}: a computed URL is not bundled into server.js`);
  }
  assert.ok(fs.existsSync(path.join(REPO, 'vendor/worldlines-identity-client/index.mjs')));
});

test('a built server.js contains the identity client', { skip: !fs.existsSync(path.join(HERE, '../dist/server.js')) ? 'no dist/server.js' : false }, () => {
  const code = fs.readFileSync(path.join(HERE, '../dist/server.js'), 'utf8');
  assert.doesNotMatch(code, /(?:__airpImport|import)\(CLIENT_URL\)/, 'run `node build.mjs server`: this server.js imports the client at run time');
  assert.match(code, /function refreshTokens\(/);
  assert.match(code, /var IdentityError\s*=\s*class/);
});
