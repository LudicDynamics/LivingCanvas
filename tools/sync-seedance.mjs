// Bulk mechanical media sync: preserve prose, IDs, saves, and all static originals.
import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { parseFrontmatter } from '../packages/shared/dist/index.js';

const root = path.resolve(import.meta.dirname, '..');
const source = path.resolve(root, '../worldlines-assets/looping/seedance');
export const mediaWorlds = {
  wuwu: { source: 'wuwu-demo', scenes: { intro: ['intro'], map: ['harbor-chart', 'map'], dock: ['seventh-berth', 'dock'], workshop: ['workshop'], lighthouse: ['old-lighthouse', 'lighthouse'], beyond: ['beyond-the-fog', 'beyond'] }, characters: { viola: ['vera', 'viola'], silverkite: ['silver-kite', 'silverkite'] } },
  whitechapel: { source: 'whitechapel-demo', scenes: { intro: ['intro'], map: ['case-board', 'map'], scene3: ['scene3'], press: ['fleet-street-press', 'press'], morgue: ['whitechapel-morgue', 'morgue'], fourth: ['fourth-chapter-eve', 'fourth'] }, characters: { watson: ['watson'] } },
  divergence: { source: 'divergence-demo', scenes: { intro: ['intro'], map: ['tokiwa-electrics', 'map'], y1994: ['1994-11-02', 'y1994'], tonight: ['tonight'], ruins: ['thirty-years-later', 'ruins'], converge: ['convergence', 'converge'] }, characters: { ryo: ['ryo-child', 'ryo'] } },
  firstsnow: { source: 'firstsnow-demo', scenes: { intro: ['intro'], map: ['winter-schedule', 'map'], studio: ['radio-studio', 'studio'], cafe: ['amber-cafe', 'cafe'], rooftop: ['campus-rooftop', 'rooftop'], snowfall: ['first-snow', 'snowfall'] }, characters: { nanami: ['nanami'] } },
  'unwritten-door': { source: 'unwritten-door-demo', scenes: { intro: ['intro'] }, characters: {} },
  'magic-academy': { source: 'emberglass-demo', scenes: {}, characters: { seraphina: ['seraphina'] } },
};
mediaWorlds['first-snow-jp'] = mediaWorlds.firstsnow;

