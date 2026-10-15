#!/usr/bin/env node
// Real image-tool probe. Credentials remain in the local environment.
import fs from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createJiti } from '../vendor/pi-rp/node_modules/jiti/lib/jiti.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
if (existsSync(path.join(root, '.env'))) process.loadEnvFile(path.join(root, '.env'));
if (!process.env.AIRP_IMAGE_MODEL || !(process.env.OPENAI_API_KEY || process.env.OPENROUTER_API_KEY)) {
  throw new Error('Configure AIRP_IMAGE_MODEL and its API key in .env before running a real image probe.');
}
const world = path.join(root, '.artifacts/image-probe');
await fs.mkdir(world, { recursive: true });
await fs.copyFile(path.join(root, 'templates/unwritten-door/world.json'), path.join(world, 'world.json'));
const jiti = createJiti(import.meta.url, { moduleCache: true, tryNative: true, alias: {
  '@earendil-works/pi-coding-agent': path.join(root, 'vendor/pi-rp/packages/coding-agent/dist/index.js'),
  '@earendil-works/pi-ai': path.join(root, 'vendor/pi-rp/packages/ai/dist/compat.js'),
  '@earendil-works/pi-ai/providers/all': path.join(root, 'vendor/pi-rp/packages/ai/dist/providers/all.js'),
  typebox: path.join(root, 'vendor/pi-rp/node_modules/typebox/build/index.mjs'),
} });
const { generateImageTool } = await jiti.import(path.join(root, 'extensions/toolkit/generate-image.ts'));
const { resetDepsForTests } = await jiti.import(path.join(root, 'extensions/toolkit/deps.ts'));
const prompt = process.argv.slice(2).join(' ') || 'An empty contemporary wooden cabin interior, one narrow cot, a bare wooden table and a closed timber door. Rainy night, warm dim lamp, cinematic painted mystery game background, no people, no text, no interface, no props on the table. Wide composition with quiet negative space.';
const started = performance.now();
try {
  const result = await generateImageTool.execute('image-probe', { prompt, width: 1536, height: 1024 }, undefined,
    update => console.log(`Image progress: ${update.details?.stage ?? 'working'}`),
    { cwd: world, sessionManager: { getSessionId: () => 'image-probe' } });
  const report = { measuredMs: Math.round(performance.now() - started), success: !result.isError, ...result.details };
  let safeReport = JSON.stringify(report, null, 2);
  for (const key of [process.env.OPENAI_API_KEY, process.env.OPENROUTER_API_KEY]) {
    if (key) safeReport = safeReport.split(key).join('[REDACTED]');
  }
  await fs.writeFile(path.join(world, 'result.json'), safeReport);
  console.log(safeReport);
  if (result.isError) process.exitCode = 1;
} finally { resetDepsForTests(); }
