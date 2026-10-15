#!/usr/bin/env node
/**
 * Writer fast path — replay a recorded writer session turn by turn through the
 * SERVER's fast path in `on` mode (apps/server/src/engine/writer-fast-path.ts,
 * the design notes).
 *
 *   pnpm build   # shared + server dist
 *   node tools/writer-fast-path/replay-states.mjs <save-copy> <session.jsonl> <states>
 *   node tools/writer-fast-path/run-replay.mjs <states> <session.jsonl> <out-dir> --env <file-with-DEEPSEEK_API_KEY> [--turns 0,3,7] [--tag a] [--rebind-rolls] [--alt-skills <layer>#<spot>=<skill,…>]
 *
 * Each turn runs on a fresh copy of its reconstructed state (the states stay
 * pristine), against the real model, through `WriterFastPath.run` — the same
 * code the server runs: pack (with the command engine's dry run for every
 * button), one streamed call, validation, the ops through the action service,
 * one repair, the fallbacks. Frames are collected instead of sent.
 *
 * --rebind-rolls: a beat that reports a resolved skill check on a card the
 * original agent framed WITHOUT binding it to a declared spot is replayed the
 * way the engine now does it: the old check card (and any agent-written copy of
 * a declared find, which the engine now writes itself) is removed, the same
 * skill is framed again through `skillCheck` (the engine binds the spot when the
 * skill is the spot's skill / alt_skills), it is rolled with the SAME score
 * through `runDeclaredRoll`, and the beat text becomes the server's own roll
 * message. Each such turn reports which finds the roll created.
 * --alt-skills: patch a spot's `alt_skills` into every state copy (a world data
 * change the save predates), e.g. `world/shrine#scene=spot_hidden`.
 *
 * Writes <out-dir>/results-<tag>.json. The key is read from the env file and
 * never printed.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const shared = await import(path.join(here, '../../packages/shared/dist/index.js'));
const { WriterFastPath } = await import(path.join(here, '../../apps/server/dist/engine/writer-fast-path.js'));
const { runDeclaredRoll } = await import(path.join(here, '../../apps/server/dist/engine/declared-actions.js'));

const args = process.argv.slice(2);
const [statesDir, sessionFile, outDir] = args;
const flag = (name) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : undefined; };
const envFile = flag('--env');
const only = flag('--turns')?.split(',').map(Number);
const tag = flag('--tag') ?? 'run';
const rebind = args.includes('--rebind-rolls');
const altSkills = flag('--alt-skills');
if (!statesDir || !sessionFile || !outDir || !envFile) {
  console.error('usage: run-replay.mjs <states> <session.jsonl> <out-dir> --env <file> [--turns 0,1] [--tag t] [--rebind-rolls] [--alt-skills layer#spot=skill]');
  process.exit(2);
}
const apiKey = /^DEEPSEEK_API_KEY=(.*)$/m.exec(fs.readFileSync(envFile, 'utf8'))?.[1]?.trim().replace(/^["']|["']$/g, '');
if (!apiKey) { console.error('no DEEPSEEK_API_KEY in env file'); process.exit(2); }
const env = { AIRP_WRITER_FAST_PATH: 'on', DEEPSEEK_API_KEY: apiKey, ...(flag('--model') ? { AIRP_WRITER_FAST_PATH_MODEL: flag('--model') } : {}) };

// ——— the original turns, for the side-by-side ———
const lines = fs.readFileSync(sessionFile, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l));
const original = [];
const pendingCalls = new Map();
for (const entry of lines) {
  if (entry.type !== 'message') continue;
  const m = entry.message;
  const at = Date.parse(entry.timestamp);
  if (m.role === 'user') {
    original.push({ t0: at, request: m.content.filter((c) => c.type === 'text').map((c) => c.text).join(''), end: at, steps: 0, out: 0, think: 0, firstChalk: null, chalks: [], tools: [], finalText: '' });
    continue;
  }
  const t = original[original.length - 1];
  if (!t) continue;
  t.end = at;
  if (m.role === 'assistant') {
    t.steps++;
    t.out += m.usage?.output ?? 0;
    for (const c of m.content) {
      if (c.type === 'thinking') t.think += c.thinking.length;
      if (c.type === 'text') t.finalText = c.text;
      if (c.type === 'toolCall') { pendingCalls.set(c.id, c); t.tools.push(c.name); }
    }
  } else if (m.role === 'toolResult') {
    const call = pendingCalls.get(m.toolCallId);
    if (call?.name === 'chalk' && !m.isError) {
      if (t.firstChalk === null) t.firstChalk = at - t.t0;
      t.chalks.push(call.arguments.content);
    }
  }
}

const report = JSON.parse(fs.readFileSync(path.join(statesDir, 'report.json'), 'utf8'));
const layerOf = (req, fallback) => {
  const cur = /\[Current Layer\] (\S+)/.exec(req)?.[1];
  if (cur) return cur;
  const ev = /"layer":"([^"]+)"/.exec(req)?.[1];
  if (ev) return ev;
  const card = /"(world\/[^"]+)\/[^"/]+\.md"/.exec(req)?.[1];
  return card ?? fallback;
};

function patchAltSkills(root) {
  if (!altSkills) return;
  const [where, skills] = altSkills.split('=');
  const [layer, spot] = where.split('#');
  const file = path.join(root, layer, 'README.md');
  const text = fs.readFileSync(file, 'utf8');
  const re = new RegExp(`(- id: ${spot}\\n(?:  [^\\n]*\\n)*?  skill: [^\\n]+\\n)`);
  if (!re.test(text) || text.includes('alt_skills:')) return;
  fs.writeFileSync(file, text.replace(re, `$1  alt_skills: [${skills}]\n`));
}

/**
 * The engine's way for a resolved skill check the original agent never bound:
 * frame the same skill again (the engine binds the spot), roll the same score.
 * Returns the server's own beat text, or null when the beat is not such a roll.
 */
