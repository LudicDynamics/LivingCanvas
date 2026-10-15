#!/usr/bin/env node
/**
 * Bring the art in existing saves up to date with their template.
 *
 * A save (worlds/<id>) is a full copy of its template taken when the game
 * started, so art replaced in the template later — new maps, portraits cut out
 * to transparency — never reaches it
 *
 *
 * Only pictures are touched: assets/maps, assets/scenes, assets/characters.
 * A save's file is replaced ONLY when its bytes equal some committed version of
 * the same template path — i.e. it is the template's own old picture, never one
 * the save changed on its own — so every overwritten file can be recovered
 * from git history. Text (README pins, cards) is never touched.
 *
 *   node tools/refresh-save-art.mjs            # dry run: list what would change
 *   node tools/refresh-save-art.mjs --write    # replace them
 */
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const ART_DIRS = ['assets/maps', 'assets/scenes', 'assets/characters'];
const write = process.argv.includes('--write');

const sha = (buf) => createHash('sha1').update(buf).digest('hex');
const git = (args, opts = {}) => execFileSync('git', args, { cwd: REPO, maxBuffer: 1 << 28, ...opts });

function filesUnder(root) {
  const out = [];
  for (const dir of ART_DIRS) {
    const abs = path.join(root, dir);
    if (!fs.existsSync(abs)) continue;
    for (const name of fs.readdirSync(abs, { recursive: true })) {
      const rel = path.join(dir, String(name));
      if (fs.statSync(path.join(root, rel)).isFile()) out.push(rel);
    }
  }
  return out;
}

/** Content hashes of every committed version of templates/<id>/<rel>. */
const historyCache = new Map();
function historicalHashes(templateRel) {
  if (historyCache.has(templateRel)) return historyCache.get(templateRel);
  const hashes = new Set();
  const revs = git(['log', '--format=%H', '--', templateRel], { encoding: 'utf8' }).split('\n').filter(Boolean);
  for (const rev of revs) {
    try { hashes.add(sha(git(['show', `${rev}:${templateRel}`]))); } catch { /* deleted in that commit */ }
  }
  historyCache.set(templateRel, hashes);
  return hashes;
}

let replaced = 0;
let kept = 0;
for (const save of fs.readdirSync(path.join(REPO, 'worlds'))) {
  const saveRoot = path.join(REPO, 'worlds', save);
  const manifest = path.join(saveRoot, 'world.json');
  if (!fs.existsSync(manifest)) continue;
  let templateId;
  try { templateId = JSON.parse(fs.readFileSync(manifest, 'utf8')).id; } catch { continue; }
  const templateRoot = path.join(REPO, 'templates', String(templateId));
  if (!templateId || !fs.existsSync(templateRoot)) continue;

  for (const rel of filesUnder(templateRoot)) {
    const savePath = path.join(saveRoot, rel);
    if (!fs.existsSync(savePath)) continue;
    const now = fs.readFileSync(path.join(templateRoot, rel));
    const theirs = fs.readFileSync(savePath);
    if (sha(now) === sha(theirs)) continue;
    const templateRel = path.posix.join('templates', String(templateId), rel.split(path.sep).join('/'));
    if (!historicalHashes(templateRel).has(sha(theirs))) {
      kept += 1;
      console.log(`  keep   ${save}/${rel}  (changed by the save itself)`);
      continue;
    }
    replaced += 1;
    console.log(`  ${write ? 'update' : 'would '} ${save}/${rel}`);
    if (write) fs.writeFileSync(savePath, now);
  }
}
console.log(`\n${write ? 'Updated' : 'Would update'} ${replaced} file(s); kept ${kept} the saves changed themselves.${write ? '' : ' Run with --write to apply.'}`);
