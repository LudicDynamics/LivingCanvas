#!/usr/bin/env node
/**
 * Writer fast path — rebuild the world as it stood
 * at the start of every writer turn of one recorded session, so each turn can be
 * replayed against (nearly) the state the original agent saw.
 *
 *   node tools/writer-fast-path/replay-states.mjs <save-copy> <session.jsonl> <out-dir>
 *
 * NEVER point this at a real save: it reads <save-copy> and writes only <out-dir>.
 *
 * Method: start from the save's final state and walk BACKWARDS through time,
 * undoing everything that happened at or after each turn's start:
 *   - history events (any actor): entity_created → remove the file, entity_moved →
 *     move it back, entity_deleted → restore it when its content is known;
 *   - the writer's own successful tool calls from the session: native `edit`
 *     (newText → oldText, in reverse), `chalk append_to` (cut the appended
 *     paragraph), `write` of a command file that did not exist before;
 *   - an ending written into world/README.md (status.data.ending).
 * Then the history DB is cut to the events before the turn, and the writer's
 * read cursor is put back to the previous turn's start.
 *
 * Known gaps (reported in states/report.json): frontmatter the engine re-serialised
 * after an edit (command_log, YAML reflow) cannot always be undone byte-for-byte;
 * dice_consequence records stay; canvas.db (positions, links) is the final one.
 */
import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { fileURLToPath } from 'node:url';

const shared = await import(path.join(path.dirname(fileURLToPath(import.meta.url)), '../../packages/shared/dist/index.js'));

const [saveDir, sessionFile, outDir] = process.argv.slice(2);
if (!saveDir || !sessionFile || !outDir) {
  console.error('usage: replay-states.mjs <save-copy> <session.jsonl> <out-dir>');
  process.exit(2);
}

const KEEP = ['world', 'player', 'characters', 'command', 'endings', 'skills', 'world.json'];
const ms = (iso) => Date.parse(iso);

// ——— the session: turns + the writer's successful tool calls ———
const lines = fs.readFileSync(sessionFile, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l));
const sessionStart = ms(lines[0].timestamp);
const turns = [];
const calls = new Map();
const ops = []; // { at, kind, ... }
for (const entry of lines) {
  if (entry.type !== 'message') continue;
  const m = entry.message;
  if (m.role === 'user') {
    const text = m.content.filter((c) => c.type === 'text').map((c) => c.text).join('');
    turns.push({ index: turns.length, at: ms(entry.timestamp), iso: entry.timestamp, text });
  } else if (m.role === 'assistant') {
    for (const c of m.content) if (c.type === 'toolCall') calls.set(c.id, { name: c.name, args: c.arguments ?? {} });
  } else if (m.role === 'toolResult') {
    const call = calls.get(m.toolCallId);
    if (!call || m.isError) continue;
    const at = ms(entry.timestamp);
    const a = call.args;
    if (call.name === 'edit' && Array.isArray(a.edits)) ops.push({ at, kind: 'edit', path: a.path, edits: a.edits });
    else if (call.name === 'chalk' && a.append_to) ops.push({ at, kind: 'append', path: a.append_to, content: a.content });
    else if (call.name === 'write' && String(a.path).startsWith('command/')) ops.push({ at, kind: 'write-command', path: a.path });
    else if (call.name === 'chalk' && m.details?.created) ops.push({ at, kind: 'known-content', path: m.details.path, content: a.content, title: a.content.split('\n')[0] });
    else if (call.name === 'skill_check' && m.details?.path) ops.push({ at, kind: 'known-check', path: m.details.path, args: a, details: m.details });
  }
}

// ——— the history: everything since the session started ———
const hist = new DatabaseSync(path.join(saveDir, '.airpworld/history.db'), { readOnly: true });
const events = hist.prepare('SELECT seq, type, actor_type, subject, detail, created_at FROM events ORDER BY seq').all()
  .map((e) => ({ ...e, at: ms(e.created_at), detail: JSON.parse(e.detail) }));
