// Offline startup check for every generated world and stable character ID.
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';
import { experiences } from './experiences/index.mjs';
import { installExperience } from './install-experiences.mjs';
import { writerLaunch, characterLaunch } from '../apps/server/dist/engine/launch.js';
import { RpcClient } from '../vendor/pi-rp/packages/coding-agent/dist/index.js';
const repo = fileURLToPath(new URL('../', import.meta.url));
const outputRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'airp-experience-presets-'));
const cli = path.join(repo, 'vendor/pi-rp/packages/coding-agent/dist/cli.js');
for (const pack of experiences) {
  const built = await installExperience(repo, pack, { outputRoot });
  const specs = [{ name: `${pack.base}:writer`, spec: writerLaunch(repo, built.path, cli), writer: true }, ...pack.characters.map(c => ({ name: `${pack.base}:${c.id}`, spec: characterLaunch(repo, built.path, cli, c.id) }))];
  for (const { name, spec, writer } of specs) {
    const client = new RpcClient({ cliPath: spec.cliPath, cwd: spec.cwd, args: spec.args, env: { ...spec.env, PI_OFFLINE: '1' } });
    try {
      await client.start();
      await client.getState();
      const commands = await client.getCommands();
      if (writer) assert.ok(commands.some(c => c.name === `skill:${pack.id}-play` || c.name === `${pack.id}-play`), `${name}: missing world skill`);
      const stderr = client.getStderr?.() ?? '';
      assert.doesNotMatch(stderr, /not found|unknown slot|invalid preset|name contains invalid/iu, name);
      console.log(`PASS ${name}`);
    } finally { await client.stop(); }
  }
}
console.log(`Offline startup fixtures retained: ${outputRoot}`);
