#!/usr/bin/env node
/**
 * Engine-spawn tool-face probe.
 *
 * `tools/probe-tools.mjs` loads `extensions/tools.ts` through jiti and asserts the
 * registry CONTENT — but it never starts the engine, so it cannot catch a tool the
 * engine itself declines to expose (the loader can silently skip a module, and RPC
 * has no "list my tools" command). This probe closes that gap by spawning the real
 * writer through `writerLaunch` (so the real `extensions/tools.ts` loads inside the
 * engine) and script-streaming a `chalk` tool call from a deterministic provider:
 *
 *   1. the `chalk` AIRP tool executes — an unregistered name would come back as a
 *      validation/unknown-tool error instead of landing a file;
 *   2. the file lands on disk with `type: chalk`;
 *   3. the tool's own ledger write reaches `history.db` with actor `writer` and the
 *      resolved layer.
 *
 * The provider lives in `tools/` on purpose: `presets.ts::extensionArgs` only scans
 * `extensions/` and `<world>/extensions/`, so it can never load in a production run.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { writerLaunch } from '../apps/server/dist/engine/launch.js';
import { RpcClient } from '../vendor/pi-rp/packages/coding-agent/dist/index.js';
import { LocalWorldStore, parseFrontmatter } from '../packages/shared/dist/index.js';

const REPO = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const VENDOR_CLI = path.join(REPO, 'vendor/pi-rp/packages/coding-agent/dist/cli.js');
const TEST_WORLD = path.join(REPO, 'archive/templates/pre-bilingual-2026-09-14/holmes-world');
const TOOL_PROVIDER = path.join(REPO, 'tools/tool-probe-provider.ts');
const CHALK_REL = 'world/baker-street/tool-probe-chalk.md';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'airp-toolface-'));
fs.cpSync(TEST_WORLD, tmp, { recursive: true });
fs.rmSync(path.join(tmp, '.airpworld', 'sessions'), { recursive: true, force: true });

const spec = writerLaunch(REPO, tmp, VENDOR_CLI);
const client = new RpcClient({
  cliPath: spec.cliPath,
  cwd: spec.cwd,
  args: [...spec.args, '--extension', TOOL_PROVIDER],
  env: { ...spec.env, PI_OFFLINE: '1' },
  provider: 'airp-tool-probe',
  model: 'deterministic',
});

const events = [];
client.onEvent((e) => events.push(e));

try {
  await client.start();
  await client.prompt('write something on the board');
  await client.waitForIdle(30000);

  const chalkEnd = events.find((e) => e.type === 'tool_execution_end' && e.toolName === 'chalk');
  if (!chalkEnd) {
    const seen = events
      .filter((e) => e.type === 'tool_execution_end')
      .map((e) => `${e.toolName}(err=${e.isError})`);
    throw new Error(`chalk tool never executed through the engine; saw: ${seen.join(', ') || '(none)'}`);
  }
  if (chalkEnd.isError) {
    throw new Error(`chalk tool errored: ${JSON.stringify(chalkEnd.result).slice(0, 400)}`);
  }

  const landed = path.join(tmp, CHALK_REL);
  if (!fs.existsSync(landed)) throw new Error(`chalk did not land at ${landed}`);
  const fm = parseFrontmatter(fs.readFileSync(landed, 'utf-8'));
  if (fm.frontmatter?.type !== 'chalk') {
    throw new Error(`frontmatter.type=${JSON.stringify(fm.frontmatter?.type)}, expected 'chalk'`);
  }

  const store = new LocalWorldStore(tmp);
  const events2 = await store.getEvents();
  const created = events2.find((e) => e.type === 'entity_created');
  if (!created) throw new Error(`no entity_created event; saw: ${events2.map((e) => e.type).join(',')}`);
  if (created.actor.type !== 'writer') {
    throw new Error(`actor_type=${created.actor.type}, expected writer`);
  }
  store.close();

  console.log('✓ AIRP `chalk` tool executed through the engine (not an unknown-tool error).');
  console.log(`✓ ${CHALK_REL} landed with type: chalk.`);
  console.log(`✓ history.db got entity_created (actor=${created.actor.type}, layer=${created.layer}).`);
  console.log('ENGINE TOOL FACE VERIFIED');
} finally {
  await client.stop().catch(() => {});
  fs.rmSync(tmp, { recursive: true, force: true });
}
