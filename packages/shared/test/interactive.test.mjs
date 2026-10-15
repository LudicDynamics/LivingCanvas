/**
 * doc-06 `choose` + interactive-field acceptance tests (06 §10).
 *
 * Imports the built `dist/` modules directly (not the barrel), matching
 * `canvas.test.mjs`: `dist/index.js` transitively re-exports every tool module
 * in the batch, so one unfinished sibling blocks a barrel import. Rebuild
 * `@airp/shared` before running.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';

import {
  CHOICE_LIMIT,
  buildInteractiveFields,
  entityName,
  evalWhen,
  formatInteractiveText,
  resolveChoice,
  visibleChoiceOptions,
} from '../dist/rules/interactive.js';
import { parseFrontmatter, stringifyFrontmatter } from '../dist/schemas/frontmatter.js';
import { chooseOption } from '../dist/actions/choose.js';
import { ActionError } from '../dist/actions/errors.js';
import { createActionService } from '../dist/actions/service.js';
import { LocalWorldStore } from '../dist/store/local-store.js';

const ACTOR = { type: 'writer' };

async function tempStore() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'airp-choose-test-'));
  const store = new LocalWorldStore(root);
  await store.writeFile(
    'world.json',
    JSON.stringify({
      id: 'proj-1',
      name: 'T',
      description: '',
      author: '',
      genre: 'test',
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
    })
  );
  return { store, root };
}

function service(store) {
  return createActionService(store, ACTOR, { turn: 'req:test' });
}

function isActionError(code) {
  return (err) => {
    assert.ok(err instanceof ActionError, `expected ActionError, got ${err}`);
    assert.equal(err.code, code, err.message);
    return true;
  };
}

// ------------------------------------------------------------- evalWhen (§10.1)

test('evalWhen accepts the tiny grammar and is fail-closed (06 §3.5)', () => {
  assert.equal(evalWhen('k == 1', { k: 1 }), true);
  assert.equal(evalWhen('k == 1', { k: 2 }), false);
  assert.equal(evalWhen('k == 1', {}), false);
  assert.equal(evalWhen('k != 1', { k: 1 }), false);
  assert.equal(evalWhen('k != 1', { k: 2 }), true);
  assert.equal(evalWhen('k != 1', {}), true);
  assert.equal(evalWhen('k == true', { k: true }), true);
  assert.equal(evalWhen('k == open', { k: 'open' }), true);
  assert.equal(evalWhen('k == 1', { k: '1' }), true, 'numeric literal equals numeric string');
  assert.equal(evalWhen('"k" == "1"', { k: 1 }), true, 'quotes are stripped on both sides');

  for (const bad of ['k === 1', 'k > 1', '', '   ', 'k', '== 1', 'a and b']) {
    assert.equal(evalWhen(bad, { k: 1 }), false, `malformed "${bad}" is false`);
  }
});

// --------------------------------------------- visibleChoiceOptions / numbering

const LID_GROUP = {
  mode: 'single',
  allowFree: false,
  options: [
    { index: 1, label: 'Open the lid', visible: true },
    { index: 0, label: 'Play the unfinished nocturne', when: 'lid == open', visible: false },
  ],
};

test('visibleChoiceOptions renumbers from 1 over the visible list only (06 §3.5)', () => {
  const closed = buildInteractiveFields({
    choice: ['Open the lid', { label: 'Play the unfinished nocturne', when: 'lid == open' }],
    status: { data: { lid: 'closed' } },
  }).choice;
  const closedVisible = visibleChoiceOptions(closed);
  assert.equal(closedVisible.length, 1);
  assert.equal(closedVisible[0].index, 1);

  const open = buildInteractiveFields({
    choice: ['Open the lid', { label: 'Play the unfinished nocturne', when: 'lid == open' }],
    status: { data: { lid: 'open' } },
  }).choice;
  const openVisible = visibleChoiceOptions(open);
  assert.deepEqual(openVisible.map((o) => o.index), [1, 2], 'not 1/3');
});

// ---------------------------------------------------------- resolveChoice (§10.1)

test('resolveChoice: id -> exact label -> ci label -> index (06 §3.2)', () => {
  const group = buildInteractiveFields({
    choice: [
      { label: 'Open the lid', id: 'open-the-lid' },
      'Run',
    ],
  }).choice;
  assert.equal(resolveChoice(group, 1).option.label, 'Open the lid');
  assert.equal(resolveChoice(group, '1').option.label, 'Open the lid');
  assert.equal(resolveChoice(group, 'Open the lid').option.label, 'Open the lid');
  assert.equal(resolveChoice(group, 'OPEN THE LID').option.label, 'Open the lid');
  assert.equal(resolveChoice(group, 'open-the-lid').option.label, 'Open the lid');
  assert.deepEqual(resolveChoice(group, 4), { error: 'out_of_range' });
  assert.deepEqual(resolveChoice(group, 0), { error: 'out_of_range' });
  assert.deepEqual(resolveChoice(group, -1), { error: 'out_of_range' });
  assert.deepEqual(resolveChoice(group, 'Nope'), { error: 'not_found' });
});

test('resolveChoice: text beats number when an option label is "2" (06 §3.2)', () => {
  const group = buildInteractiveFields({ choice: ['2', 'Open the lid', 'Run'] }).choice;
  const viaString = resolveChoice(group, '2');
  assert.equal(viaString.option.label, '2');
  assert.equal(viaString.option.index, 1);
  const viaNumber = resolveChoice(group, 2);
  assert.equal(viaNumber.option.label, 'Open the lid');
  assert.equal(viaNumber.option.index, 2);
});

test('resolveChoice: duplicate labels are ambiguous, all-hidden is not found', () => {
  const dup = buildInteractiveFields({ choice: ['Same', 'Same'] }).choice;
  assert.deepEqual(resolveChoice(dup, 'Same'), { error: 'not_found' });
  assert.equal(resolveChoice(dup, 2).option.label, 'Same', 'the index still disambiguates');

  const hidden = buildInteractiveFields({
    choice: ['A', { label: 'B', when: 'k == 1' }],
  }).choice;
  assert.deepEqual(resolveChoice(hidden, 'B'), { error: 'not_found' });
});

// -------------------------------------------------------------- entityName (§10.1)

test('entityName: title -> name -> basename (06 §3.7)', () => {
  assert.equal(entityName({ title: 'X' }, 'world/inn/a.md'), 'X');
  assert.equal(entityName({ name: 'Y' }, 'world/inn/a.md'), 'Y');
  assert.equal(entityName({}, 'world/inn/copper-key.md'), 'copper-key');
  assert.equal(entityName({ title: '  ' }, 'world/inn/copper-key.md'), 'copper-key');
  assert.equal(entityName(null, 'world/inn/copper-key.md'), 'copper-key');
  assert.equal(entityName({ title: 'T', name: 'N' }, 'p.md'), 'T', 'title wins');
});

// ---------------------------------------------------- buildInteractiveFields

test('buildInteractiveFields normalizes both choice spellings and collapses bad ones (06 §3.3)', () => {
  const shorthand = buildInteractiveFields({ choice: ['A', 'B'] }).choice;
  const full = buildInteractiveFields({ choice: { options: ['A', 'B'] } }).choice;
  assert.deepEqual(shorthand.options.map((o) => o.label), full.options.map((o) => o.label));
  assert.equal(shorthand.mode, 'single');
  assert.equal(shorthand.allowFree, false);

  const errors = [];
  assert.equal(buildInteractiveFields({ choice: 3 }, errors).choice, null);
  assert.equal(errors.length, 1);

  const errors2 = [];
  assert.equal(
    buildInteractiveFields({ status: { data: { a: { b: 1 } } } }, errors2).status,
    null
  );
  assert.equal(errors2.length, 1);

  const errors3 = [];
  assert.equal(
    buildInteractiveFields({ roll_dice: { desc: 'X' } }, errors3).roll_dice,
    null,
    'missing expect'
  );
  assert.equal(errors3.length, 1);

  const empty = buildInteractiveFields({});
  assert.deepEqual(empty, { status: null, choice: null, roll_dice: null });
});

test('buildInteractiveFields keeps status.data key order and chart (m-15)', () => {
  const fields = buildInteractiveFields({
    status: { label: 'Case Progress', chart: 'bars', data: { z: 1, a: 2 } },
  });
  assert.deepEqual(Object.keys(fields.status.data), ['z', 'a']);
  assert.equal(fields.status.label, 'Case Progress');
  assert.equal(fields.status.chart, 'bars');
});

test('buildInteractiveFields caps the visible list at CHOICE_LIMIT (06 §7.2)', () => {
  const errors = [];
  const labels = Array.from({ length: 15 }, (_, i) => `Option ${i + 1}`);
  const choice = buildInteractiveFields({ choice: labels }, errors).choice;
  assert.equal(visibleChoiceOptions(choice).length, CHOICE_LIMIT);
  assert.ok(errors.some((e) => e.includes(`${CHOICE_LIMIT}`)));
});

// ------------------------------------------------ formatInteractiveText (03 §5.3)

test('formatInteractiveText renders the three blocks in fixed order (03 §5.3)', () => {
  const raw = {
    roll_dice: { type: '1d100', desc: 'Deduction check', expect: '>50' },
    choice: ['Ask where the photograph came from', 'Go to the orchard alone to investigate'],
    status: { data: { photo_source: 'The Constable', orchard_clue: 'The name has been crossed out', case_progress: 'Clue found' } },
  };
  assert.equal(
    formatInteractiveText(raw),
    [
      '[Status]',
      'photo_source: The Constable',
      'orchard_clue: The name has been crossed out',
      'case_progress: Clue found',
      '',
      '[Choices]',
      '1. Ask where the photograph came from',
      '2. Go to the orchard alone to investigate',
      '',
      '[Dice]',
      'Deduction check · 1d100 · success >50 · not rolled',
    ].join('\n')
  );
  assert.equal(formatInteractiveText({}), '');
  assert.equal(formatInteractiveText(null), '');
});

test('formatInteractiveText: hints, hidden line and the three dice states (06 §3.5 / 03 §5.3)', () => {
  const withHint = formatInteractiveText({
    choice: [
      { label: 'Open the lid', hint: 'needs the lid open first' },
      { label: 'Play the unfinished nocturne', when: 'lid === open' },
    ],
    status: { data: { lid: 'closed' } },
  });
  assert.equal(
    withHint,
    [
      '[Status]',
      'lid: closed',
      '',
      '[Choices]',
      '1. Open the lid — needs the lid open first',
      '(hidden: "Play the unfinished nocturne" — malformed when "lid === open")',
    ].join('\n')
  );

  // A well-formed condition that is simply false is NOT reported: only a
  // malformed `when` gets the diagnostic line (03 §13.9).
  assert.equal(
    formatInteractiveText({
      choice: [
        { label: 'Open the lid' },
        { label: 'Play the unfinished nocturne', when: 'lid == open' },
      ],
      status: { data: { lid: 'closed' } },
    }),
    '[Status]\nlid: closed\n\n[Choices]\n1. Open the lid'
  );

  assert.match(
    formatInteractiveText({ roll_dice: { desc: 'D', expect: '>50', result: 62, passed: true } }),
    /rolled 62 — passed$/
  );
  assert.match(
    formatInteractiveText({ roll_dice: { desc: 'D', expect: '>50', result: 62, passed: false } }),
    /rolled 62 — failed$/
  );
  assert.match(
    formatInteractiveText({ roll_dice: { desc: 'D', expect: '>50' } }),
    /not rolled$/
  );
});

test('formatInteractiveText: status.label is printed under [Status] (03 §5.3)', () => {
  assert.equal(
    formatInteractiveText({ status: { label: 'Case Progress', data: { k: 'v' } } }),
    '[Status]\nCase Progress\nk: v'
  );
});

// ------------------------------------------------------- parseFrontmatter (§10.1)

test('parseFrontmatter: clean scalars, nested maps, inline comments (06 §9.2)', () => {
  const parsed = parseFrontmatter(
    '---\nbg: "a.png"   # c\ncompass: true   # c\nbgStyle:\n  tone: warm\n  grain: parchment\n---\n\nBody.\n'
  );
  assert.equal(parsed.frontmatter.bg, 'a.png');
  assert.equal(parsed.frontmatter.compass, true);
  assert.deepEqual(parsed.frontmatter.bgStyle, { tone: 'warm', grain: 'parchment' });
  assert.equal(parsed.body, '\nBody.\n');
  assert.deepEqual(parsed.errors, []);
});

test('parseFrontmatter: malformed YAML collapses to null with an error (06 §9.2)', () => {
  const parsed = parseFrontmatter('---\ntype: chalk\nroll_dice:\n  expect: >50\n---\nBody\n');
  assert.equal(parsed.frontmatter, null);
  assert.equal(parsed.entity, null);
  assert.ok(parsed.errors.length >= 1);
  assert.deepEqual(parsed.interactive, { status: null, choice: null, roll_dice: null });
});

test('parseFrontmatter: the ---\\n---\\n zero-content boundary is not a block (06 §9.2 ④)', () => {
  const zero = parseFrontmatter('---\n---\n');
  assert.equal(zero.frontmatter, null);
  assert.equal(zero.body, '---\n---\n', 'the whole input is the body');

  const commented = parseFrontmatter('---\n# c\n---\n');
  assert.deepEqual(commented.frontmatter, {}, 'a comment-only block is a legal empty mapping');
});

test('parseFrontmatter: no frontmatter returns the input verbatim; CRLF == LF (06 §9.2)', () => {
  const none = parseFrontmatter('Just prose, no fences.\n');
  assert.equal(none.frontmatter, null);
  assert.equal(none.body, 'Just prose, no fences.\n');

  const lf = parseFrontmatter('---\ntitle: X\n---\nBody\n');
  const crlf = parseFrontmatter('---\r\ntitle: X\r\n---\r\nBody\r\n');
  assert.deepEqual(crlf.frontmatter, lf.frontmatter);
  assert.equal(crlf.body, 'Body\r\n');
});

test('parseFrontmatter: interactive block is always present and unfiltered raw survives (06 §2.2)', () => {
  const parsed = parseFrontmatter(
    '---\ntype: chalk\ntitle: T\nchoice:\n  - "A"\n  - "B"\nblob:\n  deep: { a: [1, 2] }\n---\nB\n'
  );
  assert.equal(parsed.frontmatter.blob.deep.a.length, 2, 'unknown nested keys survive');
  assert.equal(parsed.interactive.choice.options.length, 2);
  assert.equal(parsed.entity.title, 'T');
  assert.deepEqual(parsed.errors, []);
});

test('parseFrontmatter: entity keeps unknown nested keys, bare keys become null (06 §9.2 / §11 conflict 4)', () => {
  const parsed = parseFrontmatter(
    '---\ntype: chalk\nbgStyle:\n  tone: warm\naccepts:\n  itemKinds: [key]\n---\nB\n'
  );
  assert.deepEqual(parsed.entity.bgStyle, { tone: 'warm' });
  assert.deepEqual(parsed.entity.accepts, { itemKinds: ['key'] });

  const bare = parseFrontmatter('---\ntitle:\n---\nB\n');
  assert.equal(bare.frontmatter.title, null);
  assert.equal(bare.entity.title, null, 'a bare key must not invalidate the entity');
  assert.deepEqual(bare.errors, []);
});

test('parseFrontmatter: a non-string core key invalidates only entity, not frontmatter', () => {
  const parsed = parseFrontmatter('---\ntype: [1, 2]\n---\nB\n');
  assert.deepEqual(parsed.frontmatter.type, [1, 2], 'raw is never filtered');
  assert.equal(parsed.entity, null);
  assert.ok(parsed.errors.some((e) => e.startsWith('type:')));
});

test('parseFrontmatter: alias bomb is bounded by maxAliasCount (06 §10.1 ⑦)', () => {
  const bomb = ['a: &a [1,2]', ...Array.from({ length: 2000 }, (_, i) => `k${i}: [*a, *a, *a, *a]`)].join('\n');
  const parsed = parseFrontmatter(`---\n${bomb}\n---\nB\n`);
  assert.equal(parsed.frontmatter, null, 'the bomb is rejected, not expanded');
  assert.ok(parsed.errors.length >= 1);
});

test('stringifyFrontmatter round-trips through parseFrontmatter (doc 10 peer request)', () => {
  const fm = {
    type: 'chalk',
    status: { data: { lid: 'open' } },
    bgStyle: { tone: 'warm', grain: 'parchment' },
    roll_dice: { type: '1d100', desc: 'D', expect: '>50' },
  };
  const round = parseFrontmatter(stringifyFrontmatter(fm, 'Body.\n'));
  assert.deepEqual(round.frontmatter, fm);
  assert.equal(round.body, 'Body.\n');
  assert.equal(stringifyFrontmatter(null, 'raw'), 'raw');
});

// ------------------------------------------------------------- chooseOption store

async function entityStore(frontmatter, body = 'Body.\n', relPath = 'world/inn/door.md') {
  const { store, root } = await tempStore();
  await store.writeFile(relPath, `---\n${frontmatter}---\n${body}`);
  return { store, root, relPath };
}

test('chooseOption records exactly one choice_selected with resolved label + index (06 §10.2)', async () => {
  const { store, root, relPath } = await entityStore(
    'type: chalk\ntitle: The Closed Piano\nchoice:\n  - "Open the lid"\n  - "Play it"\n'
  );
  try {
    const before = await store.getMaxSeq();
    const res = await chooseOption(
      { store, actor: ACTOR, turn: 'turn:s:1' },
      { path: relPath, choice: 2 }
    );
    assert.equal(res.details.index, 2);
    assert.equal(res.details.choice, 'Play it');
    assert.equal(res.details.name, 'The Closed Piano');
    assert.equal(res.details.count, 2);
    assert.match(res.text, /chose "Play it" \(option 2 of 2\)/);

    const events = await store.getEventsSince(before);
    assert.equal(events.length, 1);
    assert.equal(events[0].type, 'choice_selected');
    assert.equal(events[0].subject, relPath);
    assert.equal(events[0].layer, 'world/inn');
    assert.deepEqual(events[0].detail, {
      path: relPath,
      name: 'The Closed Piano',
      choice: 'Play it',
      index: 2,
    });
  } finally {
    store.close();
    await fs.rm(root, { recursive: true, force: true });
  }
});

test('chooseOption writes no file (md5 identical before/after) (06 §4.1)', async () => {
  const { store, root, relPath } = await entityStore('type: chalk\nchoice:\n  - "A"\n  - "B"\n');
  try {
    const abs = path.join(root, relPath);
    const before = await fs.readFile(abs);
    await chooseOption({ store, actor: { type: 'player' }, turn: 'req:1' }, { path: relPath, choice: 1 });
    assert.deepEqual(await fs.readFile(abs), before);
  } finally {
    store.close();
    await fs.rm(root, { recursive: true, force: true });
  }
});

test('chooseOption: failures leave the event count unchanged (06 §5.2)', async () => {
  const { store, root, relPath } = await entityStore('type: chalk\nchoice:\n  - "A"\n  - "B"\n');
  try {
    const base = await store.getMaxSeq();

    await assert.rejects(
      () => chooseOption({ store, actor: ACTOR, turn: 't' }, { path: 'world/inn/missing.md', choice: 1 }),
      isActionError('not_found')
    );
    await assert.rejects(
      () => chooseOption({ store, actor: ACTOR, turn: 't' }, { path: '../etc/passwd', choice: 1 }),
      isActionError('invalid_path')
    );
    await assert.rejects(
      () => chooseOption({ store, actor: ACTOR, turn: 't' }, { path: relPath, choice: '' }),
      isActionError('invalid_argument')
    );
    await assert.rejects(
      () => chooseOption({ store, actor: ACTOR, turn: 't' }, { path: relPath, choice: 1.5 }),
      isActionError('invalid_argument')
    );
    await assert.rejects(
      () => chooseOption({ store, actor: ACTOR, turn: 't' }, { path: relPath, choice: 4 }),
      isActionError('choice_not_found')
    );
    await assert.rejects(
      () => chooseOption({ store, actor: ACTOR, turn: 't' }, { path: relPath, choice: 'Nope' }),
      isActionError('choice_not_found')
    );

    assert.equal(await store.getMaxSeq(), base, 'no event was appended');
  } finally {
    store.close();
    await fs.rm(root, { recursive: true, force: true });
  }
});

test('chooseOption: no frontmatter -> malformed_entity; no choice -> not_interactive (REVIEW m-3/m-4)', async () => {
  const { store, root } = await tempStore();
  try {
    await store.writeFile('world/inn/plain.md', 'No fences here.\n');
    await assert.rejects(
      () => chooseOption({ store, actor: ACTOR, turn: 't' }, { path: 'world/inn/plain.md', choice: 1 }),
      isActionError('malformed_entity')
    );

    await store.writeFile('world/inn/bare.md', '---\ntitle: Bare\n---\nBody\n');
    await assert.rejects(
      () => chooseOption({ store, actor: ACTOR, turn: 't' }, { path: 'world/inn/bare.md', choice: 1 }),
      isActionError('not_interactive')
    );

    await store.writeFile('world/inn/broken.md', '---\ntitle: B\nchoice: 3\n---\nBody\n');
    await assert.rejects(
      () => chooseOption({ store, actor: ACTOR, turn: 't' }, { path: 'world/inn/broken.md', choice: 1 }),
      isActionError('not_interactive')
    );
  } finally {
    store.close();
    await fs.rm(root, { recursive: true, force: true });
  }
});

test('chooseOption: index drift under when, and the all-filtered case (06 §10.2)', async () => {
  const fm =
    'type: chalk\nchoice:\n  - "Open the lid"\n  - label: "Play the nocturne"\n    when: lid == open\nstatus:\n  data:\n    lid: closed\n';
  const { store, root, relPath } = await entityStore(fm);
  try {
    await assert.rejects(
      () => chooseOption({ store, actor: ACTOR, turn: 't' }, { path: relPath, choice: 2 }),
      isActionError('choice_not_found')
    );

    await store.writeFile(relPath, `---\n${fm.replace('lid: closed', 'lid: open')}---\nBody\n`);
    const res = await chooseOption({ store, actor: ACTOR, turn: 't' }, { path: relPath, choice: 2 });
    assert.equal(res.details.index, 2);
    assert.equal(res.details.choice, 'Play the nocturne');

    const allHidden =
      'type: chalk\nchoice:\n  - label: "A"\n    when: k == 1\n  - label: "B"\n    when: k == 2\n';
    await store.writeFile(relPath, `---\n${allHidden}---\nBody\n`);
    await assert.rejects(
      () => chooseOption({ store, actor: ACTOR, turn: 't' }, { path: relPath, choice: 1 }),
      (err) => {
        assert.ok(err instanceof ActionError);
        assert.equal(err.code, 'choice_not_found');
        assert.match(err.message, /no visible options/);
        return true;
      }
    );
  } finally {
    store.close();
    await fs.rm(root, { recursive: true, force: true });
  }
});

test('chooseOption: layer is the layer id for world paths, null for bag paths (06 §10.2)', async () => {
  const { store, root } = await tempStore();
  try {
    await store.writeFile('player/ticket.md', '---\ntitle: Ticket\nchoice:\n  - "Use it"\n---\nB\n');
    const res = await chooseOption({ store, actor: ACTOR, turn: 't' }, { path: 'player/ticket.md', choice: 1 });
    assert.equal(res.details.event.layer, null);
    const events = await store.getEventsSince(0);
    assert.equal(events.length, 1);
    assert.equal(events[0].layer, null);
  } finally {
    store.close();
    await fs.rm(root, { recursive: true, force: true });
  }
});

test('chooseOption: mode multi is unsupported, not silently single (06 §7.3)', async () => {
  const { store, root, relPath } = await entityStore(
    'type: chalk\nchoice:\n  mode: multi\n  options:\n    - "A"\n    - "B"\n'
  );
  try {
    await assert.rejects(
      () => chooseOption({ store, actor: ACTOR, turn: 't' }, { path: relPath, choice: 1 }),
      isActionError('unsupported')
    );
  } finally {
    store.close();
    await fs.rm(root, { recursive: true, force: true });
  }
});

test('chooseOption is reachable through createActionService (06 §8)', async () => {
  const { store, root, relPath } = await entityStore('type: chalk\nchoice:\n  - "A"\n  - "B"\n');
  try {
    const res = await service(store).chooseOption({ path: relPath, choice: 'B' });
    assert.equal(res.details.choice, 'B');
    assert.equal(res.details.event.type, 'choice_selected');
  } finally {
    store.close();
    await fs.rm(root, { recursive: true, force: true });
  }
});
