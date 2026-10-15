#!/usr/bin/env node
/**
 * check-ws-contract.mjs — mechanical cross-end gate for the live update channel.
 *
 * WHY THIS EXISTS
 * ---------------
 * The WebSocket frame channel has two ends in two processes (server broadcasts,
 * browser consumes) and no shared type. Nothing mechanically compared them, so
 * they drifted: the server deleted `item_moved` / `god_action` / `use_item_on`
 * and started broadcasting everything as `world_event`,
 * while `apps/web/src/state/useWorld.ts` kept listening for the deleted names
 * and never learned `world_event`. Both ends compiled; the feature was dead.
 *
 * This gate makes that class of drift impossible to ship silently. It compares:
 * 1. CONTRACT — the frozen frame list in `the design notes`.
 *   2. EMITTED  — every frame name the server actually broadcasts.
 *   3. CONSUMED — every frame name the browser actually reacts to.
 *
 * and reports four drift classes:
 *   GHOST      consumed but never emitted  → dead listener (the `item_moved` bug)
 *   UNCONSUMED emitted but never consumed  → dark frame (the `world_event` bug)
 *   UNDECLARED emitted but not in contract → contract is not the truth anymore
 *   MISSING    in contract but not emitted → promised frame never landed
 *
 * Usage:  node tools/check-ws-contract.mjs [--json]
 * Exit:   0 = clean, 1 = findings.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const REPO = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const JSON_OUT = process.argv.includes('--json');

/** The contract table lives here. */
const CONTRACT_DOC = 'docs/tools/12-工具注册与路由统一.md';

/** Files that broadcast a frame to the browser. Kept explicit: a new file that
 *  starts broadcasting MUST be added here, otherwise it escapes the gate. */
const EMITTERS = [
  'apps/server/src/engine/event-bridge.ts',
  'apps/server/src/engine/lifecycle.ts',
  'apps/server/src/index.ts',
  'apps/server/src/routes/world.ts',
];

/** Files that react to a frame. Same explicit-list discipline as EMITTERS. */
const CONSUMERS = [
  'apps/web/src/state/useWorld.ts',
  // App is the second real consumer: it reads `agent_progress` off the raw
  // `airp:agent-frame` relay (writer busy state) and `dice_result` off
  // `airp:dice-frame`. Scanning only useWorld would call those dark.
  'apps/web/src/App.tsx',
  // The nook realtime call consumes the character frames off the same
  // `airp:character-frame` relay useWorld dispatches.
  // The hook filters `character_delta`; NookView branches on all three.
  'apps/web/src/lib/live-call.ts',
  'apps/web/src/components/nook/NookView.tsx',
  // L2 moved the frame listener into the module-level
  // store, which now branches on delta/message/idle/error. `live-call.ts` keeps
  // its row: it is the binding layer and still names the frames it projects.
  'apps/web/src/lib/live-call-store.ts',
  // The dialogue overlay consumes the same frames; the L2 batch gates it at one
  // entry point (CharacterModal.tsx consumeCharacterFrameFromQueue).
  'apps/web/src/components/overlay/CharacterModal.tsx',
  // Not part of L2: pre-existing registration gaps where these files branch on
  // character frames but were never listed. Adding them is free (every name they
  // contribute is already consumed elsewhere) and restores the gate's coverage.
  'apps/web/src/components/overlay/dialogue-pages.ts',
  'apps/web/src/components/chrome/CanvasArrangeControl.tsx',
  // `writer-state.ts` is the one that moves the count: it consumes
  // `writer_message` (set({ lastMessage: frame.text })), so `consumed` goes
  // 24 → 25 (the design notes, §9.1(c)).
  'apps/web/src/lib/writer-state.ts',
];

/**
 * Frames that are deliberately NOT consumed by the browser today, with the
 * reason. Every entry is a decision, not an oversight — this list is the whole
 * point of the gate, so it MUST stay small and justified.
 */
const INTENTIONALLY_UNCONSUMED = new Map([
  ['connected', 'handshake marker; the socket already being open is the signal'],
  ['error', 'diagnostics go to the server console; a UI surface is unbuilt (frontend plan T3.x)'],
  ['turn_aborted', 'writer/character lane; the browser has no busy-state machine yet'],
  ['replay_entry', 'session replay recovery; unbuilt (frontend plan has no task for it)'],
  ['writer_message', 'retained for a non-streaming client; _delta is the live path'],
  ['character_message', 'retained for a non-streaming client; _delta is the live path'],
]);

/**
 * Frames the server DOES broadcast and the browser DOES NOT yet consume. These
 * are the live defect, reported one by one so the report names names.
 * Kept in sync with the audit doc; each is a pending frontend task.
 */