hist.close();
for (const e of events) {
  if (e.at < sessionStart) continue;
  if (e.type === 'entity_created') ops.push({ at: e.at, kind: 'created', path: e.subject });
  else if (e.type === 'entity_moved') ops.push({ at: e.at, kind: 'moved', from: e.detail.from, to: e.detail.to });
  else if (e.type === 'entity_deleted') ops.push({ at: e.at, kind: 'deleted', path: e.subject });
  else if (e.type === 'ending_reached') ops.push({ at: e.at, kind: 'ending' });
}
ops.sort((x, y) => y.at - x.at); // newest first

// ——— work tree: a minimal copy of the final state ———
const work = path.join(outDir, '_work');
fs.rmSync(outDir, { recursive: true, force: true });
fs.mkdirSync(work, { recursive: true });
for (const k of KEEP) fs.cpSync(path.join(saveDir, k), path.join(work, k), { recursive: true });
const known = new Map(); // path → content for files that get deleted later
for (const op of ops) {
  if (op.kind === 'known-content') known.set(op.path, `---\ntype: chalk\ntitle: ${JSON.stringify(op.title)}\n---\n\n${op.content}\n`);
  if (op.kind === 'known-check') {
    const a = op.args;
    known.set(op.path, [
      '---', 'type: chalk', `title: ${JSON.stringify(a.title)}`,
      'roll_dice:', `  type: ${op.details.type}`, `  desc: ${JSON.stringify(`${op.details.label}: ${a.title}`)}`, `  expect: "${op.details.expect}"`,
      `skill: { id: ${op.details.skill}, actor: player }`, '---', '', a.body ?? '', '',
    ].join('\n'));
  }
}

const problems = [];
const abs = (p) => path.join(work, p);
const read = (p) => fs.readFileSync(abs(p), 'utf8');
const undo = (op) => {
  switch (op.kind) {
    case 'created':
      if (fs.existsSync(abs(op.path))) fs.rmSync(abs(op.path));
      return;
    case 'moved':
      if (fs.existsSync(abs(op.to))) { fs.mkdirSync(path.dirname(abs(op.from)), { recursive: true }); fs.renameSync(abs(op.to), abs(op.from)); }
      else problems.push({ op, why: 'moved file missing' });
      return;
    case 'deleted':
      if (known.has(op.path)) fs.writeFileSync(abs(op.path), known.get(op.path));
      else problems.push({ op, why: 'deleted content unknown' });
      return;
    case 'edit': {
      if (!fs.existsSync(abs(op.path))) { problems.push({ op: { ...op, edits: undefined }, why: 'edited file missing' }); return; }
      let text = read(op.path);
      for (const e of [...op.edits].reverse()) {
        const i = text.indexOf(e.newText);
        if (i < 0) { problems.push({ path: op.path, at: new Date(op.at).toISOString(), why: 'edit not reversible (file re-serialised)', newText: e.newText.slice(0, 80) }); continue; }
        text = text.slice(0, i) + e.oldText + text.slice(i + e.newText.length);
      }
      fs.writeFileSync(abs(op.path), text);
      return;
    }
    case 'append': {
      if (!fs.existsSync(abs(op.path))) return; // removed by a later undo of its creation (newer first)
      const text = read(op.path);
      const piece = op.content.trim();
      const i = text.lastIndexOf(piece);
      if (i < 0) { problems.push({ path: op.path, why: 'append not found' }); return; }
      fs.writeFileSync(abs(op.path), text.slice(0, i).replace(/\s+$/, '') + '\n' + text.slice(i + piece.length).replace(/^\s+/, ''));
      return;
    }
    case 'write-command': // a command the writer wrote mid-session did not exist before it
      if (fs.existsSync(abs(op.path))) fs.rmSync(abs(op.path));
      return;
    case 'ending': {
      const p = 'world/README.md';
      const text = read(p).replace(/\nstatus:\n  data:\n    ending: [^\n]+\n    endingTurn: [^\n]+/, '');
      fs.writeFileSync(abs(p), text);
      return;
    }
    default:
  }
};

