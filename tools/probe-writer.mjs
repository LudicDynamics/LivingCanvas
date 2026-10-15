#!/usr/bin/env node
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { writerLaunch, characterLaunch } from '../apps/server/dist/engine/launch.js';
import { RpcClient } from '../vendor/pi-rp/packages/coding-agent/dist/index.js';
import { LocalWorldStore, flowColumns, parseFrontmatter } from '../packages/shared/dist/index.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const REPO_ROOT = path.resolve(__dirname, '..');
const VENDOR_CLI = path.join(REPO_ROOT, 'vendor/pi-rp/packages/coding-agent/dist/cli.js');
const TEST_WORLD = path.join(REPO_ROOT, 'archive/templates/pre-bilingual-2026-09-14/holmes-world');
const PROBE_PROVIDER = path.join(__dirname, 'probe-provider.ts');
const PROBE_CHALK_REL = 'world/baker-street/probe-chalk.md';

/** Preset-loading failures must fail the probe, never degrade silently. */
function presetWarnings(client) {
  return client
    .getStderr()
    .split('\n')
    .filter((line) => line.includes('not found') || line.includes('unknown slot'))
    .map((line) => line.trim());
}

/**
 * The `--no-*` discovery kill-switches MUST be on every spawn (launch.ts::ISOLATION_ARGS).
 * Without them pi-rp walks the developer machine's globals: 37 skills from `~/.agents/skills/`
 * + `~/.pi/agent/skills/`, every `~/.pi/agent/extensions/*.ts`, and — the worst one — the
 * repo-root `AGENTS.md` found by walking ancestors up from the world root, which lands in the
 * agent's system prompt. Asserted here so a future "cleanup" of the arg list fails the gate.
 */
const REQUIRED_ISOLATION = [
  '--no-extensions',
  '--no-skills',
  '--no-context-files',
  '--no-prompt-templates',
  '--no-themes',
];

function assertIsolationArgs(label, spec) {
  const missing = REQUIRED_ISOLATION.filter((flag) => !spec.args.includes(flag));
  if (missing.length > 0) {
    throw new Error(`${label}: spawn is missing resource-isolation flags: ${missing.join(' ')}`);
  }
}

/**
 * Live leak check: no resource may come from the developer machine's global discovery
 * roots. AIRP passes skills explicitly (`<repo>/skills`, `<world>/skills`), so those are
 * legitimate — what must never appear is anything under `~/.agents/` or `~/.pi/`.
 * Extensions are limited to pi-rp's own hidden inline builtins (llama/memories/opening).
 */
const BUILTIN_INLINE = ['llama', 'memories', 'opening'];
const GLOBAL_ROOTS = [path.join(os.homedir(), '.agents'), path.join(os.homedir(), '.pi')];

const isGlobalPath = (p) => typeof p === 'string' && GLOBAL_ROOTS.some((root) => p.startsWith(root));

async function assertNoGlobalLeak(label, client) {
  // `getCommands()` resolves the bare array; the engine may still be wiring its
  // command table right after spawn, so poll until it is populated (bounded).
  let commands = [];
  for (let i = 0; i < 20 && commands.length === 0; i++) {
    commands = await client.getCommands().catch(() => []);
    if (commands.length === 0) await new Promise((r) => setTimeout(r, 300));
  }
  const leakedSkills = commands.filter((c) => c.source === 'skill' && isGlobalPath(c.sourceInfo?.path));
  const leakedExtensions = commands.filter(
    (c) => c.source === 'extension' && !BUILTIN_INLINE.includes(c.name) && isGlobalPath(c.sourceInfo?.path)
  );
  if (leakedSkills.length > 0 || leakedExtensions.length > 0) {
    const fmt = (list) => list.map((c) => `${c.name} (${c.sourceInfo?.path ?? '?'})`).join(', ');
    throw new Error(
      `${label}: global resources leaked into the agent — ` +
        `skills=[${fmt(leakedSkills)}] extensions=[${fmt(leakedExtensions)}]`
    );
  }
}

/**
 * Spawns a spec from `engine/launch.js`, waits for it to settle, and asserts the
 * preset actually loaded. Passing the spec the server itself uses is the point —
 * a broken path or a renamed slot fails here rather than silently at runtime.
 */
