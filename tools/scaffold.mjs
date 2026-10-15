#!/usr/bin/env node
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { LocalWorldStore } from '../packages/shared/dist/index.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const REPO_ROOT = path.resolve(__dirname, '..');
const TEMPLATES_DIR = path.join(REPO_ROOT, 'templates');

function parseArgs() {
  const args = process.argv.slice(2);
  const options = {
    template: 'whitechapel',
    out: '',
    name: '',
    author: 'Player',
  };

  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--template' || args[i] === '-t') {
      options.template = args[++i];
    } else if (args[i] === '--out' || args[i] === '-o') {
      options.out = args[++i];
    } else if (args[i] === '--name' || args[i] === '-n') {
      options.name = args[++i];
    } else if (args[i] === '--author' || args[i] === '-a') {
      options.author = args[++i];
    } else if (!options.out) {
      options.out = args[i];
    }
  }

  if (!options.out) {
    options.out = path.join(REPO_ROOT, 'worlds', `${options.template}-play-${Date.now().toString().slice(-4)}`);
  }

  return options;
}

async function scaffold() {
  const options = parseArgs();
  const srcTemplate = path.join(TEMPLATES_DIR, options.template);
  const targetDir = path.resolve(options.out);

  try {
    await fs.access(srcTemplate);
  } catch {
    console.error(`Error: Template "${options.template}" not found in ${TEMPLATES_DIR}`);
    console.log(`Available templates:`);
    const available = await fs.readdir(TEMPLATES_DIR);
    for (const t of available) console.log(`  - ${t}`);
    process.exit(1);
  }

  console.log(`[AIRP Scaffold] Creating new world from "${options.template}"...`);
  console.log(`Target: ${targetDir}`);

  await fs.mkdir(targetDir, { recursive: true });
  await fs.cp(srcTemplate, targetDir, { recursive: true });

  const worldJsonPath = path.join(targetDir, 'world.json');
  try {
    const raw = await fs.readFile(worldJsonPath, 'utf-8');
    const manifest = JSON.parse(raw);
    if (options.name) manifest.name = options.name;
    if (options.author) manifest.author = options.author;
    manifest.id = `${manifest.id}-${Date.now().toString(36)}`;
    manifest.createdAt = new Date().toISOString();
    manifest.updatedAt = new Date().toISOString();
    await fs.writeFile(worldJsonPath, JSON.stringify(manifest, null, 2), 'utf-8');
  } catch (err) {
    console.warn(`[AIRP Scaffold] Warning: could not update world.json: ${err.message}`);
  }

  // Ensure .airpworld exists and initialize SQLite databases
  await fs.mkdir(path.join(targetDir, '.airpworld'), { recursive: true });
  const store = new LocalWorldStore(targetDir);
  const manifest = await store.getManifest();
  console.log(`[AIRP Scaffold] World initialized: "${manifest.name}" (${manifest.id})`);
  console.log(`Layers (scanned from directories): ${Object.keys(manifest.layers || {}).join(', ')}`);
  console.log(`Characters: ${(manifest.characters || []).map(c => c.id).join(', ')}`);
  store.close();
  console.log(`[AIRP Scaffold] Ready! Run server and point to: ${targetDir}`);
}

scaffold().catch((err) => {
  console.error('[AIRP Scaffold] Failed:', err);
  process.exit(1);
});