// ——— walk backwards, freezing a state at each turn start ———
let cursor = 0;
const report = { session: path.basename(sessionFile), turns: [], problems };
for (let i = turns.length - 1; i >= 0; i--) {
  const t = turns[i];
  while (cursor < ops.length && ops[cursor].at >= t.at) undo(ops[cursor++]);
  const dir = path.join(outDir, `turn-${String(i).padStart(2, '0')}`);
  for (const k of KEEP) fs.cpSync(path.join(work, k), path.join(dir, k), { recursive: true });
  // A command that ran at or after the turn start left a `command_log` entry (its
  // idempotency record); without this cut the replay would see it as already done.
  for (const f of fs.readdirSync(path.join(dir, 'world'), { recursive: true }).map(String).filter((f) => f.endsWith('.md'))) {
    const p = path.join(dir, 'world', f);
    const raw = fs.readFileSync(p, 'utf8');
    if (!raw.includes('command_log:')) continue;
    const { frontmatter, body } = shared.parseFrontmatter(raw);
    const log = Array.isArray(frontmatter?.command_log) ? frontmatter.command_log : null;
    if (!log) continue;
    const kept = log.filter((e) => !(e?.at && ms(e.at) >= t.at));
    if (kept.length === log.length) continue;
    const next = { ...frontmatter };
    if (kept.length) next.command_log = kept; else delete next.command_log;
    fs.writeFileSync(p, shared.stringifyFrontmatter(next, body));
  }
  fs.mkdirSync(path.join(dir, '.airpworld'), { recursive: true });
  // Databases: copy (with WAL) and cut the history at the turn start.
  for (const f of ['history.db', 'history.db-wal', 'history.db-shm', 'canvas.db', 'canvas.db-wal', 'canvas.db-shm']) {
    const src = path.join(saveDir, '.airpworld', f);
    if (fs.existsSync(src)) fs.copyFileSync(src, path.join(dir, '.airpworld', f));
  }
  for (const d of ['loops']) {
    const src = path.join(saveDir, '.airpworld', d);
    if (fs.existsSync(src)) fs.cpSync(src, path.join(dir, '.airpworld', d), { recursive: true });
  }
  fs.symlinkSync(path.resolve(saveDir, 'assets'), path.join(dir, 'assets'));
  const db = new DatabaseSync(path.join(dir, '.airpworld/history.db'));
  db.prepare('DELETE FROM events WHERE created_at >= ?').run(t.iso);
  const prevStart = i > 0 ? turns[i - 1].iso : new Date(sessionStart).toISOString();
  const row = db.prepare('SELECT MAX(seq) AS s FROM events WHERE created_at < ?').get(prevStart);
  db.prepare("INSERT INTO read_cursors (reader, seq, updated_at) VALUES ('writer', ?, ?) ON CONFLICT(reader) DO UPDATE SET seq = excluded.seq, updated_at = excluded.updated_at").run(row?.s ?? 0, prevStart);
  const left = db.prepare('SELECT COUNT(*) AS n, MAX(seq) AS s FROM events').get();
  db.exec('PRAGMA wal_checkpoint(TRUNCATE)');
  db.close();
  const layer = /\[Current Layer\] (\S+)/.exec(t.text)?.[1] ?? null;
  report.turns.unshift({ index: i, at: t.iso, layer, events: left.n, maxSeq: left.s, cursor: row?.s ?? 0, request: t.text });
}
fs.rmSync(work, { recursive: true, force: true });
fs.writeFileSync(path.join(outDir, 'report.json'), JSON.stringify(report, null, 2));
console.log(`${turns.length} states in ${outDir}; ${problems.length} undo problems`);
for (const p of problems) console.log('  -', JSON.stringify(p).slice(0, 220));
