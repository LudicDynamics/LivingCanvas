/**
 * Music and sound beds a world directory names: every
 * world.json `audio.theme` and every layer README `bgm:` / `ambient:` must be a
 * catalog id (packages/shared/src/rules/music.ts), a keyword (`silence` for
 * music, `none` for ambient; an explicit empty / null is declared silence too),
 * a bare name the WORLD ships under `assets/audio/` (a world may override or add
 * its own pool file), or an `assets/…` path that exists in the world.
 *
 * Used by `check:worlds` for every template, experimental ones included, and
 * by tools/world-bgm.test.mjs.
 */
import fs from 'node:fs/promises';
import path from 'node:path';
import { isAmbientId, isMusicId, parseFrontmatter } from '../packages/shared/dist/index.js';

const POOL = { ambient: ['ambient/{n}.mp3', 'ambient/pool/{n}.mp3'], bgm: ['bgm/{n}.mp3', 'themes/{n}.mp3'] };
const exists = (p) => fs.stat(p).then((s) => s.isFile() && s.size > 0, () => false);

async function readmes(root, dir) {
  const out = [];
  let entries = [];
  try { entries = await fs.readdir(path.join(root, dir), { withFileTypes: true }); } catch { return out; }
  for (const e of entries) {
    const rel = `${dir}/${e.name}`;
    if (e.isDirectory()) out.push(...await readmes(root, rel));
    else if (e.name === 'README.md') out.push(rel);
  }
  return out;
}

/** null = fine; else why the value names nothing. */
export async function audioRefProblem(root, value, kind) {
  if (value === null || value === undefined) return null;
  if (typeof value !== 'string') return `must be a string, got ${typeof value}`;
  const v = value.trim();
  if (v === '' || v === 'null' || v === '~') return null;
  if (kind === 'bgm' ? (v === 'silence' || isMusicId(v)) : (v === 'none' || isAmbientId(v))) return null;
  if (v.startsWith('assets/')) return (await exists(path.join(root, v))) ? null : `world asset ${v} does not exist`;
  if (v.includes('/')) return 'must be a catalog id or start with assets/';
  for (const tpl of POOL[kind]) if (await exists(path.join(root, 'assets/audio', tpl.replace('{n}', v)))) return null;
  return `"${v}" is not in the ${kind === 'bgm' ? 'music' : 'ambient'} catalog nor a world asset`;
}

/** Every audio reference problem in one world, as `file: message` lines. */
export async function audioProblems(root) {
  const problems = [];
  try {
    const manifest = JSON.parse(await fs.readFile(path.join(root, 'world.json'), 'utf8'));
    const why = await audioRefProblem(root, manifest.audio?.theme, 'bgm');
    if (why) problems.push(`world.json audio.theme: ${why}`);
  } catch { /* no world.json: not a world */ }
  for (const file of [...await readmes(root, 'world'), ...await readmes(root, 'characters')]) {
    const fm = parseFrontmatter(await fs.readFile(path.join(root, file), 'utf8')).frontmatter ?? {};
    for (const kind of ['bgm', 'ambient']) {
      if (!(kind in fm)) continue;
      const why = await audioRefProblem(root, fm[kind], kind);
      if (why) problems.push(`${file} ${kind}: ${why}`);
    }
  }
  return problems;
}
