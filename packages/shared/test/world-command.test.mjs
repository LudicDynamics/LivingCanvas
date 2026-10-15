/**
 * `parseWorldCommand` — the write-time validator (doc-command/01).
 *
 * These cases are chosen for what they defend, not for coverage:
 *   - the silent failure YAML will not report (`unquoted_template`);
 *   - error COLLECTION (the model fixes a file in one round trip);
 *   - the write-time ceiling that `09`'s cost argument rests on;
 *   - `canonicalCommandStepText`'s two order rules, because `05`'s `plan`
 *     digest is comparable across runs only if expansion is deterministic.
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  canonicalCommandStepText,
  commandIdOfPath,
  parseWorldCommand,
} from '../dist/commands/world-command.js';
import { WORLD_COMMAND_EFFECTS, WORLD_COMMAND_EFFECT_ARGS } from '../dist/commands/effects.js';

const VALID = [
  'name: 調査の覚え書きを発行する',
  'desc: 骰子の結果に応じて覚え書きを一枚発行する',
  'params:',
  '  grade:',
  '    type: enum',
  '    values: [great, success, setback, failure]',
  '    default: success',
  '  note_path:',
  '    type: string',
  '  note_title:',
  '    type: string',
  '  note_body:',
  '    type: string',
  '  next_label:',
  '    type: string',
  'do:',
  '  - action: give',
  '    when: "roll.result in 13..60"',
  '    with:',
  '      path: "{{ note_path }}"',
  '      title: "{{ note_title }}"',
  '      body: "覚え書き：{{ note_body }}（{{ grade }}）"',
  '  - action: set_status',
  '    with:',
  '      path: "{{ note_path }}"',
  '      values:',
  '        found: true',
  '        grade: "{{ grade }}"',
  '  - action: edit',
  '    with:',
  '      path: "{{ note_path }}"',
  '      append_body: "次の一手：{{ next_label }}"',
  '',
].join('\n');

test('commandIdOfPath', () => {
  assert.equal(commandIdOfPath('command/award-clue.yaml'), 'award-clue');
  assert.equal(commandIdOfPath('world/command/award-clue.yaml'), null);
  assert.equal(commandIdOfPath('command/award-clue.yml'), null);
  assert.equal(commandIdOfPath('command/Award Clue.yaml'), null);
  assert.equal(commandIdOfPath('command/sub/x.yaml'), null);
});

test('accepts a valid command and returns a spec', () => {
  const r = parseWorldCommand('award-clue', VALID);
  assert.ok(r.ok, JSON.stringify(r.ok ? [] : r.errors));
  assert.equal(r.command.id, 'award-clue');
  assert.equal(r.command.steps.length, 3);
  assert.equal(r.command.params['grade'].type, 'enum');
});

test('compiles `when` into an AST so the executor never re-parses', () => {
  const r = parseWorldCommand('award-clue', VALID);
  assert.ok(r.ok);
  assert.notEqual(r.command.steps[0].whenAst, undefined);
});

test('a command whose every parameter is referenced yields no warnings', () => {
  const r = parseWorldCommand('award-clue', VALID);
  assert.ok(r.ok);
  assert.deepEqual(r.warnings, []);
});

test('an unreferenced parameter is a warning, not an error', () => {
  const src = [
    'name: x',
    'params:',
    '  unused: { type: string }',
    '  p: { type: string }',
    'do:',
    '  - action: give',
    '    with:',
    '      path: "{{ p }}"',
    '',
  ].join('\n');
  const r = parseWorldCommand('award-clue', src);
  assert.ok(r.ok, JSON.stringify(r.ok ? [] : r.errors));
  assert.equal(r.warnings.length, 1);
  assert.equal(r.warnings[0].code, 'unused_param');
});

test('flags an unquoted `{{` — the one silent failure YAML does not report', () => {
  // Measured: yaml@2.9 reads `path: {{ p }}` as a flow map and returns
  // `{"path":{"{ p }":null}}` with `doc.errors === []`. Only the CST tells us.
  const src = ['name: x', 'do:', '  - action: give', '    with:', '      path: {{ p }}', ''].join('\n');
  const r = parseWorldCommand('award-clue', src);
  assert.equal(r.ok, false);
  assert.ok(r.errors.some((e) => e.code === 'unquoted_template'), JSON.stringify(r.errors));
});

test('does NOT misfire on a real flow map', () => {
  const src = [
    'name: x',
    'do:',
    '  - action: edit',
    '    with:',
    '      path: "a.md"',
    '      frontmatter: { p: 1 }',
    '',
  ].join('\n');
  const r = parseWorldCommand('award-clue', src);
  assert.ok(r.ok, JSON.stringify(r.ok ? [] : r.errors));
});

test('does NOT misfire on a block list of steps', () => {
  const src = [
    'name: x',
    'do:',
    '  - action: give',
    '    with:',
    '      path: "a.md"',
    '  - action: give',
    '    with:',
    '      path: "b.md"',
    '',
  ].join('\n');
  const r = parseWorldCommand('award-clue', src);
  assert.ok(r.ok, JSON.stringify(r.ok ? [] : r.errors));
});

test('does NOT misfire on an inline template', () => {
  const src = [
    'name: x',
    'params:',
    '  p: { type: string }',
    'do:',
    '  - action: give',
    '    with:',
    '      path: "a{{ p }}b.md"',
    '',
  ].join('\n');
  const r = parseWorldCommand('award-clue', src);
  assert.ok(r.ok, JSON.stringify(r.ok ? [] : r.errors));
});

test('collects independent errors together, so one round trip fixes the file', () => {
  const src = ['name: ""', 'bogus_key: 1', 'do:', '  - action: rewardz', '    with:', '      nope: 1', ''].join('\n');
  const r = parseWorldCommand('award-clue', src);
  assert.equal(r.ok, false);
  const codes = new Set(r.errors.map((e) => e.code));
  assert.ok(codes.has('unknown_key'), 'unknown top-level key');
  assert.ok(codes.has('name_empty'), 'empty name');
  assert.ok(codes.has('unknown_action'), 'unknown effect');
});

test('rejects a mistyped top-level key with a spelling hint', () => {
  const src = ['name: x', 'decs: y', 'do:', '  - action: give', '    with:', '      path: "a.md"', ''].join('\n');
  const r = parseWorldCommand('award-clue', src);
  assert.equal(r.ok, false);
  const e = r.errors.find((x) => x.code === 'unknown_key');
  assert.ok(e, JSON.stringify(r.errors));
  assert.match(e.message, /Did you mean "desc"\?/);
});

test('rejects a 13-step command at write time (03 T11; the limit is 12)', () => {
  // The limit is `03`'s WORLD_COMMAND_STEP_LIMIT, not a number of 01's own.
  // With the old 16 this assertion would have silently stopped meaning anything.
  const steps = Array.from(
    { length: 13 },
    (_v, i) => `  - action: give\n    with:\n      path: "a${i}.md"`
  ).join('\n');
  const r = parseWorldCommand('award-clue', `name: x\ndo:\n${steps}\n`);
  assert.equal(r.ok, false);
  assert.ok(r.errors.some((e) => e.code === 'too_many_steps'), JSON.stringify(r.errors));
});

test('the arg surface is the EFFECT registry, not a second copy in 01', () => {
  // 04 §2.6: "哪个效果接受哪种形态由本表声明，`01` 不猜". If this drifts, the
  // error an author sees (`arg_shape_mismatch`) stops matching the contract.
  for (const action of WORLD_COMMAND_EFFECTS) {
    const form = WORLD_COMMAND_EFFECT_ARGS[action];
    assert.ok(form, `${action} has no declared arg form`);
    assert.ok(form.names.length > 0, `${action} declares no argument names`);
  }
  // Sanity on the two forms that carry array semantics.
  assert.equal(WORLD_COMMAND_EFFECT_ARGS.give.arrayForm, 'list-args');
  assert.deepEqual([...WORLD_COMMAND_EFFECT_ARGS.give.oneOf], ['path', 'rewards']);
});

test('`give` takes exactly one of path / rewards', () => {
  const src = [
    'name: x',
    'do:',
    '  - action: give',
    '    with:',
    '      path: "a.md"',
    '      rewards: "{{ trigger.entry.rewards }}"',
    '',
  ].join('\n');
  const r = parseWorldCommand('award-clue', src);
  assert.equal(r.ok, false);
  assert.ok(r.errors.some((e) => e.code === 'arg_shape_mismatch'), JSON.stringify(r.errors));
});

test('canonicalCommandStepText normalises `{{ x }}` without evaluating it', () => {
  const a = canonicalCommandStepText({ action: 'give', args: { path: '{{  p  }}' }, line: 0 });
  const b = canonicalCommandStepText({ action: 'give', args: { path: '{{p}}' }, line: 0 });
  assert.equal(a, b);
});

test('canonicalCommandStepText sorts map keys but PRESERVES list order', () => {
  const a = canonicalCommandStepText({ action: 'edit', args: { path: 'a', frontmatter: { b: 1, a: 2 } }, line: 0 });
  const b = canonicalCommandStepText({ action: 'edit', args: { path: 'a', frontmatter: { a: 2, b: 1 } }, line: 0 });
  assert.equal(a, b, 'map key order must not matter');
  const listA = canonicalCommandStepText({ action: 'give', args: { rewards: ['x', 'y'] }, line: 0 });
  const listB = canonicalCommandStepText({ action: 'give', args: { rewards: ['y', 'x'] }, line: 0 });
  assert.notEqual(listA, listB, 'list order is semantic and MUST survive');
});

test('canonicalCommandStepText does not fold `whenAst` into the digest', () => {
  // The digest is of the DECLARED form; an AST would fold the evaluator's
  // current version into a value whose whole job is to be comparable (`01` §3.5).
  const withAst = canonicalCommandStepText({
    action: 'give',
    when: '1..2',
    whenAst: { anyOf: [], atoms: [] },
    args: { path: 'a' },
    line: 0,
  });
  const without = canonicalCommandStepText({ action: 'give', when: '1..2', args: { path: 'a' }, line: 0 });
  assert.equal(withAst, without);
});
