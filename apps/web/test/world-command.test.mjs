// World-command receipt projection.
// Pure functions only — no DOM, no React. The fixtures below are the REAL wire
// shapes emitted by `runTriggeredCommands` (packages/shared/src/commands/
// trigger.ts), verified against packages/shared/test/world-command-e2e.test.mjs.
// Run: node --test apps/web/test/world-command.test.mjs
import assert from 'node:assert/strict';
import { test } from 'node:test';

let mod = null;
try {
  const { createJiti } = await import('../../../vendor/pi-rp/node_modules/jiti/lib/jiti.mjs');
  const jiti = createJiti(import.meta.url, { moduleCache: false, tryNative: true });
  mod = await jiti.import('../src/lib/world-command.ts');
} catch (err) {
  console.error('jiti/bootstrap unavailable, skipping world-command group:', err?.message ?? err);
}
const skip = mod ? false : 'jiti or pi-rp submodule unavailable';

/** English-only translator: the module under test never reaches React/i18n. */
const t = (key, values = {}) => key.replace(/\{(\w+)\}/g, (_, name) => String(values[name] ?? `{${name}}`));

/* ── real wire fixtures ─────────────────────────────────────────────────── */

/** `status: 'ok'` + one ran effect (the "applied" row of the e2e test). */
const APPLIED = {
  command: 'investigate-clue',
  hook: 'roll_resolved',
  source: 'world/london-map/04-investigation-dice.md',
  binding: 1,
  status: 'ok',
  settleReport: {
    ran: [{
      key: '9f2c41ab7de05513',
      command: 'investigate-clue',
      steps: 1,
      effects: [{ action: 'edit', step: 0, at: 'do[0]#1', settle: 'ran', path: 'world/london-map/04-investigation-dice.md', seq: 1043 }],
    }],
    reused: [],
    resumed: [],
  },
  effects: [{ action: 'edit', step: 0, at: 'do[0]#1', settle: 'ran', path: 'world/london-map/04-investigation-dice.md', seq: 1043 }],
};

/** `status: 'error'` + `settleReport.failed` (the e2e failure row). */
const EFFECT_FAILED = {
  command: 'investigate-clue',
  hook: 'roll_resolved',
  source: 'world/london-map/04-investigation-dice.md',
  binding: 0,
  status: 'error',
  message: 'the world command could not settle',
  settleReport: {
    ran: [],
    reused: [],
    resumed: [],
    failed: { key: '3d7e0b91c4a25f60', command: 'investigate-clue', step: 1, code: 'not_found', message: 'Entity not found: "world/london-map/lamp-oil.md"' },
  },
};

/** `status: 'error'` before any settle — the pre-settle refusal shape. */
const NOT_FOUND = {
  command: 'investigate-clue',
  hook: 'roll_resolved',
  source: 'world/london-map/04-investigation-dice.md',
  binding: 0,
  status: 'error',
  code: 'command_not_found',
  message: 'Binding 0 ... command/investigate-clue.yaml does not exist.',
};

/** `status: 'skipped'` + `already_done` — the idempotency reuse shape (05). */
const REUSED = {
  command: 'investigate-clue',
  hook: 'roll_resolved',
  source: 'world/london-map/04-investigation-dice.md',
  binding: 0,
  status: 'skipped',
  skipped: 'already_done',
  settleReport: { ran: [], reused: [{ key: 'a'.repeat(16), command: 'investigate-clue', steps: 1, effects: [] }], resumed: [] },
  message: 'already settled for this result',
};

/** `status: 'skipped'` + `when_false` — declared but not matched (06 §10.5 乙). */
const WHEN_FALSE = {
  command: 'investigate-clue',
  hook: 'roll_resolved',
  source: 'world/london-map/04-investigation-dice.md',
  binding: 0,
  status: 'skipped',
  skipped: 'when_false',
  message: '"when" evaluated false; not run.',
};

test('W1 an ok receipt projects to applied and keeps the wire code out of the copy', { skip }, () => {
  const views = mod.parseCommandReceipts([APPLIED]);
  assert.equal(views.length, 1);
  const [view] = views;
  assert.equal(view.id, 'investigate-clue');
  assert.equal(view.status, 'applied');
  assert.equal(view.settle, 'ran');
  assert.equal(view.entryIndex, 1, '`binding` on the wire is the matched slot');
  assert.equal(view.code, undefined, 'an applied receipt carries no code');
  assert.equal(view.steps.length, 1);
  assert.deepEqual(view.steps[0].targets, ['world/london-map/04-investigation-dice.md']);
  assert.deepEqual(view.steps[0].eventIds, ['evt-1043']);
  assert.equal(view.steps[0].ok, true);
});