async function rebindRoll(root, request) {
  const m = /The player rolled the skill check "([^"]+)" \([^)]*\): (\d+)/.exec(request);
  if (!m) return null;
  const [, cardPath, score] = m;
  const store = new shared.LocalWorldStore(root);
  try {
    const fm = shared.parseFrontmatter(await store.readFile(cardPath)).frontmatter ?? {};
    if (fm.search_source) return null;
    const layer = cardPath.slice(0, cardPath.lastIndexOf('/'));
    const god = shared.createActionService(store, { type: 'god' }, { turn: `replay:${Date.now()}` });
    await god.removeEntity({ path: cardPath });
    // An agent-written copy of a declared find (no dice_reward) — the engine now writes it from the roll.
    const { spots } = await shared.declaredSpotsOf(god.ctx, layer);
    const removed = [];
    const kept = new Map();
    for (const spot of spots) for (const find of shared.searchFinds(spot)) {
      for (const at of [find, `player/${find.split('/').pop()}`]) {
        if ((await store.statKind(at)) !== 'file') continue;
        const raw = await store.readFile(at);
        const ffm = shared.parseFrontmatter(raw).frontmatter ?? {};
        if (!ffm.dice_reward) { kept.set(at, raw); await god.removeEntity({ path: at }); removed.push(at); }
      }
    }
    const player = shared.createActionService(store, { type: 'player' }, { turn: `replay:${Date.now()}` });
    const framed = await player.skillCheck({ skill: fm.skill_check?.skill, title: fm.title, layer });
    const rolled = await runDeclaredRoll(god, framed.details.path, Number(score));
    const created = (rolled.details.rewards ?? []).map((r) => r.path);
    // A copy the player already carried and the roll did not hand out again (the engine never
    // respawns a find that was moved): put it back, so the bag is what it was.
    for (const [at, raw] of kept) if ((await store.statKind(at)) === 'missing' && !created.includes(at)) await store.writeFile(at, raw);
    const bound = !!framed.details.spot;
    const text = bound
      ? `[Player Event] The player rolled the search ${JSON.stringify(framed.details.path)}: ${rolled.details.result} (${rolled.details.outcomeGrade}). ${created.length ? `The roll created: ${created.map((p) => JSON.stringify(p)).join(', ')}.` : 'The roll found nothing to carry.'} Read the search card and what it created, then narrate the result in one chalk. Do not create, move or re-roll the found items; they already exist.`
      : request.replace(cardPath, framed.details.path);
    return { text, rebind: { from: cardPath, to: framed.details.path, spot: framed.details.spot ?? null, score: Number(score), grade: rolled.details.skill?.grade ?? null, created, removedAgentCopies: removed } };
  } finally {
    store.close();
  }
}

