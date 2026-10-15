import fs from 'node:fs/promises';
import path from 'node:path';
import { LocalWorldStore, PLAYER_BOARD_PATH, isPlayerNotePath, parseFrontmatter, parseStateDecls, stringifyFrontmatter } from '@airp/shared';

/**
 * 试玩: a trial of a workshop draft always
 * plays the draft's LATEST content with everything play produced put back to
 * its opening. The play copy is made the way a template load makes one
 * (`worldCopyFilter` leaves history, sessions, the opening and intro markers
 * behind); what that copy cannot leave behind is play state written INTO
 * content files. This module takes it out again.
 *
 * What counts as play state, and the one rule each is reset by:
 *
 * - declared states (`states:` on player / world / characters/<id> READMEs):
 *   `status.data[id]` removed — absent reads as `initial`;
 * - the engine's own records on `world/README.md`: `status.data.ending`,
 *   `endingTurn`, `debrief`, and the frontmatter `trigger_log` / `cg_log`;
 * - the closed-world clock: `status.data[clock.key]` on `clock.path` set back
 *   to `clock.start`;
 * - dice: `roll_dice.result` / `.passed`, `dice_receipt`, `dice_grade`,
 *   `harm_receipt`, and a declared-outcome resolution (the `resolved-dice`
 *   marker and the text after it, and a `choice` made only of the options the
 *   resolution wrote);
 * - command receipts: `command_log` / `command_error` on any card;
 * - NPC cards: `dialogue`;
 * - the player's sticky notes (`world/**\/player-note-<n>.md`) and clue board
 *   (`player-board.json`);
 * - files play CREATED: search chalks (`search_source`), dice finds
 *   (`dice_reward`), and any file at a path a declared `give` creates (a give
 *   refuses to overwrite, so a file there can only be a previous give's);
 * - files play MOVED into the bag: taken back to the `world/` path they were
 *   picked up from, when that path is free (the draft's `entity_moved` events);
 * - a scene background a `swap_background` changed, when nothing changed it
 *   since (the draft's `background_swapped` events);
 * - in a copy only: nested `.pi/` session / memory stores (a character's).
 *
 * Anything that fits none of these is left as it is and, where it is
 * recognisably play, reported in `unresolved` rather than guessed at.
 */

export interface PlayMove { seq: number; from: string; to: string }
export interface PlaySwap { seq: number; layer: string; path: string; from?: string }
export interface PlayHistory { moves: PlayMove[]; swaps: PlaySwap[] }

export interface PlayResetReport {
  /** World-relative paths rewritten, deleted, or moved (`from → to`). */
  reset: string[];
  deleted: string[];
  moved: { from: string; to: string }[];
  /** Play traces this reset could not undo by a clean rule, with why. */
  unresolved: { path: string; reason: string }[];
}

export interface PlayResetOptions {
  /** The ORIGINAL's play history (moves / background swaps); a copy has none of its own. */
  history?: PlayHistory;
  /** Also drop nested `.pi/` stores (true for a play copy; the draft keeps its sessions). */
  dropRuntime?: boolean;
  /** Copy every markdown / json / yaml file here first (clearing the draft in place). */
  backupDir?: string;
  /** The world's own store when it is the active one (moves reuse it instead of opening a second). */
  store?: LocalWorldStore | null;
}

const EMPTY_HISTORY: PlayHistory = { moves: [], swaps: [] };

/** Engine bookkeeping on `world/README.md` `status.data` (closed worlds, debrief). */
const WORLD_STATUS_KEYS = ['ending', 'endingTurn', 'debrief'];
/** Engine bookkeeping on `world/README.md` itself (triggers fired, CGs seen, a living world's clock). */
const WORLD_LOG_KEYS = ['trigger_log', 'cg_log', 'living', 'tick'];
/** Receipts the engine writes on the card that ran something. */
const RECEIPT_KEYS = ['dice_receipt', 'dice_grade', 'harm_receipt', 'command_log', 'command_error'];
const RESOLVED_MARKER = /\n*<!-- resolved-dice:-?\d+ -->/;
const COLLECT_OPTION = /^collect-reward-\d+$/;

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

const isStateFile = (rel: string) =>
  rel === 'player/README.md' || rel === 'world/README.md' || /^characters\/[^/]+\/README\.md$/.test(rel);