async function checkSpawn(label, spec) {
  console.log(`\n[${label}] Spawning from shared launch spec...`);
  console.log(`  args: ${spec.args.join(' ')}`);
  console.log(`  session dir: ${spec.env.PI_CODING_AGENT_SESSION_DIR ?? '(none)'}`);

  assertIsolationArgs(label, spec);

  const client = new RpcClient({
    cliPath: spec.cliPath,
    cwd: spec.cwd,
    args: spec.args,
    env: { ...spec.env, PI_OFFLINE: '1' },
  });
  await client.start();
  await new Promise((r) => setTimeout(r, 1500));

  const warnings = presetWarnings(client);
  if (warnings.length > 0) {
    throw new Error(`${label}: preset was not loaded:\n${warnings.join('\n')}`);
  }
  await assertNoGlobalLeak(label, client);
  console.log(`✓ ${label} spawned; preset resolved (no "not found" / "unknown slot").`);
  console.log(`✓ ${label} no global skills/extensions leaked (discovery isolated).`);
  await client.stop();
  console.log(`✓ ${label} stopped.`);
}

async function runProbe() {
  console.log('=== [AIRP Gate Probe] Testing Monorepo Pipeline ===');

  // 1. Verify LocalWorldStore & SQLite schemas
  console.log('[Probe 1] Testing LocalWorldStore on archive/templates/pre-bilingual-2026-09-14/holmes-world...');
  const store = new LocalWorldStore(TEST_WORLD);
  const manifest = await store.getManifest();
  console.log(`✓ Manifest loaded: "${manifest.name}" (ID: ${manifest.id}, Genre: ${manifest.genre})`);

  const files = await store.listFiles();
  console.log(`✓ Files listed: ${files.length} items found in world.`);

  // History events now go through appendEvent(AppendEventArgs) — the old
  // appendWorldEvent(type, payload) is gone.
  const testEvt = await store.appendEvent({
    type: 'world_snapshot',
    actor: { type: 'engine' },
    detail: { snapshot: 'probe', reason: 'probe gate: history.db is writable' },
  });
  console.log(`✓ SQLite history event created: [${testEvt.type}] id: ${testEvt.id} seq: ${testEvt.seq}`);

  store.close();

  // 2 & 3. Writer / character spawn through the single source of spawn args.
  await checkSpawn('Probe 2', writerLaunch(REPO_ROOT, TEST_WORLD, VENDOR_CLI));
  await checkSpawn('Probe 3', characterLaunch(REPO_ROOT, TEST_WORLD, VENDOR_CLI, 'watson'));

  // 4. Real narrative round-trip.
  await runNarrativeRoundTrip();

  // The template must stay clean — Probe 4 runs on a tmp copy.
  if (fs.existsSync(path.join(TEST_WORLD, PROBE_CHALK_REL))) {
    throw new Error(`Probe 4 leaked probe-chalk.md into the template at ${PROBE_CHALK_REL}`);
  }
  console.log('✓ Template world untouched by Probe 4.');
  await runLayoutProbe();

  console.log('\n=== [AIRP Gate Probe] ALL CHECKS PASSED ===');
}

function runLayoutProbe() {
  console.log('\n[Probe 5] Automatic layout geometry with shared flowColumns...');

  const config = {
    origin: { x: 360, y: 96 },
    columnHeight: 600,
    gapX: 56,
    gapY: 32,
    obstacleGap: 22,
    maxColumns: 8,
  };
  const boxes = [
    { id: 'chalk-z', w: 460, h: 640, order: 1 },
    { id: 'component-a', w: 420, h: 700, order: 2 },
    { id: 'note-m', w: 360, h: 160, order: 3 },
  ];
  const occupied = [{ id: 'legacy-card', x: 360, y: 96, w: 460, h: 220 }];
  const occupiedBefore = occupied.map((rect) => ({ ...rect }));
  const shuffled = [boxes[2], boxes[0], boxes[1]];

  if (boxes.filter((box) => box.h > config.columnHeight).length < 2) {
    throw new Error('Probe 5: fixture must contain at least two boxes taller than columnHeight');
  }

  const first = flowColumns(shuffled, occupied, config);
  const repeated = flowColumns(shuffled, occupied, config);
  const ordered = flowColumns(boxes, occupied, config);
  if (first.placements.length !== boxes.length) {
    throw new Error(`Probe 5: expected ${boxes.length} placements, got ${first.placements.length}`);
  }
  const expectedOrder = boxes.map(({ id }) => id);
  if (JSON.stringify(first.placements.map(({ id }) => id)) !== JSON.stringify(expectedOrder)) {
    throw new Error(`Probe 5: placements ignored same-batch order (${first.placements.map(({ id }) => id).join(', ')})`);
  }

  const overlaps = (a, b) =>
    a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;
  const obstaclesAndPlacements = [...occupied, ...first.placements];
  for (let i = 0; i < obstaclesAndPlacements.length; i++) {
    for (let j = i + 1; j < obstaclesAndPlacements.length; j++) {
      if (overlaps(obstaclesAndPlacements[i], obstaclesAndPlacements[j])) {
        throw new Error(
          `Probe 5: overlapping layout rectangles: ${obstaclesAndPlacements[i].id ?? `rect-${i}`} and ${
            obstaclesAndPlacements[j].id ?? `rect-${j}`
          }`
        );
      }
    }
  }
  console.log('✓ Probe 5.1 placements do not intersect each other or the occupied legacy card.');

  const sameRect = (a, b) =>
    a.id === b.id && a.x === b.x && a.y === b.y && a.w === b.w && a.h === b.h;
  if (occupied.some((rect, index) => !sameRect(rect, occupiedBefore[index]))) {
    throw new Error('Probe 5: flowColumns mutated the occupied legacy rectangle');
  }
  console.log('✓ Probe 5.2 occupied legacy coordinates remain unchanged.');

  const placementSignature = (result) =>
    result.placements.map(({ id, x, y, w, h }) => [id, x, y, w, h]);
  if (JSON.stringify(placementSignature(first)) !== JSON.stringify(placementSignature(ordered))) {
    throw new Error('Probe 5: shuffled input changed placements despite explicit order');
  }
  console.log('✓ Probe 5.3 shuffled input honors same-batch order values.');

  if (JSON.stringify(first) !== JSON.stringify(repeated)) {
    throw new Error('Probe 5: repeated flowColumns read was not stable');
  }
  console.log('✓ Probe 5.4 repeated flowColumns calculation is stable.');
}