const KNOWN_DARK = new Set([
  'world_event',
  'writer_delta',
  'character_delta',
  'chalk_writing',
  'chalk_landed',
  'canvas_patched',
  'dice_result',
  'show_frame',
  'image_generation_progress',
  'image_landed',
  'writer_idle',
  'character_idle',
]);

const findings = [];
const report = (check, file, line, message, fix) => findings.push({ check, file, line, message, fix });

// ---------------------------------------------------------------- extraction
/** Every `'quoted'` literal in a `type:` position, ternaries included. */
function emittedFrom(text) {
  const out = new Map(); // frame -> first line number
  const lines = text.split('\n');
  // Only an actual broadcast call carries a frame. Matching bare `type:` would
  // pick up `typeof x === 'object'`, frontmatter `type: 'readme'`, and every
  // other type-shaped literal in the file.
  const CALL = /\b(?:broadcast|push|frameSink\?\.|send)\s*\(\s*(?:\{|[A-Za-z_$])|JSON\.stringify\(\s*\{|(?:const|let|var)\s+[A-Za-z_$][\w$]*[^=]*=\s*\{/;
  for (let i = 0; i < lines.length; i++) {
    if (!CALL.test(lines[i])) continue;
    // Gather the call's text until braces balance (bounded), so a multi-line
    // literal still resolves to its frame name.
    let depth = 0;
    let chunk = '';
    for (let j = i; j < Math.min(lines.length, i + 12); j++) {
      const l = lines[j];
      chunk += l + '\n';
      depth += (l.match(/\{/g) ?? []).length - (l.match(/\}/g) ?? []).length;
      if (depth <= 0) break;
    }
    for (const m of chunk.matchAll(/\btype\s*:\s*([^,\n}]*)/g)) {
      // The value is `'x'`, or `cond === 'a' ? 'b' : 'c'`. Only the TERNARY
      // BRANCHES are frame names; the `===` comparand is not, so keep the
      // literals after `?` only when a `?` is present.
      const expr = m[1];
      const branches = expr.includes('?') ? expr.slice(expr.indexOf('?') + 1) : expr;
      for (const q of branches.matchAll(/'([a-z][a-z_0-9]*)'/g)) {
        if (!out.has(q[1])) out.set(q[1], i + 1);
      }
    }
  }
  return out;
}

/** `case 'x'` labels count as WS frames only inside `switch (<expr>.type)`.
 *  A plain `case` can be an internal `airp:notice` ID (`detail.id`), not a frame.
 *  Relayed frame consumers may instead use `<expr>.type === 'x'`. */
function consumedFrom(text) {
  const out = new Map();
  let frameSwitch = false;
  const lines = text.split('\n');
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const header = /\bswitch\s*\(\s*([^)]*)\s*\)/.exec(line);
    if (header) frameSwitch = /\.type\s*$/.test(header[1].trim());
    for (const m of line.matchAll(/(?:case\s+|[A-Za-z_$][\w$]*\.type\s*===\s*)'([a-z][a-z_0-9]*)'/g)) {
      if (m[0].startsWith('case') && !frameSwitch) continue;
      if (!out.has(m[1])) out.set(m[1], i + 1);
    }
  }
  return out;
}

/** The contract's §6.2 frame list: the FIRST table only (deletion / rename
 *  sub-tables below it are not a promise that a frame is emitted). */
function contractFrom(text) {
  const out = new Map();
  const lines = text.split('\n');
  const start = lines.findIndex((l) => /^###\s*6\.2\b/.test(l));
  if (start === -1) return out;
  let started = false;
  for (let i = start + 1; i < lines.length; i++) {
    const line = lines[i];
    if (/^#{2,3}\s/.test(line)) break; // next section ends the whole block
    // The FIRST table is the promise. Once it has begun, a blank line ends it —
    // the tables below are "deleted frames" / "renamed frames", not promises.
    if (started && line.trim() === '') break;
    const row = /^\|\s*(.+?)\s*\|\s*(.+?)\s*\|/.exec(line);
    if (!row) continue;
    started = true;
    const [cell, payload] = [row[1], row[2]];
    if (/^(帧|frame|旧|new|方式)/.test(cell)) continue; // header + separator
    // A row whose payload cell is `——` documents a DELETED frame (`item_moved`,
    // `use_item_on`); the contract lists it to bury it, not to promise it.
    if (payload.replace(/[`*\s]/g, '') === '——') continue;
    // A first cell may list alternatives: `writer_delta / character_delta`.
    for (const tok of cell.split('/')) {
      const name = tok.replace(/[`*\s]/g, '');
      if (/^[a-z][a-z_0-9]*$/.test(name)) out.set(name, i + 1);
    }
  }
  // Two frames are not written as a `type:` literal at the call site:
  //  - `world_event` is declared by its shape in §6.3, not a §6.2 table row;
  //  - `chalk_landed` is built into a local `landed` object and pushed by name.
  for (const name of ['world_event', 'chalk_landed']) out.set(name, 0);
  return out;
}

const read = (rel) => fs.readFileSync(path.join(REPO, rel), 'utf-8');

/**
 * The pure comparison, exported so a test can drive it directly with synthetic
 * maps (the gate's own non-emptiness proof lives in
 * `tools/check-ws-contract.test.mjs`).
 *
 * `emitted` / `consumed` / `contract` are `Map<frame, {file,line} | number>`.
 */
export function compare({ emitted, consumed, contract, knownDark = new Set(), intentionallyUnconsumed = new Map(), contractDoc = CONTRACT_DOC }) {
  const out = [];
  const add = (check, file, line, message, fix) => out.push({ check, file, line, message, fix });

  // 1. ghosts — a listener for a frame nobody emits is dead code that reads as working.
  for (const [frame, where] of consumed) {
    if (emitted.has(frame)) continue;
    add('ghost', where.file, where.line,
      `listens for \`${frame}\` but no server file emits it`,
      'remove the dead case, or emit it from the server');
  }

  // 2. dark — emitted but nobody listens.
  for (const [frame, where] of emitted) {
    if (consumed.has(frame)) continue;
    if (intentionallyUnconsumed.has(frame)) continue;
    add('dark', where.file, where.line,
      `broadcasts \`${frame}\` but no browser file consumes it`,
      knownDark.has(frame)
        ? 'pending frontend task; wire it or mark it intentionally-unconsumed with a reason'
        : 'wire a consumer, or mark it intentionally-unconsumed with a reason');
  }

  // 3. undeclared — emitted but not in the contract: the contract is no longer the truth.
  for (const [frame, where] of emitted) {
    if (contract.has(frame)) continue;
    add('undeclared', where.file, where.line,
      `emits \`${frame}\` which is absent from ${contractDoc} §6.2`,
      'add the frame to the contract table (the contract MUST stay the truth)');
  }

  // 4. missing — promised by the contract, emitted by nobody.
  for (const [frame, line] of contract) {
    if (emitted.has(frame)) continue;
    add('missing', contractDoc, typeof line === 'number' ? line : 0,
      `contract lists \`${frame}\` but nothing emits it`,
      'implement the frame, or strike it from the contract');
  }
  return out;
}

// ---------------------------------------------------------------- main (direct run only)
// Guarded so a test can `import { compare }` without the gate scanning the repo
// and calling `process.exit`.
function main() {
  const emitted = new Map();
  for (const rel of EMITTERS) {
    for (const [frame, line] of emittedFrom(read(rel))) {
      if (!emitted.has(frame)) emitted.set(frame, { file: rel, line });
    }
  }

  const consumed = new Map();
  for (const rel of CONSUMERS) {
    for (const [frame, line] of consumedFrom(read(rel))) {
      if (!consumed.has(frame)) consumed.set(frame, { file: rel, line });
    }
  }

  const contract = contractFrom(read(CONTRACT_DOC));

  // `show_frame` is broadcast verbatim from a computed `details.frame` payload,
  // so the literal never appears in an emitter — the structural marker is proof.
  const bridge = read('apps/server/src/engine/event-bridge.ts');
  if (!emitted.has('show_frame') && bridge.includes('details.frame')) {
    emitted.set('show_frame', { file: 'apps/server/src/engine/event-bridge.ts', line: 0 });
  }

  for (const f of compare({
    emitted,
    consumed,
    contract,
    knownDark: KNOWN_DARK,
    intentionallyUnconsumed: INTENTIONALLY_UNCONSUMED,
  })) {
    report(f.check, f.file, f.line, f.message, f.fix);
  }

  const summary = {
    contract: contract.size,
    emitted: emitted.size,
    consumed: consumed.size,
    findings: findings.length,
  };
  const ORDER = { ghost: 0, dark: 1, undeclared: 2, missing: 3 };
  findings.sort((a, b) => ORDER[a.check] - ORDER[b.check] || a.file.localeCompare(b.file));

  if (JSON_OUT) {
    console.log(JSON.stringify({ findings, summary }, null, 2));
  } else if (!findings.length) {
    console.log(`check-ws-contract: clean (${summary.emitted} emitted, ${summary.consumed} consumed, ${summary.contract} in contract)`);
  } else {
    for (const f of findings) {
      console.log(`${f.check.toUpperCase().padEnd(10)} ${f.file}:${f.line}`);
      console.log(`           ${f.message}`);
      console.log(`           fix: ${f.fix}`);
    }
    console.log(`\ncheck-ws-contract: ${findings.length} finding(s) (${summary.emitted} emitted, ${summary.consumed} consumed, ${summary.contract} in contract)`);
  }
  return findings.length;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exit(main() ? 1 : 0);
}
