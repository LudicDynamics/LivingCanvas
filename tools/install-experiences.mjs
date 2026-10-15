#!/usr/bin/env node
// Content compiler: reuse graphics, never replace a source template or save.
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { experiences } from './experiences/index.mjs';
import { md } from './experiences/common.mjs';
import { nookProfilePaths } from './experiences/character-nooks.mjs';
import { templateArchive } from './world-editions.mjs';
import { parseFrontmatter, WorldManifestSchema } from '../packages/shared/dist/index.js';

const repoRoot = fileURLToPath(new URL('../', import.meta.url));
const exists = async p => fs.access(p).then(() => true).catch(() => false);
function contained(root, relative) {
  if (path.isAbsolute(relative) || relative.split('/').some(s => s === '..' || s === '.airpworld')) throw new Error(`Unsafe content path: ${relative}`);
  return path.join(root, relative);
}
async function write(root, file, body) {
  const full = contained(root, file);
  await fs.mkdir(path.dirname(full), { recursive: true });
  await fs.writeFile(full, body, { flag: 'wx' });
}

export async function installExperience(repo, pack, { outputRoot = path.join(repo, '.artifacts/experience-builds'), revision = '' } = {}) {
  if (revision && !/^[a-z0-9-]+$/.test(revision)) throw new Error('Revision must be lowercase ASCII letters, digits or hyphens.');
  const id = pack.id + (revision ? `-${revision}` : '');
  const destination = path.join(outputRoot, id);
  if (await exists(destination)) throw new Error(`Refusing to overwrite ${destination}; choose --revision=<new-name>.`);
  const archived = path.join(repo, templateArchive, pack.base);
  const source = await exists(archived) ? archived : path.join(repo, 'templates', pack.base);
  if (await exists(path.join(repo, templateArchive)) && path.resolve(outputRoot) === path.join(repo, 'templates')) throw new Error('Legacy compiler output belongs in .artifacts, not the bilingual template shelf. Edit the canonical editions directly.');
  const sourceManifest = JSON.parse(await fs.readFile(path.join(source, 'world.json'), 'utf8'));
  const characterPreset = JSON.parse(await fs.readFile(path.join(repo, 'presets/character.json'), 'utf8'));
  // Reserve an exclusive directory. world.json is written last: partial builds
  // are never listed by the world's existing shelf.
  await fs.mkdir(outputRoot, { recursive: true });
  await fs.mkdir(destination);
  if (await exists(path.join(source, 'assets'))) await fs.cp(path.join(source, 'assets'), path.join(destination, 'assets'), {
    recursive: true, dereference: true,
    // Reuse media bytes, not the source world's prompt/the design notes notes.
    filter: async file => (await fs.stat(file)).isDirectory() || /\.(?:png|jpe?g|webp|gif|svg|avif|webm|mp4|mov|mp3|wav|ogg|m4a)$/i.test(file),
  });
  for (const [file, body] of Object.entries(pack.files)) await write(destination, file, body);
  await fs.mkdir(path.join(destination, 'player'));
  const playerLabels = { wuwu: '港の調査員', whitechapel: 'シャーロック・ホームズ', divergence: '常盤電器に残されたあなた', 'first-snow-jp': 'あなた · 学生ディレクター', 'magic-academy': '学院の新入生', 'unwritten-door': 'You' };
  const manifest = {
    ...sourceManifest, id, name: pack.name, description: pack.description,
    locale: pack.locale, entry: 'map', version: '1.1.0',
    genre: pack.locale === 'ja' ? '物語体験' : 'narrative experience',
    tags: pack.locale === 'ja' ? ['体験版', '短い物語', '生成する世界'] : ['playtest', 'short story', 'generative world'],
    player: { ...sourceManifest.player, id: 'player', name: playerLabels[pack.base] },
    characters: [],
  };
  delete manifest.layers;
  for (const person of pack.characters) {
    const previous = sourceManifest.characters?.find(c => c.id === person.source) ?? {};
    const profile = { ...previous, id: person.id, name: person.name, home: person.home, description: person.body, role: previous.role ?? 'npc' };
    for (const key of ['avatar', 'avatarVideo']) if (profile[key] && !await exists(contained(destination, profile[key]))) delete profile[key];
    manifest.characters.push(profile);
    const root = `characters/${person.id}`;
    const identity = 'personality.md';
    const memory = 'memory.md';
    await write(destination, `${root}/README.md`, md({ type: 'readme', name: person.name, ...(profile.avatar ? { avatar: profile.avatar } : {}), ...(profile.avatarVideo ? { avatarVideo: profile.avatarVideo } : {}) }, person.body));
    await write(destination, `${root}/${identity}`, md({ type: 'note', title: person.name, portable: false }, person.body));
    await write(destination, `${root}/${memory}`, md({ type: 'note', title: pack.locale === 'ja' ? '見聞きしたこと' : 'What I witnessed', portable: false }, pack.locale === 'ja' ? 'このプレイで交わした新しい約束はまだない。知らない場面の秘密を加えない。' : 'No new promises in this playthrough yet. Do not import secrets from unvisited scenes.'));
    const preset = {
      ...characterPreset, id: `${id}-${person.id}`, name: person.name, description: person.body,
      items: [
        { kind: 'slot', id: 'character-instruction', slot: 'system-char' },
        { kind: 'block', id: 'world-language', content: pack.locale === 'ja' ? `日本語で話す。記憶は ${root}/${memory}。この人物が実際に見聞きしたことだけ知る。` : `Speak English. Memory lives at ${root}/${memory}. Know only what this character witnessed.` },
        { kind: 'slot', id: 'profile', slot: 'file', options: { path: ['README.md', identity, memory, ...nookProfilePaths(pack.base, person)], baseDir: root, stripFrontmatter: true, onMissing: 'skip' } },
        ...(person.instructions ? [{ kind: 'block', id: 'role-context', content: person.instructions }] : []),
        { kind: 'slot', id: 'chat-history', slot: 'chat-history' },
      ],
    };
    await write(destination, `${root}/preset.json`, JSON.stringify(preset, null, 2) + '\n');
  }
  // Reuse matching motion backgrounds without importing the old English prose.
  const byBackground = new Map();
  async function scanMotion(dir) {
    for (const entry of await fs.readdir(dir, { withFileTypes: true })) {
      if (entry.isDirectory()) await scanMotion(path.join(dir, entry.name));
      else if (entry.name === 'README.md') {
        const fm = parseFrontmatter(await fs.readFile(path.join(dir, entry.name), 'utf8')).frontmatter;
        if (typeof fm?.bg === 'string' && typeof fm.bgVideo === 'string' && await exists(path.join(destination, fm.bgVideo))) byBackground.set(fm.bg, fm.bgVideo);
      }
    }
  }
  await scanMotion(path.join(source, 'world'));
  for (const scene of pack.scenes) {
    const file = path.join(destination, scene, 'README.md');
    const parsed = parseFrontmatter(await fs.readFile(file, 'utf8'));
    const fm = parsed.frontmatter;
    if (fm?.bg && !await exists(contained(destination, fm.bg))) throw new Error(`Missing scene artwork: ${id} ${fm.bg}`);
    if (byBackground.has(fm?.bg)) await fs.writeFile(file, md({ ...fm, bgVideo: byBackground.get(fm.bg) }, parsed.body));
  }
  // Optional inherited assets may not be installed on another machine.
  for (const object of [manifest, manifest.player, ...manifest.characters]) {
    for (const key of ['avatar', 'avatarVideo', 'cover']) if (object?.[key] && !await exists(contained(destination, object[key]))) delete object[key];
  }
  WorldManifestSchema.parse(manifest);
  await write(destination, 'world.json', JSON.stringify(manifest, null, 2) + '\n');
  return { id, path: destination, scenes: pack.scenes.length, characters: pack.characters.length };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const revision = process.argv.find(a => a.startsWith('--revision='))?.slice(11) ?? '';
  const selected = process.argv.find(a => a.startsWith('--world='))?.slice(8);
  const packs = selected ? experiences.filter(p => p.base === selected) : experiences;
  if (!packs.length) throw new Error('Unknown world.');
  // Preflight every target before installing any pack.
  for (const p of packs) if (await exists(path.join(repoRoot, '.artifacts/experience-builds', p.id + (revision ? `-${revision}` : '')))) throw new Error(`Build ${p.id} already exists; use --revision=<new-name>.`);
  for (const p of packs) console.log(JSON.stringify(await installExperience(repoRoot, p, { revision })));
}