test('W2 a settle failure projects to blocked when the world refused, and names the path', { skip }, () => {
  const [view] = mod.parseCommandReceipts([EFFECT_FAILED]);
  assert.equal(view.status, 'blocked', '`not_found` is a world refusal, not a broken command');
  assert.equal(view.settle, 'ran');
  assert.equal(view.code, undefined);
  // `appliedBeforeFailure` is a `failed`-only field: a refusal that never
  // entered an effect has no honest "how far did it get" number.
  assert.equal(view.appliedBeforeFailure, undefined);
  // The failure has no effect outcome of its own, so there is no honest path to
  // name — the copy degrades to the unnamed sentence rather than parsing `message`.
  const line = mod.receiptLine([view], t);
  assert.equal(line.tone, 'notice');
  assert.ok(!/lamp-oil/.test(line.text), 'the raw ActionError.message MUST NOT reach the player');
  assert.match(line.text, /nothing was taken from you/i);
});

test('W3 a pre-settle refusal projects to skipped and never leaks parser vocabulary', { skip }, () => {
  const [view] = mod.parseCommandReceipts([NOT_FOUND]);
  assert.equal(view.status, 'skipped');
  assert.equal(view.code, 'command_not_found');
  const line = mod.receiptLine([view], t);
  assert.equal(line.tone, 'notice');
  assert.match(line.text, /missing a rule/i);
  assert.ok(!line.text.includes('command/'), line.text);
  assert.ok(!line.text.includes('.yaml'), line.text);
  assert.equal(line.detail, 'command_not_found', 'the code stays available as machine data');
});

test('W4 an idempotency reuse is a conflict, not a failure', { skip }, () => {
  const [view] = mod.parseCommandReceipts([REUSED]);
  assert.equal(view.status, 'reused');
  assert.equal(view.settle, 'reused');
  const line = mod.receiptLine([view], t);
  assert.equal(line.tone, 'notice');
  assert.match(line.text, /nothing was given twice/i);
});

test('W5 a when_false skip is `skipped`, distinct from `reused`', { skip }, () => {
  const [view] = mod.parseCommandReceipts([WHEN_FALSE]);
  assert.equal(view.status, 'skipped');
  assert.equal(view.settle, 'ran', 'the settler ran; only the binding did not execute');
});

test('W6 malformed input is dropped, never thrown (the guard is lenient)', { skip }, () => {
  // Every one of these would crash a strict guard; a receipt is ADDITIONAL
  // information, so the ceremony must still play without it (06 §7.3).
  assert.deepEqual(mod.parseCommandReceipts(undefined), []);
  assert.deepEqual(mod.parseCommandReceipts(null), []);
  assert.deepEqual(mod.parseCommandReceipts('commands'), []);
  assert.deepEqual(mod.parseCommandReceipts({ commands: [] }), []);
  assert.deepEqual(mod.parseCommandReceipts([null, 42, 'x', [], {}]), [], 'no id ⇒ nothing a player can be shown');
  assert.deepEqual(mod.parseCommandReceipts([{ command: '' }]), []);
  assert.equal(mod.receiptLine([], t), null, 'nothing declared ⇒ silence');
  // A receipt with a valid id but garbage everywhere else still yields a row.
  const [view] = mod.parseCommandReceipts([{ command: 'x', status: 7, settleReport: 'nope', effects: 'nope' }]);
  assert.equal(view.id, 'x');
  assert.equal(view.status, 'failed', 'an unrecognised refusal is still a refusal');
  assert.deepEqual(view.steps, []);
  assert.deepEqual(view.reveal, []);
});

test('W7 a followed last call still wins over an earlier one in the same hook', { skip }, () => {
  // Two bindings, one entry: aggregation must not let a reuse hide a landed run.
  const line = mod.receiptLine(mod.parseCommandReceipts([REUSED, APPLIED]), t);
  assert.equal(line.tone, 'ok');
  assert.match(line.text, /written into the world/i);
});

test('W8 many landed runs summarise by count, and severity orders the rest', { skip }, () => {
  const line = mod.receiptLine(mod.parseCommandReceipts([APPLIED, { ...APPLIED, binding: 2 }]), t);
  assert.equal(line.tone, 'ok');
  assert.equal(line.text, '2 outcomes were written into the world.');
  // failed > blocked > skipped: the worst one sets both tone and copy.
  const failed = { ...EFFECT_FAILED, settleReport: { ...EFFECT_FAILED.settleReport, failed: { ...EFFECT_FAILED.settleReport.failed, code: 'io_failed' } } };
  const failedView = mod.parseCommandReceipts([failed])[0];
  assert.equal(failedView.status, 'failed', 'a partial write is a failure, not a refusal');
  assert.equal(failedView.appliedBeforeFailure, 1, 'failed runs report how far they got');
  const worst = mod.receiptLine(mod.parseCommandReceipts([NOT_FOUND, failed, WHEN_FALSE]), t);
  assert.equal(worst.tone, 'warning');
  assert.match(worst.text, /only part of the automatic outcome/i);
});

