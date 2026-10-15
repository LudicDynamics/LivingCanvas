/**
 * Writer fast path — the reply.
 *
 *   chalkTextExtractor — pulls the decoded `"text"` out of the streaming JSON, so
 *                        the first character can go on screen before the rest
 *                        of the answer exists;
 *   parseFastReply     — the first complete JSON object (a model sometimes
 *                        appends half a second one);
 *   validateFastReply  — same semantics as the writer tools, checked against the
 *                        place. Chalk problems are FIXED in place (the prose may
 *                        already be on screen); op problems go to one repair;
 *   executeFastTurn    — chalk + ops through the real action service, as the
 *                        writer. An op the engine refuses is reported, never thrown.
 *
 * There is no `grant` op any more: a declared find comes only from a declared
 * spot's roll (`search`, or `skill_check` bound to the spot), paid by the engine
 * when the player rolls.
 */
import { parseFrontmatter } from '../schemas/frontmatter.js';
import type { LocalWorldStore } from '../store/local-store.js';
import type { ActionService } from '../actions/service.js';
import { parseSearchDeclarations } from '../actions/search.js';
import { fireKeywordTrigger } from '../commands/world-triggers.js';
import { declaredOptions, placeFiles, type FastPathPack } from './pack.js';

type Fm = Record<string, any>;

/** Incrementally pulls the decoded value of `"text":"…"` out of a growing JSON string. */
export function chalkTextExtractor(): { push(delta: string): string; readonly text: string; readonly done: boolean } {
  let buf = '';
  let start = -1;
  let pos = 0;
  let out = '';
  let done = false;
  return {
    push(delta: string): string {
      buf += delta;
      if (done) return '';
      if (start < 0) {
        const m = /"text"\s*:\s*"/.exec(buf);
        if (!m) return '';
        start = m.index + m[0].length;
        pos = start;
      }
      let fresh = '';
      while (pos < buf.length) {
        const ch = buf[pos];
        if (ch === '\\') {
          if (pos + 1 >= buf.length) break;
          const nx = buf[pos + 1];
          if (nx === 'u') {
            if (pos + 6 > buf.length) break;
            fresh += String.fromCharCode(parseInt(buf.slice(pos + 2, pos + 6), 16));
            pos += 6;
            continue;
          }
          fresh += ({ n: '\n', t: '\t', r: '', '"': '"', '\\': '\\', '/': '/', b: '', f: '' } as Record<string, string>)[nx] ?? nx;
          pos += 2;
          continue;
        }
        if (ch === '"') {
          done = true;
          break;
        }
        fresh += ch;
        pos++;
      }
      out += fresh;
      return fresh;
    },
    get text() { return out; },
    get done() { return done; },
  };
}

/** The first balanced top-level JSON object in `raw`. */
export function firstJsonObject(raw: string): string | null {
  const start = raw.indexOf('{');
  if (start < 0) return null;
  let depth = 0;
  let inStr = false;
  for (let i = start; i < raw.length; i++) {
    const ch = raw[i];
    if (inStr) {
      if (ch === '\\') i++;
      else if (ch === '"') inStr = false;
      continue;
    }
    if (ch === '"') inStr = true;
    else if (ch === '{') depth++;
    else if (ch === '}' && --depth === 0) return raw.slice(start, i + 1);
  }
  return null;
}

export interface FastChalk {
  append_to?: string | null;
  title?: string;
  text: string;
  options?: Array<{ id?: string; label?: string; enter?: string }>;
}
export interface FastOp {
  op: string;
  [key: string]: unknown;
}
export interface FastReply {
  route: 'fast' | 'agent';
  chalk: FastChalk | null;
  ops: FastOp[];
  why: string;
}

export function parseFastReply(raw: string): FastReply | { error: string } {
  let obj: any;
  try {
    obj = JSON.parse(raw);
  } catch (e) {
    try {
      obj = JSON.parse(firstJsonObject(raw) ?? '');
    } catch {
      return { error: `not JSON: ${(e as Error).message}` };
    }
  }
  if (!obj || typeof obj !== 'object' || Array.isArray(obj)) return { error: 'not an object' };
  const route = obj.route === 'agent' ? 'agent' : 'fast';
  const chalk = obj.chalk && typeof obj.chalk === 'object' && typeof obj.chalk.text === 'string' && obj.chalk.text.trim() ? (obj.chalk as FastChalk) : null;
  const ops = Array.isArray(obj.ops) ? (obj.ops as unknown[]).filter((o): o is FastOp => !!o && typeof o === 'object' && typeof (o as FastOp).op === 'string') : [];
  return { route, chalk, ops, why: typeof obj.why === 'string' ? obj.why : '' };
}

