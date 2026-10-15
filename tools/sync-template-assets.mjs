#!/usr/bin/env node
// Synchronize approved source assets without regenerating narrative content.
import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { templateArchive } from './world-editions.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const source = path.resolve(root, '../worldlines-assets/worlds');
export const mappings = {
  wuwu: {
    scenes: { intro: 'world', map: 'world/harbor-chart', dock: 'world/harbor-chart/seventh-berth', workshop: 'world/harbor-chart/workshop', lighthouse: 'world/harbor-chart/old-lighthouse', beyond: 'world/harbor-chart/beyond-the-fog' },
    characters: { viola: 'vera', silverkite: 'silver-kite', keeper: 'old-mo', detective: 'investigator' },
    player: ['investigator', 'Harbor Investigator'],
    tokens: {},
  },
  whitechapel: {
    scenes: { intro: 'world', map: 'world/case-board', press: 'world/case-board/fleet-street-press', morgue: 'world/case-board/whitechapel-morgue', fourth: 'world/case-board/fourth-chapter-eve' },
    characters: { watson: 'watson', edith: 'edith', wayne: 'wayne', blackburn: 'blackburn', tom: 'tom', holmes: 'sherlock-holmes' },
    player: ['sherlock-holmes', 'Sherlock Holmes'],
    tokens: { brasscap: 'brass-portfolio-cap' },
  },
  divergence: {
    scenes: { intro: 'world', map: 'world/tokiwa-electrics', y1994: 'world/tokiwa-electrics/1994-11-02', tonight: 'world/tokiwa-electrics/tonight', ruins: 'world/tokiwa-electrics/thirty-years-later', converge: 'world/tokiwa-electrics/convergence' },
    characters: { shopkeeper: 'shopkeeper', ryo: 'ryo-child', returner: 'returner' },
    player: ['returner', 'Returning Visitor'],
    tokens: { windfrog: 'wind-up-frog' },
  },
  firstsnow: {
    scenes: { intro: 'world', map: 'world/winter-schedule', studio: 'world/winter-schedule/radio-studio', cafe: 'world/winter-schedule/amber-cafe', rooftop: 'world/winter-schedule/campus-rooftop', snowfall: 'world/winter-schedule/first-snow' },
    characters: { nanami: 'nanami', sumi: 'sumi-yukimura', director: 'radio-director' },
    player: ['radio-director', 'Radio Director'],
    tokens: {},
  },
};

export function jobsFor(config) {
  return [
    ...Object.entries(config.scenes).map(([id, scene]) => ({ source: `backgrounds/${id}.png`, target: `assets/scenes/${scene === 'world' ? 'intro' : path.basename(scene)}.webp`, scene })),
    ...Object.entries(config.characters).map(([id, character]) => ({ source: `characters/${id}/base.png`, target: `assets/characters/${character}.webp`, character })),
    ...Object.entries(config.tokens).map(([id, item]) => ({ source: `tokens/${id}.png`, target: `assets/items/${item}.webp` })),
  ];
}

function setField(text, key, value) {
  const end = text.indexOf('\n---', 3);
  if (!text.startsWith('---\n') || end < 0) throw new Error('Missing frontmatter');
  const line = `${key}: ${JSON.stringify(value)}`;
  const header = text.slice(0, end);
  const pattern = new RegExp(`^${key}:.*$`, 'm');
  return (pattern.test(header) ? header.replace(pattern, line) : `${header}\n${line}`) + text.slice(end);
}

async function markdownFiles(dir) {
  return (await Promise.all((await fs.readdir(dir, { withFileTypes: true })).map(e => e.isDirectory() ? markdownFiles(path.join(dir, e.name)) : e.name.endsWith('.md') ? [path.join(dir, e.name)] : []))).flat();
}

