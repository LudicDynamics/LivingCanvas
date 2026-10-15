/**
 * Closed worlds, as the page sees them: the clock
 * and, once reached, the ending with its epilogue. Read-only — the clock moves
 * and the story ends only through the command engine (`tick` / `end`).
 */
import { Router } from 'express';
import {
  isPlayerNotePath,
  isOutcomeTier,
  parseConsequenceRecord,
  readPlayerBoard,
  clockLeft,
  clockTimeOf,
  debriefCluePaths,
  ENDING_RECORD_PATH,
  endingTextOf,
  normalizeDebriefAnswers,
  parseFrontmatter,
  publicMysteries,
  reachedEnding,
  readCgLog,
  scoreDebrief,
  stringifyFrontmatter,
  listBackpack,
  visitedScenes,
  type DebriefResult,
  type SceneLayer,
  type VisitedScene,
  type LocalWorldStore,
  type PublicMystery,
  type WorldManifest,
} from '@airp/shared';

/**
 * The 复盘 / debrief, present once an ending is
 * reached in a world that declares `mysteries`. `result` is null until the
 * player answers (or when they skipped it; they can come back to it).
 */
export interface ClosedRunDebrief {
  mysteries: PublicMystery[];
  result: DebriefResult | null;
}

/**
 * What the save keeps (world/README.md `status.data.debrief`): the answers and
 * which clue paths were in the save when they were given. The result is
 * recomputed from these, so it stays exactly what it was at submission, and a
 * rollback to before the ending removes it with the ending.
 */
interface DebriefRecord {
  answers: Record<string, string>;
  evidence: string[];
  unlocked: string[];
  at: string;
}

export interface ClosedRunSummary {
  /** First and last moment of this run (ISO), from the event log. */
  startedAt: string | null;
  endedAt: string | null;
  /** How much of the clock was spent; null when the world has no clock. */
  steps: { used: number; start: number } | null;
  /** The player's own moves this run (events acted by the player, after the last rollback, up to the ending). */
  turns: number;
  /** The same, as story time, when the clock declares `time` (e.g. "2 h 55 min passed"). */
  minutesPassed: number | null;
  /**
   * `outcome`: the shared tier; `consequence`:
   * what the tier cost or gave, from the card's record (大成功 / 大失败 only).
   */
  rolls: { name: string; result: number | null; passed: boolean | null; outcome?: string | null; consequence?: { direction: 'cost' | 'bonus'; what: string } | null }[];
  /** What the player carried out: every card in `player/` except its README. */
  clues: { path: string; name: string }[];
  /** The player's own deductions: sticky notes, clue-board lines, marks. */
  deductions?: { notes: number; lines: number; marks: number };
  /**
   * Every place under `world/`. Only the ones this run entered carry their
   * name; the rest show as ？？？.
   */
  places: { layer: string; name: string | null; visited: boolean }[];
  /** Every ending of the world. Only the one reached here carries its title — the rest stay unspoiled. */
  endings: { id: string; title: string | null; reached: boolean }[];
}