/** The ops a fast reply may carry (the rest are agent-only: they change the world's shape). */
export const FAST_OPS = ['choose', 'search', 'skill_check', 'use_item_on', 'take', 'note', 'move_to', 'link', 'trigger_keyword', 'dice_consequence'] as const;

interface PlaceFacts {
  files: Set<string>;
  cards: Map<string, Fm>;
  raws: Map<string, string>;
  spots: Set<string>;
  rewardTitles: Set<string>;
  /** The quoted lines (「…」) of every declared reward body: the words of the world's key finds. */
  rewardLines: Set<string>;
  skills: Set<string>;
  bag: Set<string>;
}

async function placeFacts(store: LocalWorldStore, pack: FastPathPack): Promise<PlaceFacts> {
  const files = await placeFiles(store, pack.dir);
  const raws = new Map<string, string>();
  const cards = new Map<string, Fm>();
  for (const f of files) {
    const raw = await store.readFile(f).catch(() => '');
    raws.set(f, raw);
    try { cards.set(f, (parseFrontmatter(raw).frontmatter as Fm | null) ?? {}); } catch { cards.set(f, {}); }
  }
  const readme = cards.get(`${pack.dir}/README.md`) ?? {};
  const { spots } = parseSearchDeclarations(readme);
  const rewardTitles = new Set<string>();
  const rewardLines = new Set<string>();
  for (const s of spots) for (const band of (s.dice_outcomes ?? []) as Fm[]) for (const r of (band?.rewards ?? []) as Fm[]) {
    if (r?.title) rewardTitles.add(String(r.title));
    for (const m of String(r?.body ?? '').matchAll(/「([^」]{4,})」/g)) rewardLines.add(norm(m[1]));
  }
  let sheet: Fm[] = [];
  try {
    const raw = (await store.statKind('player/README.md')) === 'file' ? await store.readFile('player/README.md') : '';
    sheet = ((parseFrontmatter(raw).frontmatter as Fm | null)?.sheet?.skills ?? []) as Fm[];
  } catch {
    sheet = [];
  }
  return {
    files: new Set(files),
    cards,
    raws,
    spots: new Set(spots.map((s) => s.id)),
    rewardTitles,
    rewardLines,
    skills: new Set(sheet.map((s) => String(s?.id ?? ''))),
    bag: new Set(await placeFiles(store, 'player')),
  };
}

export interface FastValidation {
  ok: FastOp[];
  problems: Array<{ op: FastOp; why: string }>;
  fixes: Array<{ where: string; why: string }>;
  warnings: string[];
}