test('W9 resumed reads exactly like applied to a player, but keeps its own verb', { skip }, () => {
  const resumed = {
    ...APPLIED,
    settleReport: { ran: [], reused: [], resumed: [{ key: 'b'.repeat(16), command: 'investigate-clue', steps: 2, effects: APPLIED.effects, from: 1, to: 3 }] },
  };
  const [view] = mod.parseCommandReceipts([resumed]);
  assert.equal(view.status, 'resumed');
  assert.equal(view.settle, 'resumed', 'the verb stays inspectable on the machine side');
  const resumedLine = mod.receiptLine([view], t);
  const appliedLine = mod.receiptLine(mod.parseCommandReceipts([APPLIED]), t);
  assert.equal(resumedLine.text, appliedLine.text, 'the two statuses share one player sentence');
  assert.equal(resumedLine.tone, appliedLine.tone);
});

test('W10 the fingerprint folds in status, so a different outcome cannot look identical', { skip }, () => {
  const applied = mod.parseCommandReceipts([APPLIED]);
  const reused = mod.parseCommandReceipts([REUSED]);
  assert.equal(mod.receiptsFingerprint(applied), mod.receiptsFingerprint(mod.parseCommandReceipts([APPLIED])));
  assert.notEqual(mod.receiptsFingerprint(applied), mod.receiptsFingerprint(reused));
  assert.notEqual(mod.receiptsFingerprint(applied), mod.receiptsFingerprint([]));
});

test('W11 reveal is preserved verbatim and changes the applied sentence', { skip }, () => {
  const [view] = mod.parseCommandReceipts([{ ...APPLIED, reveal: ['world/a.md', '', 7, 'world/b.md'] }]);
  assert.deepEqual(view.reveal, ['world/a.md', 'world/b.md'], 'non-strings are dropped, order kept');
  const line = mod.receiptLine([view], t);
  assert.match(line.text, /on the table/i);
});

/* ── the card's persistent receipt (06 §2.2 / §7.5) ─────────────────────── */

test('W12 command_error reads defensively and never carries `message`', { skip }, () => {
  const record = {
    key: '3d7e0b91c4a25f60',
    command: 'investigate-clue',
    hook: 'roll_resolved',
    step: 1,
    action: 'move',
    code: 'not_found',
    target: 'world/london-map/lamp-oil.md',
    pending: 2,
    at: '2026-09-14T09:12:03.441Z',
    message: 'line 7, column 3: unknown top-level key "rewardz"',
  };
  const view = mod.parseCommandError(record);
  assert.equal(view.command, 'investigate-clue');
  assert.equal(view.target, 'world/london-map/lamp-oil.md');
  assert.equal(view.pending, 2);
  assert.equal(view.code, 'not_found');
  assert.ok(!('message' in view), 'the raw ActionError.message MUST NOT be projected');
  assert.equal(JSON.stringify(view).includes('rewardz'), false, 'no parser vocabulary survives projection');
});

test('W13 command_error degrades field by field and rejects an anonymous record', { skip }, () => {
  assert.equal(mod.parseCommandError(null), null);
  assert.equal(mod.parseCommandError([]), null);
  assert.equal(mod.parseCommandError({ code: 'not_found' }), null, 'no command id ⇒ nothing to show');
  const partial = mod.parseCommandError({ command: 'x', pending: 'two', at: 7 });
  assert.equal(partial.command, 'x');
  assert.equal(partial.pending, undefined, 'a non-integer pending must not be reported as a count');
  assert.equal(partial.target, undefined, 'a missing target never falls back to the message');
});

test('W14 command_log drops a malformed entry whole, never half-renders it', { skip }, () => {
  const log = mod.parseCommandLog([
    { key: 'k', command: 'a', hook: 'roll_resolved', index: 1, status: 'done', at: '2026-09-14T09:12:03.441Z', plan: '4b81f0a2', steps: [{ step: 0, at: 'do[0]#1', action: 'give', event: 'evt-1043' }, { step: 1, at: 'do[0]#2', action: 'link', event: null }] },
    'garbage',
    { command: 'b' },                                // no `at` ⇒ dropped
    { command: 'c', at: 'T', status: 'weird' },      // unknown status ⇒ done
  ]);
  assert.equal(log.length, 2);
  assert.equal(log[0].command, 'a');
  assert.equal(log[0].index, 1);
  assert.equal(log[0].steps.length, 2);
  assert.deepEqual(log[0].steps[1], { step: 1, action: 'link' }, 'a null event yields no tracing handle');
  assert.equal(log[1].status, 'done', 'never over-report "unfinished"');
  assert.deepEqual(mod.parseCommandLog(undefined), []);
  assert.deepEqual(mod.parseCommandLog({ 0: 'x' }), []);
});

test('W15 a non-`evt-` id is not rendered as a tracing placeholder', { skip }, () => {
  const [entry] = mod.parseCommandLog([{ command: 'a', at: 'T', steps: [{ step: 0, action: 'give', event: 'PLACEHOLDER' }] }]);
  assert.deepEqual(entry.steps, [{ step: 0, action: 'give' }]);
});
