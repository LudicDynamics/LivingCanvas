// Opt-in live provider diagnostic. Uses a disposable world, never a player's save.
import fs from 'node:fs/promises';
import { existsSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { writerLaunch } from '../apps/server/dist/engine/launch.js';
import { RpcClient } from '../vendor/pi-rp/packages/coding-agent/dist/index.js';

if (!process.argv.includes('--live')) throw new Error('Pass --live to permit one live model request.');
const root = path.resolve(import.meta.dirname, '..');
if (existsSync(path.join(root, '.env.local'))) process.loadEnvFile(path.join(root, '.env.local'));
const world = await fs.mkdtemp(path.join(os.tmpdir(), 'airp-live-writer-'));
await fs.cp(path.join(root, 'templates/unwritten-door'), world, { recursive: true,
  filter: source => !source.split(path.sep).some(part => ['assets', '.airpworld'].includes(part)),
});
const spec = writerLaunch(root, world, path.join(root, 'vendor/pi-rp/packages/coding-agent/dist/cli.js'));
const client = new RpcClient({ cliPath: spec.cliPath, cwd: spec.cwd, args: spec.args, env: spec.env });
const started = Date.now();
const log = message => console.log(`${Date.now() - started}ms ${message}`);
let timer;
try {
  await client.start();
  if (process.argv.includes('--thinking-low')) await client.setThinkingLevel('low');
  const state = await client.getState();
  log(`RPC ready; model=${state.model?.provider}/${state.model?.id}; thinking=${state.thinkingLevel}`);
  const completed = new Promise((resolve, reject) => {
    timer = setTimeout(() => reject(new Error('No settled event within 120 seconds')), 120000);
    client.onEvent(event => {
      if (['agent_start', 'agent_settled', 'tool_execution_start', 'tool_execution_end'].includes(event.type)) log(`${event.type}${event.toolName ? ` ${event.toolName}` : ''}`);
      if (event.type === 'message_end' && event.message?.errorMessage) log(`Model error: ${event.message.errorMessage}`);
      if (event.type === 'agent_settled') resolve();
    });
  });
  // Attach the catch immediately while prompt preflight is pending.
  const request = client.prompt('[Current Layer] map\n[Player Request] I quietly look at the closed envelope. Write one brief sentence of narration only. Do not generate images or open a new scene.');
  await Promise.all([request.then(() => log('Prompt acknowledged')), completed]);
  log('Completed');
} catch (error) {
  log(String(error)); process.exitCode = 1;
} finally {
  clearTimeout(timer);
  await client.stop();
  await fs.rm(world, { recursive: true, force: true });
}