const norm = (s: unknown): string => String(s ?? '').replace(/[\s·「」『』“”"'（）()，,。.]/g, '');

/**
 * Checks a reply against the place. Chalk problems are FIXED in place: a bad
 * append target becomes a new card, a bad option is stripped. Op problems are
 * returned for one repair round. `warnings` never change anything.
 */
export async function validateFastReply(store: LocalWorldStore, pack: FastPathPack, reply: FastReply): Promise<FastValidation> {
  const facts = await placeFacts(store, pack);
  const problems: FastValidation['problems'] = [];
  const fixes: FastValidation['fixes'] = [];
  const warnings: string[] = [];
  const ok: FastOp[] = [];
  if (reply.chalk && pack.quiet) {
    fixes.push({ where: 'chalk', why: 'a Quiet Beat lands no chalk' });
    reply.chalk = null;
  }
  if (reply.chalk) {
    const c = reply.chalk;
    const target = c.append_to ? facts.cards.get(c.append_to) : undefined;
    if (c.append_to && !(facts.files.has(c.append_to) && target?.type === 'chalk')) {
      fixes.push({ where: 'chalk.append_to', why: `${c.append_to} is not a chalk card here → new card` });
      c.append_to = null;
    } else if (target && (target.intent || target.on || target.search || target.roll_dice || target.choice_actions)) {
      fixes.push({ where: 'chalk.append_to', why: `${c.append_to} is an authored / interactive card → new card` });
      c.append_to = null;
    }
    const declared = new Set<string>();
    for (const [f, raw] of facts.raws) if (f !== c.append_to) for (const o of declaredOptions(raw)) declared.add(norm(o.label));
    c.options = (Array.isArray(c.options) ? c.options : []).filter((o) => {
      if (!o?.label || !o?.id) { fixes.push({ where: 'chalk.options', why: 'option without id/label stripped' }); return false; }
      if (!/^[a-z0-9][a-z0-9-]{0,63}$/.test(String(o.id))) { fixes.push({ where: `chalk.options.${o.id}`, why: 'option id must be kebab-case → stripped' }); return false; }
      if (o.enter && !pack.exits.has(o.enter)) { fixes.push({ where: `chalk.options.${o.id}`, why: `enter ${o.enter} is not a listed exit → stripped` }); return false; }
      if (!o.enter && declared.has(norm(o.label))) { fixes.push({ where: `chalk.options.${o.id}`, why: `copies a declared option "${o.label}" → stripped` }); return false; }
      return true;
    }).slice(0, 3);
    const last = c.text.trim().split('\n').pop() ?? '';
    if (/[？?]\s*$/.test(c.text.trim()) && /(要不要|你要|你打算|怎么办|是否)/.test(last)) warnings.push('passage ends by asking the player');
  }
  if (pack.quiet && reply.ops.length > 1) {
    fixes.push({ where: 'ops', why: 'a Quiet Beat makes at most one change' });
    reply.ops = reply.ops.slice(0, 1);
  }
  for (const op of reply.ops) {
    const bad = (why: string) => problems.push({ op, why });
    switch (op.op) {
      case 'choose': {
        const path = String(op.path ?? '');
        const raw = facts.raws.get(path);
        if (raw === undefined) { bad(`${path} is not a card here`); break; }
        const opts = declaredOptions(raw);
        const picked = opts.find((o) => o.id === op.option || o.label === op.option);
        if (!picked) { bad(`${path} declares no option "${String(op.option)}" (has: ${opts.map((o) => o.id ?? o.index).join(', ')})`); break; }
        const client = picked.id ? facts.cards.get(path)?.choice_actions?.[picked.id] : undefined;
        if (client) { bad(`"${picked.label}" is a button-side action (${client.kind}); choose only records it — use ${client.kind === 'search' ? `op search with spot ${client.spot}` : 'an enter option on the chalk'}`); break; }
        const preview = pack.previews.find((p) => p.path === path && p.preview.option.label === picked.label)?.preview;
        if (preview && (preview.verdict === 'nothing' || preview.verdict === 'already_done')) warnings.push(`choose ${path}#${picked.id ?? picked.index}: the dry run says it ${preview.verdict === 'nothing' ? 'does nothing now' : 'was already done'}`);
        ok.push(op);
        break;
      }
      case 'search':
        if (!facts.spots.has(String(op.spot))) bad(`no declared search spot "${String(op.spot)}" here (has: ${[...facts.spots].join(', ') || 'none'})`);
        else ok.push(op);
        break;
      case 'skill_check':
        if (!facts.skills.has(String(op.skill)) && op.skill !== 'sanity') bad(`skill "${String(op.skill)}" is not on the sheet (${[...facts.skills].join(', ')})`);
        else if (!op.title) bad('title missing');
        else if (op.spot !== undefined && op.spot !== null && op.spot !== '' && !facts.spots.has(String(op.spot))) bad(`no declared search spot "${String(op.spot)}" here (has: ${[...facts.spots].join(', ') || 'none'})`);
        else ok.push(op);
        break;
      case 'use_item_on':
        if (!facts.bag.has(String(op.item))) bad(`${String(op.item)} is not in the bag`);
        else if (!facts.files.has(String(op.target))) bad(`${String(op.target)} is not a card here`);
        else ok.push(op);
        break;
      case 'take':
        if (!facts.files.has(String(op.path)) || String(op.path).endsWith('README.md')) bad(`${String(op.path)} is not a loose card here`);
        else if (facts.cards.get(String(op.path))?.type === 'npc') bad('a person cannot be taken');
        else ok.push(op);
        break;
      case 'note': {
        const t = norm(op.title);
        const clash = [...facts.rewardTitles].find((r) => { const n = norm(r); return n && t && (t.includes(n) || n.includes(t)); });
        const said = norm(`${String(op.title ?? '')}${String(op.body ?? '')}`);
        const quotes = [...facts.rewardLines].find((line) => line && said.includes(line));
        if (!op.title || !op.body) bad('title and body required');
        else if (quotes) bad('the note restates a declared find word for word — the find is its own card (created by the roll), never a note');
        else if (clash) bad(`"${String(op.title)}" stands for the declared search reward 「${clash}」 — only the roll gives it, with the world's own words`);
        else ok.push(op);
        break;
      }
      case 'trigger_keyword':
        if (!pack.triggerIds.includes(String(op.id))) bad(`"${String(op.id)}" is not an active turning point here (${pack.triggerIds.join(', ') || 'none'})`);
        else ok.push(op);
        break;
      case 'move_to': case 'link': case 'dice_consequence':
        ok.push(op); // the engine checks these
        break;
      default:
        bad(`unknown op "${op.op}"`);
    }
  }
  return { ok, problems, fixes, warnings };
}

const slug = (s: unknown): string => String(s ?? '').normalize('NFKC').replace(/[^a-z0-9]+/gi, '-').replace(/^-|-$/g, '').toLowerCase() || 'note';

export interface FastOpResult {
  op: string;
  ok: boolean;
  path?: string;
  text?: string;
  error?: string;
  input?: FastOp;
}

/** Lands the chalk (and its buttons) through `writeChalk` + `editEntity`. */
export async function landFastChalk(svc: ActionService, pack: FastPathPack, chalk: FastChalk): Promise<FastOpResult> {
  try {
    const r = await svc.writeChalk({
      body: chalk.text.trim(),
      title: (chalk.title || chalk.text.trim().split('\n')[0]).slice(0, 40),
      layer: pack.dir,
      ...(chalk.append_to ? { appendTo: chalk.append_to } : {}),
    });
    const path = (r.details as { path?: string } | undefined)?.path;
    const options = (chalk.options ?? []).filter((o) => o?.label && o?.id && (!o.enter || pack.exits.has(o.enter)));
    if (path && options.length) {
      const actions = Object.fromEntries(options.filter((o) => o.enter).map((o) => [o.id, { kind: 'enter', target: o.enter }]));
      await svc.editEntity({ path, frontmatter: { choice: { options: options.map((o) => ({ id: o.id, label: o.label })) }, ...(Object.keys(actions).length ? { choice_actions: actions } : {}) } });
    }
    return { op: 'chalk', ok: true, ...(path ? { path } : {}), text: `${options.length} option(s)` };
  } catch (err) {
    return { op: 'chalk', ok: false, error: String((err as Error)?.message ?? err).slice(0, 240) };
  }
}

/** Runs validated ops in order through the action service. Never throws. */
export async function runFastOps(svc: ActionService, pack: FastPathPack, ops: FastOp[]): Promise<FastOpResult[]> {
  const results: FastOpResult[] = [];
  for (const op of ops) {
    try {
      let r: { text?: unknown; details?: unknown } | undefined;
      switch (op.op) {
        case 'choose': r = await svc.chooseOption({ path: op.path, choice: op.option }); break;
        case 'search': r = await svc.searchPlace({ layer: pack.layer, spot: op.spot }); break;
        case 'skill_check':
          r = await svc.skillCheck({
            skill: op.skill, actor: 'player', difficulty: op.difficulty ?? 'regular', title: op.title, layer: pack.layer,
            ...(typeof op.body === 'string' ? { body: op.body } : {}),
            ...(typeof op.spot === 'string' && op.spot ? { spot: op.spot } : {}),
          });
          break;
        case 'use_item_on': r = await svc.useItemOn({ item: op.item, target: op.target }); break;
        case 'take': r = await svc.moveEntity({ from: op.path, to: `player/${String(op.path).split('/').pop()}` }); break;
        case 'note':
          r = await svc.createEntity({ path: `${pack.dir}/${slug(op.id ?? op.title)}-${Date.now().toString(36).slice(-4)}.md`, frontmatter: { type: 'note', title: op.title }, body: op.body });
          break;
        case 'move_to': r = await svc.moveCharacter({ character: op.character, destination: op.destination }); break;
        case 'link': r = await svc.linkCards({ op: 'create', from: op.from, to: op.to, label: op.label, style: 'arrow' }); break;
        case 'trigger_keyword': {
          const fired = await fireKeywordTrigger(svc.ctx, { id: String(op.id), ...(op.by === 'player' || op.by === 'character' ? { by: op.by } : {}) });
          r = { text: JSON.stringify(fired).slice(0, 200) };
          break;
        }
        case 'dice_consequence': r = await svc.diceConsequence({ path: op.path, effect: op.effect }); break;
        default: throw new Error(`unknown op ${op.op}`);
      }
      const path = (r?.details as { path?: unknown } | undefined)?.path;
      results.push({ op: op.op, ok: true, ...(typeof path === 'string' ? { path } : {}), text: String(r?.text ?? '').slice(0, 200) });
    } catch (err) {
      results.push({ op: op.op, ok: false, error: String((err as Error)?.message ?? err).slice(0, 240), input: op });
    }
  }
  return results;
}