async function walk(dir) {
  const out = [];
  for (const entry of await fs.readdir(dir, { withFileTypes: true }).catch(() => [])) {
    if (entry.name.startsWith('.') || entry.isSymbolicLink()) continue;
    const file = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...await walk(file));
    else out.push(file);
  }
  return out;
}
function field(text, key, value) {
  const end = text.indexOf('\n---', 3);
  if (!text.startsWith('---\n') || end < 0) return text;
  const head = text.slice(0, end), line = `${key}: ${JSON.stringify(value)}`;
  const re = new RegExp(`^${key}:.*$`, 'm');
  return (re.test(head) ? head.replace(re, line) : `${head}\n${line}`) + text.slice(end);
}
const digest = bytes => createHash('sha256').update(bytes).digest('hex');
async function copy(input, output) {
  const bytes = await fs.readFile(input);
  const old = await fs.readFile(output).catch(() => null);
  if (!old || digest(old) !== digest(bytes)) { await fs.mkdir(path.dirname(output), { recursive: true }); await fs.copyFile(input, output); }
  return { bytes: bytes.length, sha256: digest(bytes) };
}
export async function syncSeedance() {
  const report = { worlds: [], unmatched: [] };
  const used = new Set();
  const targets = [];
  for (const area of ['templates', 'worlds']) {
    for (const entry of await fs.readdir(path.join(root, area), { withFileTypes: true })) {
      if (!entry.isDirectory() || entry.name.startsWith('.')) continue;
      const dir = path.join(root, area, entry.name);
      let manifest;
      try { manifest = JSON.parse(await fs.readFile(path.join(dir, 'world.json'), 'utf8')); } catch { continue; }
      const id = Object.keys(mediaWorlds).sort((a,b) => b.length-a.length).find(id => manifest.id === id || entry.name === id || entry.name.startsWith(`${id}-`));
      if (id) targets.push({ dir, id, manifest });
    }
  }
  // Validate all approved files before changing any world metadata.
  for (const config of new Set(Object.values(mediaWorlds))) {
    for (const scene of Object.keys(config.scenes)) await fs.access(path.join(source, config.source, 'backgrounds', `${scene}.webm`));
    for (const character of Object.keys(config.characters)) {
      const base = path.join(source, config.source, 'characters', character, 'base-transparent');
      await fs.access(`${base}.webm`);
      await fs.access(path.resolve(source, '../../worlds', config.source, 'characters', character, 'base-transparent.png'));
      const check = JSON.parse(await fs.readFile(`${base}.verification.json`, 'utf8'));
      if (!check.alpha || check.alpha.transparentFraction <= 0 || check.alpha.opaqueFraction <= 0) throw new Error(`Unverified alpha: ${base}`);
    }
  }
  for (const { dir, id, manifest } of targets) {
    const config = mediaWorlds[id], assets = [], backgrounds = new Map(), portraits = new Map();
    for (const [scene, aliases] of Object.entries(config.scenes)) {
      const rel = `${config.source}/backgrounds/${scene}.webm`;
      const dest = `assets/motion/seedance/backgrounds/${scene}.webm`;
      assets.push({ source: rel, target: dest, ...await copy(path.join(source, rel), path.join(dir, dest)) }); used.add(rel);
      aliases.forEach(alias => backgrounds.set(alias, dest));
    }
    for (const [character, aliases] of Object.entries(config.characters)) {
      const rel = `${config.source}/characters/${character}/base-transparent.webm`;
      const dest = `assets/motion/seedance/characters/${character}-transparent.webm`;
      const poster = `assets/motion/seedance/characters/${character}-transparent.webp`;
      assets.push({ source: rel, target: dest, ...await copy(path.join(source, rel), path.join(dir, dest)) }); used.add(rel);
      const staticSource = path.resolve(source, '../../worlds', config.source, 'characters', character, 'base-transparent.png');
      execFileSync('cwebp', ['-quiet', '-q', '82', '-resize', '600', '0', staticSource, '-o', path.join(dir, poster)]);
      aliases.forEach(alias => portraits.set(alias, { video: dest, poster }));
    }
    let changed = 0;
    for (const file of (await walk(dir)).filter(file => file.endsWith('.md') && !file.includes(`${path.sep}assets${path.sep}`))) {
      const text = await fs.readFile(file, 'utf8');
      const fm = parseFrontmatter(text).frontmatter;
      let next = text;
      if (typeof fm?.bg === 'string' && /^assets\/(scenes|backgrounds)\//.test(fm.bg)) {
        const stem = path.basename(fm.bg, path.extname(fm.bg));
        const video = backgrounds.get(stem);
        if (video) next = field(next, 'bgVideo', video);
      }
      const rel = path.relative(dir, file).split(path.sep).join('/');
      if (id === 'unwritten-door' && rel === 'world/README.md' && fm && !('bg' in fm)) {
        const poster = 'assets/motion/seedance/backgrounds/intro.webp';
        await copy(path.join(root, 'templates/unwritten-door/assets/backgrounds/intro.webp'), path.join(dir, poster));
        next = field(field(next, 'bg', poster), 'bgVideo', backgrounds.get('intro'));
      }
      const charId = fm?.characterId || fm?.id || (rel.startsWith('characters/') ? rel.split('/')[1] : null);
      const portrait = portraits.get(charId);
      if (portrait) { next = field(next, 'avatarVideo', portrait.video); next = field(next, 'avatar', portrait.poster); }
      if (next !== text) { await fs.writeFile(file, next); changed++; }
    }
    for (const character of manifest.characters || []) {
      const portrait = portraits.get(character.id);
      if (portrait) { character.avatarVideo = portrait.video; character.avatar = portrait.poster; }
    }
    const manifestPath = path.join(dir, 'world.json');
    const oldManifest = await fs.readFile(manifestPath, 'utf8');
    if (JSON.stringify(JSON.parse(oldManifest)) !== JSON.stringify(manifest)) await fs.writeFile(manifestPath, JSON.stringify(manifest, null, 2) + '\n');
    await fs.writeFile(path.join(dir, 'assets/motion/seedance/manifest.json'), JSON.stringify({ sourceRepository: 'worldlines-assets', assets }, null, 2) + '\n');
    report.worlds.push({ path: path.relative(root, dir), videos: assets.length, updatedMarkdown: changed });
  }
  report.unmatched = (await walk(source)).filter(file => file.endsWith('.webm')).map(file => path.relative(source,file)).filter(file => !used.has(file));
  console.log(JSON.stringify(report, null, 2));
  return report;
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await syncSeedance();