async function sync() {
  if (await fs.access(path.join(root, templateArchive)).then(() => true).catch(() => false)) throw new Error('These mappings describe archived prototypes. Review the canonical bilingual scene paths before syncing assets; no files changed.');
  // Preflight all source files and destination scenes before any conversion.
  for (const [id, config] of Object.entries(mappings)) {
    const sourceWorld = path.join(source, `${id}-demo`);
    const known = new Set(jobsFor(config).map(job => job.source));
    async function checkCoverage(dir) {
      for (const entry of await fs.readdir(dir, { withFileTypes: true })) {
        const file = path.join(dir, entry.name);
        if (entry.isDirectory()) await checkCoverage(file);
        else if (/\.(png|webp|jpe?g)$/i.test(entry.name) && !known.has(path.relative(sourceWorld, file))) {
          throw new Error(`Unmapped source image: ${file}. Review its identity before syncing.`);
        }
      }
    }
    await checkCoverage(sourceWorld);
    for (const job of jobsFor(config)) {
      await fs.access(path.join(source, `${id}-demo`, job.source));
      if (job.scene) await fs.access(path.join(root, 'templates', id, job.scene, 'README.md'));
    }
  }
  for (const [id, config] of Object.entries(mappings)) {
    const world = path.join(root, 'templates', id);
    const manifestPath = path.join(world, 'world.json');
    const manifest = JSON.parse(await fs.readFile(manifestPath, 'utf8'));
    const inventory = [];
    const docs = [...await markdownFiles(path.join(world, 'world')), ...await markdownFiles(path.join(world, 'characters'))];
    for (const job of jobsFor(config)) {
      const input = path.join(source, `${id}-demo`, job.source);
      const output = path.join(world, job.target);
      await fs.mkdir(path.dirname(output), { recursive: true });
      const result = spawnSync('cwebp', ['-quiet', '-q', '82', '-m', '6', input, '-o', output], { encoding: 'utf8' });
      if (result.status !== 0) throw new Error(result.stderr || 'cwebp failed');
      inventory.push({ source: `${id}-demo/${job.source}`, target: job.target, sourceSha256: createHash('sha256').update(await fs.readFile(input)).digest('hex'), targetSha256: createHash('sha256').update(await fs.readFile(output)).digest('hex') });
      if (job.scene) {
        const file = path.join(world, job.scene, 'README.md');
        await fs.writeFile(file, setField(await fs.readFile(file, 'utf8'), 'bg', job.target));
        if (job.scene === 'world') manifest.cover = job.target;
      }
      if (job.character) {
        const character = manifest.characters.find(c => c.id === job.character);
        if (character) character.avatar = job.target;
        for (const file of docs) {
          const text = await fs.readFile(file, 'utf8');
          if (file === path.join(world, 'characters', job.character, 'README.md') || new RegExp(`^characterId: ["']?${job.character}["']?$`, 'm').test(text)) {
            await fs.writeFile(file, setField(text, 'avatar', job.target));
          }
        }
      }
    }
    manifest.player = { id: config.player[0], name: config.player[1], avatar: `assets/characters/${config.player[0]}.webp` };
    const playerFile = path.join(world, 'player/README.md');
    await fs.writeFile(playerFile, setField(setField(await fs.readFile(playerFile, 'utf8'), 'name', config.player[1]), 'avatar', manifest.player.avatar));
    await fs.writeFile(manifestPath, JSON.stringify(manifest, null, 2) + '\n');
    await fs.writeFile(path.join(world, 'assets/source-manifest.json'), JSON.stringify({ sourceRepository: 'worldlines-assets', encoding: 'webp-q82', assets: inventory }, null, 2) + '\n');
    await fs.writeFile(path.join(world, 'assets/README.md'), `# Asset inventory\n\nApproved source files come from worldlines-assets/worlds/${id}-demo, not the Canvas build cache. See source-manifest.json for source and output checksums. Images are delivered through /api/asset. Existing narrative files and unlisted legacy assets are preserved.\n\n${inventory.map(a => `- ${a.target} ← ${a.source}`).join('\n')}\n`);
    console.log(`${id}: synchronized ${inventory.length} images, ${Object.keys(config.scenes).length} scene backgrounds`);
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await sync();