export interface ClosedRunState {
  mode: 'open' | 'semi' | 'closed';
  /**
   * `now` / `deadline` / `remainingMinutes` are present when world.json gives
   * the clock a `time` span: the player sees a time of night, not a step count.
   */
  clock: {
    label: string;
    left: number;
    start: number;
    now?: string;
    deadline?: string;
    remainingMinutes?: number;
  } | null;
  ending: { id: string; title: string; body: string; bg: string | null } | null;
  /** The settlement; present once an ending is reached. */
  summary: ClosedRunSummary | null;
  /** The debrief; null before an ending, or when the world declares no mysteries. */
  debrief: ClosedRunDebrief | null;
  /**
   * The CGs this save has shown (`cg_log`, the design notes), in the
   * order last seen. Filled once an ending is reached — the epilogue's gallery.
   */
  cgs: { path: string; caption?: string }[];
  /**
   * What the page's two presentations compare between reads
   *: the scenes this save has entered,
   * in first-entry order, and the bag. Facts only — no counts, no progress.
   */
  moments: RunMoments;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

async function readDebriefRecord(store: LocalWorldStore): Promise<DebriefRecord | null> {
  if ((await store.statKind(ENDING_RECORD_PATH)) !== 'file') return null;
  const fm = parseFrontmatter(await store.readFile(ENDING_RECORD_PATH)).frontmatter ?? {};
  const status = isPlainObject(fm.status) ? fm.status : {};
  const data = isPlainObject(status.data) ? status.data : {};
  const raw = data.debrief;
  if (!isPlainObject(raw) || !isPlainObject(raw.answers)) return null;
  const answers = Object.fromEntries(Object.entries(raw.answers).filter(([, v]) => typeof v === 'string')) as Record<string, string>;
  const evidence = Array.isArray(raw.evidence) ? raw.evidence.filter((p): p is string => typeof p === 'string') : [];
  const unlocked = Array.isArray(raw.unlocked) ? raw.unlocked.filter((p): p is string => typeof p === 'string') : [];
  return { answers, evidence, unlocked, at: typeof raw.at === 'string' ? raw.at : '' };
}

async function debriefOf(store: LocalWorldStore, manifest: WorldManifest, record: DebriefRecord | null): Promise<ClosedRunDebrief | null> {
  const mysteries = manifest.mysteries ?? [];
  if (mysteries.length === 0) return null;
  const result = record ? scoreDebrief(mysteries, record.answers, new Set(record.evidence), manifest.reckoning) : null;
  if (result) await nameProofs(store, result);
  return { mysteries: publicMysteries(mysteries), result };
}

/**
 * The settlement names the clue that proved each unlocked secret. The proof is
 * a save path recorded at submission; the card may since have been carried
 * (world/… → player/…), so the carried copy is tried too, and a card that is
 * gone entirely falls back to its file name.
 */
async function nameProofs(store: LocalWorldStore, result: DebriefResult): Promise<void> {
  for (const m of result.mysteries) {
    if (!m.proof) continue;
    const file = m.proof.split('/').pop() ?? m.proof;
    let name: string | null = null;
    for (const p of [m.proof, `player/${file}`]) {
      if ((await store.statKind(p)) !== 'file') continue;
      const fm = parseFrontmatter(await store.readFile(p)).frontmatter ?? {};
      name = typeof fm.name === 'string' ? fm.name : typeof fm.title === 'string' ? fm.title : null;
      if (name) break;
    }
    m.proofName = name ?? file.replace(/\.md$/, '');
  }
}

export class DebriefError extends Error {
  constructor(readonly status: number, readonly code: string, message: string) {
    super(message);
  }
}

/**
 * Answer the debrief. Only after an ending; once per run (a rollback to before
 * the ending clears it). Never changes the ending — it scores the run and
 * records which secrets were unlocked, for the settlement and the epilogues.
 */
export async function submitDebrief(store: LocalWorldStore, rawAnswers: unknown, now = new Date()): Promise<ClosedRunState> {
  const manifest = await store.getManifest();
  const mysteries = manifest.mysteries ?? [];
  if (mysteries.length === 0) throw new DebriefError(404, 'no_debrief', 'This world has no debrief.');
  if (!(await reachedEnding(store, manifest))) throw new DebriefError(409, 'not_ended', 'The debrief opens after an ending.');
  if (await readDebriefRecord(store)) throw new DebriefError(409, 'already_answered', 'This run has already been debriefed.');
  const parsed = normalizeDebriefAnswers(rawAnswers, mysteries);
  if (!parsed.ok) throw new DebriefError(400, 'invalid_answers', parsed.error);
  const evidence: string[] = [];
  for (const p of debriefCluePaths(mysteries)) if ((await store.statKind(p)) === 'file') evidence.push(p);
  const result = scoreDebrief(mysteries, parsed.answers, new Set(evidence), manifest.reckoning);
  const record: DebriefRecord = {
    answers: parsed.answers,
    evidence,
    unlocked: result.mysteries.filter((m) => m.verdict === 'surface' || m.verdict === 'hidden').map((m) => m.id),
    at: now.toISOString(),
  };
  const page = parseFrontmatter(await store.readFile(ENDING_RECORD_PATH));
  const fm = page.frontmatter ?? {};
  const status = isPlainObject(fm.status) ? fm.status : {};
  const data = isPlainObject(status.data) ? status.data : {};
  // Written straight to the file, not through the action service: once the
  // story has ended the service only admits conversation, and the debrief is
  // bookkeeping about the ended run, not an act in the story.
  await store.writeFileAtomic(
    ENDING_RECORD_PATH,
    stringifyFrontmatter({ ...fm, status: { ...status, data: { ...data, debrief: record } } }, page.body),
  );
  return closedRunState(store);
}

export async function closedRunState(store: LocalWorldStore): Promise<ClosedRunState> {
  const manifest = await store.getManifest();
  const mode = manifest.mode ?? 'open';
  const left = await clockLeft(store, manifest);
  const time = manifest.clock && left !== null ? clockTimeOf(manifest.clock, left) : null;
  const clock = manifest.clock && left !== null
    ? {
        label: manifest.clock.label,
        left,
        start: manifest.clock.start,
        ...(time ? { now: time.now, deadline: time.deadline, remainingMinutes: time.remainingMinutes } : {}),
      }
    : null;
  const reached = await reachedEnding(store, manifest);
  let ending: ClosedRunState['ending'] = null;
  if (reached) {
    // The body, then the `passages` whose condition holds for this run (shared/actions/ending-text.ts).
    const { body, bg } = await endingTextOf(store, reached.path);
    ending = { id: reached.id, title: reached.title, body, bg };
  }
  const summary = reached ? await settle(store, manifest, reached.id, clock, time?.elapsedMinutes ?? null) : null;
  const debrief = reached ? await debriefOf(store, manifest, await readDebriefRecord(store)) : null;
  const cgs = reached
    ? (await readCgLog(store)).map((e) => ({ path: e.path, ...(e.caption ? { caption: e.caption } : {}) }))
    : [];
  const moments = await runMoments(store, manifest);
  return { mode, clock, ending, summary, debrief, cgs, moments };
}

const VIDEO_RE = /\.(webm|mp4)$/i;

function fmString(fm: Record<string, unknown>, key: string): string | null {
  const v = fm[key];
  if (typeof v !== 'string') return null;
  const cleaned = v.replace(/\s+#.*$/, '').trim().replace(/^["']|["']$/g, '').trim();
  return cleaned === '' ? null : cleaned;
}

/** One item in the bag, as the item presentation shows it. */
export interface MomentItem {
  path: string;
  filename: string;
  name: string;
  /** Only the keys the item artwork reads (`image`, `cover`, `icon`, `type`, `visual`). */
  frontmatter: Record<string, unknown>;
  /** The first paragraph of the body, shortened. */
  summary: string | null;
}

export interface RunMoments {
  scenes: VisitedScene[];
  items: MomentItem[];
}

const ART_KEYS = ['image', 'cover', 'icon', 'type', 'visual'] as const;
const SUMMARY_MAX = 160;

function summaryOf(body: string): string | null {
  const para = body.split(/\n\s*\n/).map((p) => p.replace(/\s+/g, ' ').trim()).find((p) => p !== '' && !p.startsWith('#'));
  if (!para) return null;
  return para.length > SUMMARY_MAX ? `${para.slice(0, SUMMARY_MAX - 1)}…` : para;
}

/**
 * The facts behind the two presentations: scenes entered (since the last
 * rollback) with their name and pictures, and what is in the bag now.
 */
export async function runMoments(store: LocalWorldStore, manifest: WorldManifest): Promise<RunMoments> {
  const all = await store.getEventsSince(0);
  let from = 0;
  all.forEach((e, i) => { if (e.type === 'world_rolled_back') from = i + 1; });
  const entered = all
    .slice(from)
    .filter((e) => e.type === 'layer_entered')
    .map((e) => String((e.detail as Record<string, unknown>)?.layer ?? e.layer ?? ''))
    .filter((l) => l !== '');
  const layers: SceneLayer[] = [];
  for (const dir of (await store.listDirs('world')).sort()) {
    const readme = `${dir}/README.md`;
    if ((await store.statKind(readme)) !== 'file') continue;
    let fm: Record<string, unknown> = {};
    try {
      fm = parseFrontmatter(await store.readFile(readme)).frontmatter ?? {};
    } catch {
      fm = {};
    }
    const bg = fmString(fm, 'bg');
    const bgVideo = fmString(fm, 'bgVideo');
    layers.push({
      layer: dir,
      name: fmString(fm, 'name') ?? fmString(fm, 'title') ?? dir.split('/').pop() ?? dir,
      bg: bg && !VIDEO_RE.test(bg) ? bg : null,
      video: bgVideo && VIDEO_RE.test(bgVideo) ? bgVideo : bg && VIDEO_RE.test(bg) ? bg : null,
    });
  }
  const scenes = visitedScenes({ layers, entered, start: manifest.entry ?? 'map' });
  const items: MomentItem[] = (await listBackpack(store))
    .sort((a, b) => a.path.localeCompare(b.path))
    .map((item) => {
      const fm = (item.frontmatter ?? {}) as Record<string, unknown>;
      const name = fmString(fm, 'title') ?? fmString(fm, 'name') ?? item.filename.replace(/\.(md|html)$/i, '');
      const art: Record<string, unknown> = {};
      for (const k of ART_KEYS) if (fm[k] !== undefined) art[k] = fm[k];
      return { path: item.path, filename: item.filename, name, frontmatter: art, summary: summaryOf(item.body ?? '') };
    });
  return { scenes, items };
}

/**
 * The settlement screen's numbers, read back from what actually happened: the
 * event log (since the last rollback — a rolled-back attempt is not part of
 * this run) and the bag as it stands now.
 */
async function settle(
  store: LocalWorldStore,
  manifest: Awaited<ReturnType<LocalWorldStore['getManifest']>>,
  endingId: string,
  clock: ClosedRunState['clock'],
  minutesPassed: number | null,
): Promise<ClosedRunSummary> {
  const all = await store.getEventsSince(0);
  let from = 0;
  all.forEach((e, i) => { if (e.type === 'world_rolled_back') from = i + 1; });
  const events = all.slice(from);
  const endedAt = events.findIndex((e) => e.type === 'ending_reached');
  const ended = endedAt >= 0 ? events[endedAt] : undefined;
  const turns = (endedAt >= 0 ? events.slice(0, endedAt) : events).filter((e) => e.actor?.type === 'player').length;
  const rolls: ClosedRunSummary['rolls'] = [];
  for (const e of events.filter((ev) => ev.type === 'roll_resolved')) {
    const d = (e.detail ?? {}) as Record<string, unknown>;
    const outcome = isOutcomeTier(d.outcome) ? d.outcome : null;
    let consequence: { direction: 'cost' | 'bonus'; what: string } | null = null;
    if ((outcome === 'crit_fail' || outcome === 'crit_success') && typeof d.path === 'string' && (await store.statKind(d.path)) === 'file') {
      const rec = parseConsequenceRecord((parseFrontmatter(await store.readFile(d.path)).frontmatter ?? {}).dice_consequence);
      const want = outcome === 'crit_fail' ? 'cost' : 'bonus';
      const paid = rec?.applied.filter((a) => a.direction === want) ?? [];
      if (paid.length) consequence = { direction: want, what: paid.map((a) => a.what).join(' · ') };
    }
    rolls.push({
      name: typeof d.name === 'string' ? d.name : String(e.subject ?? ''),
      result: typeof d.result === 'number' ? d.result : null,
      passed: typeof d.passed === 'boolean' ? d.passed : null,
      outcome,
      consequence,
    });
  }
  const entered = new Set(
    events
      .filter((e) => e.type === 'layer_entered')
      .map((e) => String((e.detail as Record<string, unknown>)?.layer ?? e.layer ?? '')),
  );
  const places: ClosedRunSummary['places'] = [];
  for (const dir of (await store.listDirs('world')).sort()) {
    // The root is where every run starts, not a place to find.
    if (dir === 'world') continue;
    const readme = `${dir}/README.md`;
    if ((await store.statKind(readme)) !== 'file') continue;
    const visited = entered.has(dir);
    let name: string | null = null;
    if (visited) {
      const fm = parseFrontmatter(await store.readFile(readme)).frontmatter ?? {};
      name = typeof fm.name === 'string' ? fm.name : typeof fm.title === 'string' ? fm.title : dir.split('/').pop() ?? dir;
    }
    places.push({ layer: dir, name, visited });
  }
  const clues: ClosedRunSummary['clues'] = [];
  for (const path of (await store.listFiles('player')).sort()) {
    if (!path.endsWith('.md') || path.endsWith('/README.md') || path.split('/').length !== 2) continue;
    const fm = parseFrontmatter(await store.readFile(path)).frontmatter ?? {};
    const name = typeof fm.name === 'string' ? fm.name : typeof fm.title === 'string' ? fm.title : path.slice('player/'.length, -3);
    clues.push({ path, name });
  }
  const board = await readPlayerBoard(store);
  const deductions = {
    notes: (await store.listFiles('world')).filter((p) => isPlayerNotePath(p)).length,
    lines: board.links.length,
    marks: Object.keys(board.tags).length,
  };
  return {
    startedAt: all[0]?.createdAt ?? null,
    endedAt: ended?.createdAt ?? null,
    steps: clock ? { used: clock.start - clock.left, start: clock.start } : null,
    turns,
    minutesPassed,
    rolls,
    places,
    clues,
    deductions,
    endings: (manifest.endings ?? []).map((e) => ({
      id: e.id,
      title: e.id === endingId ? e.title : null,
      reached: e.id === endingId,
    })),
  };
}

export function createClosedRunRouter(getStore: () => LocalWorldStore | null): Router {
  const router = Router();
  router.get('/world/run', async (_req, res) => {
    const store = getStore();
    if (!store) {
      res.status(404).json({ ok: false, error: 'No world is loaded.' });
      return;
    }
    try {
      res.json({ ok: true, ...(await closedRunState(store)) });
    } catch (err) {
      res.status(500).json({ ok: false, error: err instanceof Error ? err.message : String(err) });
    }
  });
  router.post('/world/debrief', async (req, res) => {
    const store = getStore();
    if (!store) {
      res.status(404).json({ ok: false, error: 'No world is loaded.' });
      return;
    }
    try {
      const body = (req.body ?? {}) as { answers?: unknown };
      res.json({ ok: true, ...(await submitDebrief(store, body.answers)) });
    } catch (err) {
      if (err instanceof DebriefError) {
        res.status(err.status).json({ ok: false, code: err.code, error: err.message });
        return;
      }
      res.status(500).json({ ok: false, error: err instanceof Error ? err.message : String(err) });
    }
  });
  return router;
}
