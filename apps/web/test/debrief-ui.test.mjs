// The 复盘 / debrief on the page: the helpers the
// ending chrome uses, the POST body, and the order ending → debrief → results.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { test } from 'node:test';
import { createJiti } from '../../../vendor/pi-rp/node_modules/jiti/lib/jiti.mjs';

const jiti = createJiti(import.meta.url);
const { verdictMark, unansweredIds, hasEndingChrome, submitDebrief } = await jiti.import('../src/lib/closed-run.ts');

test('verdict marks: ★ hidden, ✓ surface, ✗ wrong, ？ guessed without evidence, ？？？ unanswered', () => {
  assert.equal(verdictMark('hidden'), '★');
  assert.equal(verdictMark('surface'), '✓');
  assert.equal(verdictMark('wrong'), '✗');
  assert.equal(verdictMark('guessed'), '？');
  assert.equal(verdictMark('unanswered'), '？？？');
});

test('skipping a question is allowed; the confirm step counts what is open', () => {
  const ms = [{ id: 'a', question: 'q', options: [] }, { id: 'b', question: 'q', options: [] }];
  assert.deepEqual(unansweredIds(ms, { a: 'x' }), ['b']);
  assert.deepEqual(unansweredIds(ms, { a: 'x', b: 'y' }), []);
});

test('worlds with endings (closed or semi) show the ending chrome; open worlds do not', () => {
  assert.equal(hasEndingChrome('closed'), true);
  assert.equal(hasEndingChrome('semi'), true);
  assert.equal(hasEndingChrome('open'), false);
});

test('submitDebrief posts { answers } and returns the run state; a refusal throws', async () => {
  const calls = [];
  globalThis.fetch = async (url, init) => {
    calls.push({ url, body: JSON.parse(init.body) });
    return { ok: true, status: 200, json: async () => ({ ok: true, mode: 'semi', ending: { id: 'e' }, debrief: { mysteries: [], result: { unlocked: 1 } } }) };
  };
  const run = await submitDebrief({ a: 'x' });
  assert.deepEqual(calls, [{ url: '/api/world/debrief', body: { answers: { a: 'x' } } }]);
  assert.equal(run.debrief.result.unlocked, 1);
  assert.equal(run.clock, null);
  globalThis.fetch = async () => ({ ok: false, status: 409, json: async () => ({ ok: false, error: 'already' }) });
  await assert.rejects(submitDebrief({}), /already/);
});

test('the ending card comes first; the debrief and the settlement follow it', () => {
  const src = fs.readFileSync(new URL('../src/components/chrome/ClosedRun.tsx', import.meta.url), 'utf8');
  assert.match(src, /useState<Phase>\('ending'\)/, 'a new ending opens on the ending card');
  assert.match(src, /phase === 'results' \|\| !pending/, 'the settlement waits for the debrief (or its skip)');
  assert.match(src, /t\('Skip debrief'\)/);
  assert.match(src, /t\('Secrets solved \{n\} \/ \{total\}'/);
});