async function runNarrativeRoundTrip() {
  console.log('\n[Probe 4] Narrative round-trip with deterministic provider...');
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'airp-probe-'));
  fs.cpSync(TEST_WORLD, tmp, { recursive: true });
  fs.rmSync(path.join(tmp, '.airpworld', 'sessions'), { recursive: true, force: true });
  const probeStore = new LocalWorldStore(tmp);
  probeStore.writeViewpoint({ layer: 'world/baker-street', focus: null, selected: [], bagCount: 0 });
  probeStore.close();

  const spec = writerLaunch(REPO_ROOT, tmp, VENDOR_CLI);
  const realModel = process.env.AIRP_PROBE_REAL === '1';
  const client = new RpcClient({
    cliPath: spec.cliPath,
    cwd: spec.cwd,
    args: realModel ? spec.args : [...spec.args, '--extension', PROBE_PROVIDER],
    env: { ...spec.env, PI_OFFLINE: '1' },
    ...(realModel ? {} : { provider: 'airp-probe', model: 'deterministic' }),
  });

  const events = [];
  client.onEvent((event) => events.push(event));

  try {
    await client.start();

    const state = await client.getState();
    const provider = state.model?.provider;
    if (!realModel && provider !== 'airp-probe') {
      console.log(`[Probe 4] SKIPPED: deterministic provider not loaded (provider=${provider ?? 'none'})`);
      throw new Error('Probe 4 SKIPPED: deterministic provider not loaded');
    }

    await client.prompt('walk into the kitchen and look around');
    await client.waitForIdle(30000);

    const sawDelta = events.some(
      (e) => e.type === 'message_update' && e.assistantMessageEvent?.type === 'text_delta'
    );
    if (!sawDelta) throw new Error('Probe 4: no streamed text_delta event observed');

    const wrote = events.some(
      (e) => e.type === 'tool_execution_end' && e.toolName === 'chalk' && e.isError === false
    );
    if (!wrote) throw new Error('Probe 4: no successful tool_execution_end(chalk) observed');

    const landed = path.join(tmp, PROBE_CHALK_REL);
    if (!fs.existsSync(landed)) throw new Error(`Probe 4: chalk file not written to ${landed}`);
    const fm = parseFrontmatter(fs.readFileSync(landed, 'utf-8'));
    if (fm.frontmatter?.type !== 'chalk') {
      throw new Error(`Probe 4: frontmatter.type is ${JSON.stringify(fm.frontmatter?.type)}, expected 'chalk'`);
    }

    console.log('✓ Streamed text_delta received (streaming channel).');
    console.log('✓ tool_execution_end(chalk) succeeded (tool channel).');
    console.log('✓ probe-chalk.md landed in the tmp world copy.');
    console.log("✓ parseFrontmatter resolved type: 'chalk'.");
  } finally {
    await client.stop().catch(() => {});
    fs.rmSync(tmp, { recursive: true, force: true });
  }
}

runProbe().catch((err) => {
  console.error('Probe failed:', err);
  process.exit(1);
});