/** Every file below `root` (POSIX, world-relative); dot-dirs and node_modules skipped. */
async function walk(root: string, dir = ''): Promise<string[]> {
  const entries = await fs.readdir(path.join(root, dir), { withFileTypes: true }).catch(() => []);
  const out: string[] = [];
  for (const entry of entries) {
    if (entry.name.startsWith('.') || entry.name === 'node_modules') continue;
    const rel = dir ? `${dir}/${entry.name}` : entry.name;
    if (entry.isDirectory()) out.push(...(await walk(root, rel)));
    else if (entry.isFile()) out.push(rel);
  }
  return out;
}

/** Nested `.pi/` directories (a character agent's session / memory), never the root one. */
async function nestedRuntimeDirs(root: string, dir = ''): Promise<string[]> {
  const entries = await fs.readdir(path.join(root, dir), { withFileTypes: true }).catch(() => []);
  const out: string[] = [];
  for (const entry of entries) {
    if (!entry.isDirectory() || entry.name === 'node_modules') continue;
    const rel = dir ? `${dir}/${entry.name}` : entry.name;
    if (entry.name === '.pi') { if (dir) out.push(rel); continue; }
    if (entry.name.startsWith('.')) continue;
    out.push(...(await nestedRuntimeDirs(root, rel)));
  }
  return out;
}

const exists = (file: string) => fs.stat(file).then(() => true, () => false);

/** Paths a declared `give` creates, collected from any parsed declaration (`{action: give, with: {path | rewards}}`). */
function giveTargets(value: unknown, out: Set<string>): void {
  if (Array.isArray(value)) { for (const item of value) giveTargets(item, out); return; }
  if (!isPlainObject(value)) return;
  if (value.action === 'give') {
    const args = isPlainObject(value.with) ? value.with : value;
    const add = (p: unknown) => { if (typeof p === 'string' && /^(world|player)\/[^{}$]+\.md$/.test(p) && !p.endsWith('/README.md')) out.add(p); };
    add(args.path);
    if (Array.isArray(args.rewards)) for (const r of args.rewards) if (isPlainObject(r)) add(r.path);
  }
  for (const child of Object.values(value)) giveTargets(child, out);
}

/** Where a file is now, following the play's moves forward from `start`. */
function followMoves(start: string, moves: readonly PlayMove[]): string {
  let at = start;
  for (const m of [...moves].sort((a, b) => a.seq - b.seq)) if (m.from === at) at = m.to;
  return at;
}

/** Where a file came from, following the play's moves backward from `now`. */
function originOf(now: string, moves: readonly PlayMove[]): string {
  let at = now;
  for (const m of [...moves].sort((a, b) => b.seq - a.seq)) if (m.to === at) at = m.from;
  return at;
}

/**
 * The option ids a declared-outcome resolution writes into `choice`: one
 * `collect-reward-<n>` per portable find, then the band's own options.
 */
function resolutionOptionIds(fm: Record<string, unknown>): Set<string> {
  const ids = new Set<string>();
  const bands = Array.isArray(fm.dice_outcomes) ? fm.dice_outcomes : [];
  for (const band of bands) {
    if (!isPlainObject(band) || !Array.isArray(band.options)) continue;
    for (const option of band.options) if (isPlainObject(option) && typeof option.id === 'string') ids.add(option.id);
  }
  return ids;
}

function optionIdsOf(choice: unknown): string[] | null {
  const options = Array.isArray(choice) ? choice : isPlainObject(choice) && Array.isArray(choice.options) ? choice.options : null;
  if (!options) return null;
  return options.map((o) => (isPlainObject(o) && typeof o.id === 'string' ? o.id : ''));
}

/** Drop `keys` from `status.data`; prune empty containers. Returns true when anything changed. */
function dropStatusData(fm: Record<string, unknown>, keys: Iterable<string>): boolean {
  if (!isPlainObject(fm.status) || !isPlainObject(fm.status.data)) return false;
  const data = { ...fm.status.data };
  let changed = false;
  for (const key of keys) if (key in data) { delete data[key]; changed = true; }
  if (!changed) return false;
  const status: Record<string, unknown> = { ...fm.status };
  if (Object.keys(data).length) status.data = data; else delete status.data;
  if (Object.keys(status).length) fm.status = status; else delete fm.status;
  return true;
}

/**
 * The play history of a world, read from its history store: the moves (to put
 * picked-up items back) and the background swaps. `active` is reused when it
 * is that world's store; otherwise a store is opened and closed again, and a
 * world that was never loaded (no history yet) has an empty history.
 */
