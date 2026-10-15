#!/usr/bin/env node
// Opt-in, bounded real Writer rehearsals. Every run gets new retained saves.
// No images are requested here: the asset-production task is separate.
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
import assert from 'node:assert/strict';
import { experiences } from './experiences/index.mjs';
import { installExperience } from './install-experiences.mjs';
import { LocalWorldStore, createActionService, parseFrontmatter } from '../packages/shared/dist/index.js';
import { writerLaunch } from '../apps/server/dist/engine/launch.js';
import { RpcClient } from '../vendor/pi-rp/packages/coding-agent/dist/index.js';

if (!process.argv.includes('--live')) throw new Error('Pass --live to authorize the selected rehearsal against the configured OpenAI service.');
const repo = fileURLToPath(new URL('../', import.meta.url));
try { process.loadEnvFile(path.join(repo, '.env.local')); } catch (e) { if (e.code !== 'ENOENT') throw e; }
if (!process.env.OPENAI_API_KEY) throw new Error('OPENAI_API_KEY is not configured.');
// Explicit provider pin: never accidentally use a custom/third-party default.
process.env.AIRP_WRITER_MODEL = 'openai/gpt-4.1';
process.env.OPENAI_BASE_URL = 'https://api.openai.com/v1';
const selected = process.argv.find(a => a.startsWith('--world='))?.slice(8) ?? 'first-snow-jp';
const packs = selected === 'all' ? experiences : experiences.filter(p => p.base === selected);
if (!packs.length) throw new Error('Unknown world.');

for (const pack of packs) {
  const built = await installExperience(repo, pack, { outputRoot: path.join(repo, 'worlds'), revision: `rehearsal-${randomUUID().slice(0, 8)}` });
  const root = built.path;
  const store = new LocalWorldStore(root);
  const spec = writerLaunch(repo, root, path.join(repo, 'vendor/pi-rp/packages/coding-agent/dist/cli.js'));
  const client = new RpcClient({ cliPath: spec.cliPath, cwd: spec.cwd, args: spec.args, env: spec.env });
  const report = { world: pack.base, save: root, model: 'openai/gpt-4.1', imageGeneration: false, turns: [], completed: false, checks: [] };
  const player = createActionService(store, { type: 'player' });
  const read = file => fs.readFile(path.join(root, file), 'utf8');
  const present = async file => { assert.ok((await read(file)).length > 15, `Missing content: ${file}`); report.checks.push(file); };
  let imageCalls = 0;
  client.onEvent(event => {
    if (event.type === 'tool_execution_start' && event.toolName === 'generate_image') imageCalls++;
    if (event.type === 'tool_execution_end') console.log(JSON.stringify({ world: pack.base, tool: event.toolName, ok: !event.isError }));
  });
  async function turn(layer, source, choice) {
    const event = await player.chooseOption({ path: source, choice });
    const started = Date.now();
    const noImage = pack.locale === 'ja' ? 'このテストでは背景画像を生成しない。文字と既存 CG だけで完了し、画像は後の別作業に残す。' : 'For this rehearsal do not generate images. Complete the playable text only; artwork is a separate task.';
    await client.prompt(`[Current Layer] ${layer}\n[Player Event] ${JSON.stringify(event.details.event)}\nRead ${JSON.stringify(source)} and the world skill. Resolve this player action using real files. Do not record the choice twice. ${noImage}`);
    await client.waitForIdle(180000);
    report.turns.push({ layer, source, elapsedMs: Date.now() - started });
  }
  try {
    await client.start();
    const state = await client.getState();
    assert.equal(state.model?.provider, 'openai');
    assert.equal(state.model?.id, 'gpt-4.1');
    if (pack.base === 'wuwu') {
      await turn('map', 'world/01-opening.md', 1);
      await present('player/commission-letter.md'); await present('player/investigator-badge.md');
    } else if (pack.base === 'whitechapel') {
      await turn('map', 'world/01-opening.md', 2);
      await present('player/blue-brass-cap.md');
    } else if (pack.base === 'divergence') {
      await turn('map', 'world/01-opening.md', 1);
      await present('player/clockwork-frog.md');
    } else if (pack.base === 'first-snow-jp') {
      await player.moveEntity({ from: 'world/request-slip.md', to: 'player/request-slip.md' });
      await player.enterLayer({ layer: 'world/tonight-promises' });
      await player.enterLayer({ layer: 'world/tonight-promises/radio-studio' });
      const memory = await read('characters/nanami/memory.md');
      await turn('world/tonight-promises/radio-studio', 'world/tonight-promises/radio-studio/01-opening.md', 1);
      for (const file of ['player/tonight-letter.md', 'world/tonight-promises/radio-studio/02-tonight-response.md']) await present(file);
      assert.notEqual(await read('characters/nanami/memory.md'), memory);
      // A first promise must not write an ending or invent the other person's absence.
      await assert.rejects(() => read('world/tonight-promises/first-snow/epilogue.md'), { code: 'ENOENT' });
      await assert.rejects(() => read('world/tonight-promises/amber-cafe/absence-trace.md'), { code: 'ENOENT' });
      assert.equal(parseFrontmatter(await read('player/tonight-letter.md')).frontmatter.type, 'letter');
      await player.enterLayer({ layer: 'world/tonight-promises/first-snow' });
      await turn('world/tonight-promises/first-snow', 'world/tonight-promises/first-snow/01-opening.md', '七海との今夜を結ぶ');
      await present('world/tonight-promises/first-snow/epilogue.md');
      assert.equal(parseFrontmatter(await read('world/tonight-promises/first-snow/README.md')).frontmatter.status?.data?.closingState, 'complete');
    } else if (pack.base === 'magic-academy') {
      await turn('map', 'world/01-opening.md', 1);
      await present('player/freshman-badge.md');
    } else {
      await turn('map', 'world/letter.md', 1);
      const letter = parseFrontmatter(await read('world/letter.md'));
      assert.equal(letter.frontmatter.status.data.opened, true);
      const event = await player.enterLayer({ layer: 'world/outside' });
      const started = Date.now();
      await client.prompt(`[Current Layer] world/outside\n[Player Event] ${JSON.stringify(event.details.event)}\nThe player opens the door. Read the world skill and revealed letter/phone Context. Materialise the first outside scene and its five required files. Do NOT generate an image in this rehearsal; complete the text only.`);
      await client.waitForIdle(180000);
      report.turns.push({ layer: 'world/outside', elapsedMs: Date.now() - started });
      for (const file of ['README.md', 'resident.md', 'found-object.md', '01-arrival.md', 'return.md']) await present(`world/outside/${file}`);
      assert.equal(parseFrontmatter(await read('world/outside/return.md')).frontmatter.target, 'map');
    }
    assert.equal(imageCalls, 0, 'Text-only rehearsal must not request images');
    report.completed = true;
  } catch (error) {
    report.failure = String(error).replace(/sk-[A-Za-z0-9_-]+/g, '[redacted]');
    process.exitCode = 1;
  } finally {
    await client.stop().catch(() => {}); store.close();
    await fs.mkdir(path.join(root, '.airpworld'), { recursive: true });
    await fs.writeFile(path.join(root, '.airpworld/experience-rehearsal.json'), JSON.stringify(report, null, 2) + '\n');
    console.log(JSON.stringify(report, null, 2));
  }
}
