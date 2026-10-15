/**
 * tools/check-request-bodies.test.mjs — non-emptiness proof for the HTTP
 * request-body gate.
 *
 * The gate's whole job is to fail when a frontend body key drifts from the
 * frozen contract. A gate that can never go red is worthless, so each case here
 * drives the PURE `compare()` with synthetic input: aligned input is clean, and
 * the exact historical defect (`{filePath,rollType,expect}` vs `['path']`) must
 * be reported. `bodyKeysFor` also gets a case so the extractor is pinned too.
 *
 * Run:  node --test tools/check-request-bodies.test.mjs
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';

import { bodyKeysFor, compare } from './check-request-bodies.mjs';

const bodies = [{ route: '/api/dice', file: 'DiceRoller.tsx', keys: ['path'], doc: 'x' }];

test('aligned body keys produce no findings (the gate can go green)', () => {
  const found = new Map([['/api/dice', { keys: ['path'], line: 151 }]]);
  assert.deepEqual(compare({ bodies, found }), []);
});

test('key drift fires with both key sets named (the dice P0 shape)', () => {
  // The historical defect, verbatim: the frontend posted three keys the server
  // never read, so the request always 400'd.
  const found = new Map([['/api/dice', { keys: ['filePath', 'rollType', 'expect'], line: 152 }]]);
  const findings = compare({ bodies, found });
  assert.deepEqual(findings.map((f) => f.check), ['key-drift']);
  assert.match(findings[0].message, /filePath/);
  assert.match(findings[0].message, /path/);
});

test('a missing call site fires (a renamed route must not silently pass)', () => {
  const found = new Map([['/api/dice', null]]);
  assert.deepEqual(compare({ bodies, found }).map((f) => f.check), ['missing-call']);
});

test('bodyKeysFor extracts the key set from a real-shaped fetch call', () => {
  const text = [
    'const rollDie = () => {',
    '  void (async () => {',
    '    const res = await fetch(\'/api/dice\', {',
    '      method: \'POST\',',
    '      headers: { \'Content-Type\': \'application/json\' },',
    '      body: JSON.stringify({ path: filePath }),',
    '    });',
    '  })();',
    '};',
  ].join('\n');
  assert.deepEqual(bodyKeysFor(text, '/api/dice'), { keys: ['path'], line: 3 });
});

test('bodyKeysFor returns null when no matching fetch call exists', () => {
  assert.equal(bodyKeysFor('const x = 1;', '/api/dice'), null);
});