export async function playHistoryOf(worldDir: string, active?: LocalWorldStore | null): Promise<PlayHistory> {
  const reuse = active && path.resolve(active.worldRoot) === path.resolve(worldDir) ? active : null;
  if (!reuse && !(await exists(path.join(worldDir, '.airpworld', 'history.db')))) return EMPTY_HISTORY;
  const store = reuse ?? new LocalWorldStore(worldDir);
  try {
    const events = await store.getEventsSince(0);
    const moves: PlayMove[] = [];
    const swaps: PlaySwap[] = [];
    for (const event of events) {
      const d = event.detail as Record<string, unknown>;
      if (event.type === 'entity_moved' && typeof d.from === 'string' && typeof d.to === 'string') moves.push({ seq: event.seq, from: d.from, to: d.to });
      if (event.type === 'background_swapped' && typeof d.layer === 'string' && typeof d.path === 'string') {
        swaps.push({ seq: event.seq, layer: d.layer, path: d.path, ...(typeof d.from === 'string' ? { from: d.from } : {}) });
      }
    }
    return { moves, swaps };
  } finally {
    if (!reuse) store.close();
  }
}

/** Copy every text file of the world (a superset of what a reset may touch, reference rewrites included). */
async function backup(worldDir: string, files: readonly string[], backupDir: string): Promise<void> {
  for (const rel of files) {
    if (!/\.(md|json|ya?ml)$/i.test(rel)) continue;
    const target = path.join(backupDir, rel);
    await fs.mkdir(path.dirname(target), { recursive: true });
    await fs.copyFile(path.join(worldDir, rel), target);
  }
}

/**
 * Put a world's play state back to its opening (see the module comment).
 * Idempotent: a second run over a reset world changes nothing.
 */