fs.mkdirSync(outDir, { recursive: true });
const runRoot = path.join(outDir, `work-${tag}`);
fs.rmSync(runRoot, { recursive: true, force: true });
const results = [];
let lastLayer = 'map';
for (const t of report.turns) {
  const layer = layerOf(t.request, lastLayer);
  lastLayer = layer;
  if (only && !only.includes(t.index)) continue;
  const src = path.join(statesDir, `turn-${String(t.index).padStart(2, '0')}`);
  const root = path.join(runRoot, `turn-${String(t.index).padStart(2, '0')}`);
  fs.cpSync(src, root, { recursive: true, verbatimSymlinks: true });
  patchAltSkills(root);
  let request = t.request;
  let rebound = null;
  if (rebind) {
    const r = await rebindRoll(root, request);
    if (r) { request = r.text; rebound = r.rebind; }
  }
  const store = new shared.LocalWorldStore(root);
  store.writeViewpoint({ layer, focus: null, selected: [], bagCount: 0 });
  const fast = new WriterFastPath({ storeFor: () => store, env });
  const frames = [];
  const events = [];
  const t0 = performance.now();
  let firstInkMs = null;
  const result = await fast.run(root, request, {
    frame: (f) => { if (f.type === 'writer_delta' && firstInkMs === null) firstInkMs = performance.now() - t0; frames.push(f.type); },
    event: (e) => events.push(e.type),
  });
  const beatMs = performance.now() - t0;
  store.close();
  const rec = result.record;
  const o = original[t.index];
  const row = {
    index: t.index, layer, request: request.split('\n').slice(0, 2).join(' / ').slice(0, 160),
    handled: result.handled, fallback: result.fallback ?? null,
    firstInkMs: firstInkMs === null ? null : Math.round(firstInkMs), beatMs: Math.round(beatMs),
    firstChalkMs: rec.firstChalkMs, streamMs: rec.streamMs, buildMs: rec.buildMs, execMs: rec.execMs ?? null,
    usage: rec.usage ?? null, packChars: rec.packChars, previews: rec.previews,
    chalk: rec.reply?.chalk ?? null, why: rec.reply?.why ?? '', ops: rec.ops ?? [], problems: rec.problems ?? [], fixes: rec.fixes ?? [], warnings: rec.warnings ?? [],
    exec: rec.exec ?? [], repair: rec.repair ?? null, legal: rec.legal ?? null, frames: [...new Set(frames)], events,
    ...(rebound ? { rebind: rebound } : {}),
    original: { durationMs: o.end - o.t0, firstChalkMs: o.firstChalk, steps: o.steps, outTokens: o.out, thinkChars: o.think, tools: o.tools, chalks: o.chalks, finalText: o.finalText.slice(0, 600) },
  };
  results.push(row);
  console.log(`#${t.index} ${layer} ${result.handled ? 'fast' : `agent(${result.fallback})`} ink=${row.firstInkMs}ms beat=${row.beatMs}ms out=${row.usage?.completion_tokens ?? '-'} legal=${row.legal ? `${row.legal.ok}/${row.legal.total}` : '-'}${row.repair ? ' repair' : ''}${rebound ? ` | roll ${rebound.score}→${rebound.grade} spot=${rebound.spot} created=${rebound.created.join(',') || '-'}` : ''} | orig ${Math.round(row.original.durationMs / 100) / 10}s`);
}
fs.writeFileSync(path.join(outDir, `results-${tag}.json`), JSON.stringify(results, null, 2));
// The per-turn worlds stay in <out-dir>/work-<tag> for inspection; delete them by hand.