export async function resetPlayState(worldDir: string, options: PlayResetOptions = {}): Promise<PlayResetReport> {
  const history = options.history ?? EMPTY_HISTORY;
  const report: PlayResetReport = { reset: [], deleted: [], moved: [], unresolved: [] };
  const manifest = JSON.parse(await fs.readFile(path.join(worldDir, 'world.json'), 'utf8')) as Record<string, unknown>;
  const clock = isPlainObject(manifest.clock) && typeof manifest.clock.path === 'string' && typeof manifest.clock.key === 'string' && typeof manifest.clock.start === 'number'
    ? { path: manifest.clock.path, key: manifest.clock.key, start: manifest.clock.start }
    : null;

  const files = await walk(worldDir);
  if (options.backupDir) await backup(worldDir, files, options.backupDir);

  // 1. Parse every card once; collect what declared gives create.
  const cards = new Map<string, { fm: Record<string, unknown>; body: string }>();
  const gives = new Set<string>();
  giveTargets(manifest, gives);
  for (const rel of files) {
    const abs = path.join(worldDir, rel);
    if (rel.endsWith('.md')) {
      const parsed = parseFrontmatter(await fs.readFile(abs, 'utf8'));
      if (!parsed.frontmatter) continue;
      cards.set(rel, { fm: parsed.frontmatter, body: parsed.body });
      giveTargets(parsed.frontmatter, gives);
    } else if (/^command\/.+\.ya?ml$/.test(rel)) {
      giveTargets(parseFrontmatter(`---\n${await fs.readFile(abs, 'utf8')}\n---\n`).frontmatter, gives);
    }
  }

  // 2. Files play created: search chalks, dice finds, and whatever a give made (wherever it went since).
  const doomed = new Set<string>();
  for (const [rel, { fm }] of cards) if (fm.search_source != null || fm.dice_reward != null) doomed.add(rel);
  // The player's sticky notes and clue board.
  for (const rel of files) if (isPlayerNotePath(rel) || rel === PLAYER_BOARD_PATH) doomed.add(rel);
  for (const target of gives) {
    const now = followMoves(target, history.moves);
    if (cards.has(now) || files.includes(now)) doomed.add(now);
  }
  for (const rel of doomed) {
    await fs.rm(path.join(worldDir, rel), { force: true });
    cards.delete(rel);
    report.deleted.push(rel);
  }

  // 3. Items play carried into the bag go back where they were picked up.
  const inBag = [...cards.keys()].filter((rel) => rel.startsWith('player/') && rel !== 'player/README.md');
  const returns: { from: string; to: string }[] = [];
  for (const rel of inBag) {
    const origin = originOf(rel, history.moves);
    if (origin === rel || !origin.startsWith('world/')) continue;
    if (await exists(path.join(worldDir, origin))) { report.unresolved.push({ path: rel, reason: `picked up from ${origin}, which is taken again` }); continue; }
    if (!(await exists(path.join(worldDir, path.posix.dirname(origin))))) { report.unresolved.push({ path: rel, reason: `picked up from ${origin}, whose place no longer exists` }); continue; }
    returns.push({ from: rel, to: origin });
  }
  if (returns.length) {
    const own = options.store && path.resolve(options.store.worldRoot) === path.resolve(worldDir) ? options.store : null;
    const store = own ?? new LocalWorldStore(worldDir);
    try {
      for (const move of returns) {
        await store.moveFile(move.from, move.to);
        const card = cards.get(move.from)!;
        cards.delete(move.from);
        cards.set(move.to, card);
        report.moved.push(move);
      }
    } finally {
      if (!own) store.close();
    }
    // References to a moved item were rewritten on disk; reparse so step 4 never writes stale text.
    for (const rel of [...cards.keys()]) {
      const parsed = parseFrontmatter(await fs.readFile(path.join(worldDir, rel), 'utf8'));
      if (parsed.frontmatter) cards.set(rel, { fm: parsed.frontmatter, body: parsed.body });
    }
  }

  // 4. Values written into cards that stay.
  const swapsByReadme = new Map<string, PlaySwap[]>();
  for (const swap of history.swaps) {
    const readme = swap.layer === 'map' || swap.layer === 'world' ? 'world/README.md' : `${swap.layer}/README.md`;
    swapsByReadme.set(readme, [...(swapsByReadme.get(readme) ?? []), swap]);
  }
  for (const [rel, card] of cards) {
    const fm: Record<string, unknown> = { ...card.fm };
    let body = card.body;
    let changed = false;

    if (isPlainObject(fm.roll_dice) && ('result' in fm.roll_dice || 'passed' in fm.roll_dice)) {
      const { result: _r, passed: _p, ...rest } = fm.roll_dice;
      fm.roll_dice = rest;
      changed = true;
    }
    const resolved = RESOLVED_MARKER.exec(body);
    if (resolved) {
      body = `${body.slice(0, resolved.index).trimEnd()}\n`;
      changed = true;
    }
    if ('dice_grade' in fm) {
      const ids = optionIdsOf(fm.choice);
      const written = resolutionOptionIds(fm);
      if (ids && ids.every((id) => COLLECT_OPTION.test(id) || written.has(id))) {
        delete fm.choice;
        delete fm.choice_actions;
      } else if (ids) {
        report.unresolved.push({ path: rel, reason: 'the dice resolution replaced this card\'s own choice; its original options are not recorded' });
      }
      if (!resolved) report.unresolved.push({ path: rel, reason: 'a dice outcome text was appended without a marker; the body keeps it' });
    }
    for (const key of RECEIPT_KEYS) if (key in fm) { delete fm[key]; changed = true; }
    if (fm.type === 'npc' && 'dialogue' in fm) { delete fm.dialogue; changed = true; }

    if (isStateFile(rel)) {
      const declared = parseStateDecls(fm).states.map((s) => s.id);
      if (dropStatusData(fm, declared)) changed = true;
    }
    if (rel === 'world/README.md') {
      if (dropStatusData(fm, WORLD_STATUS_KEYS)) changed = true;
      for (const key of WORLD_LOG_KEYS) if (key in fm) { delete fm[key]; changed = true; }
    }
    if (clock && rel === clock.path) {
      const status = isPlainObject(fm.status) ? fm.status : {};
      const data = isPlainObject(status.data) ? status.data : {};
      // Absent already reads as `start`; only a written value is put back.
      if (clock.key in data && data[clock.key] !== clock.start) {
        fm.status = { ...status, data: { ...data, [clock.key]: clock.start } };
        changed = true;
      }
    }
    const swaps = swapsByReadme.get(rel);
    if (swaps?.length) {
      // Undo only the trailing run of swaps nobody overrode since: `bg` must still be the last one's.
      const ordered = [...swaps].sort((a, b) => a.seq - b.seq);
      if (fm.bg === ordered[ordered.length - 1].path) {
        let first = ordered.length - 1;
        while (first > 0 && ordered[first - 1].path === ordered[first].from) first -= 1;
        const original = ordered[first].from;
        if (original) fm.bg = original; else delete fm.bg;
        changed = true;
      } else {
        report.unresolved.push({ path: rel, reason: 'its background was swapped in play and changed again since' });
      }
    }

    if (!changed) continue;
    await fs.writeFile(path.join(worldDir, rel), stringifyFrontmatter(fm, body));
    report.reset.push(rel);
  }

  if (options.dropRuntime) {
    for (const dir of await nestedRuntimeDirs(worldDir)) await fs.rm(path.join(worldDir, dir), { recursive: true, force: true });
  }
  return report;
}
