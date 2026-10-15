#!/usr/bin/env node
/**
 * verify-emotions.mjs — mechanical acceptance gate for character media
 * across every template. It decodes alpha and verifies provenance without
 * imposing a fixed output resolution or aspect ratio.
 *
 * Checks:
 *   A. every discovered emotion set has all 6 webp files
 *   B. every emotion webp decodes to TRUE alpha
 *   C. every discovered transparent character webm has real alpha
 *   D. character-media.json parses; recorded asset digests match the bytes
 *   E. firstsnow ↔ first-snow-jp share identical published media
 *   F. image-only background/avatar references do not bypass a same-name video
 *
 * Dimensions are reported as advisories only. Runtime layout owns the
 * presentation box; production dimensions remain recommended values.
 *
 * Usage: node tools/verify-emotions.mjs [--world <template>] [--all] [--json]
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const EMOTIONS = ['normal', 'smile', 'shock', 'sad', 'angry', 'thinking'];

function templateDirs() {
  return fs.readdirSync(path.join(ROOT, 'templates'), { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && fs.existsSync(path.join(ROOT, 'templates', entry.name, 'world.json')))
    .map((entry) => entry.name)
    .sort();
}

function templatePath(world) {
  return path.join(ROOT, 'templates', world);
}
/**
 * Fraction of pixels with alpha < 128, plus dimensions.
 *
 * `webp` goes through `dwebp` (libwebp), NOT ffmpeg: this box's ffmpeg webp
 * decoder intermittently fails on valid files ("Invalid data found") that
 * `dwebp` and the browser decode fine — a decoder bug, not a bad asset.
 * `webm` MUST name `-c:v libvpx-vp9`, or alpha is silently dropped.
 */
function decodeAlpha(file, kind) {
  if (kind === 'webp') {
    const tmp = path.join(os.tmpdir(), `verify-emotions-${process.pid}-${path.basename(file)}.png`);
    try {
      execFileSync('dwebp', ['-quiet', file, '-o', tmp], { maxBuffer: 1 << 28 });
      const raw = execFileSync('ffmpeg', ['-v', 'error', '-i', tmp, '-f', 'rawvideo', '-pix_fmt', 'rgba', '-'], {
        maxBuffer: 1 << 28,
      });
      return alphaStats(raw);
    } finally {
      fs.rmSync(tmp, { force: true });
    }
  }
  const raw = execFileSync(
    'ffmpeg',
    ['-v', 'error', '-c:v', 'libvpx-vp9', '-i', file, '-frames:v', '1', '-f', 'rawvideo', '-pix_fmt', 'rgba', '-'],
    { maxBuffer: 1 << 28 }
  );
  return alphaStats(raw);
}

function alphaStats(raw) {
  const n = raw.length / 4;
  if (n === 0) return { width: 0, height: 0, transparentRatio: 0, pixels: 0 };
  let transparent = 0;
  for (let i = 3; i < raw.length; i += 4) if (raw[i] < 128) transparent++;
  return { width: 0, height: 0, transparentRatio: transparent / n, pixels: n };
}

function probeDims(file) {
  const out = execFileSync(
    'ffprobe',
    ['-v', 'error', '-select_streams', 'v:0', '-show_entries', 'stream=width,height', '-of', 'csv=p=0', file],
    { encoding: 'utf8' }
  );
  const [w, h] = out.trim().split(',').map(Number);
  return { width: w, height: h };
}

const sha256 = (file) => createHash('sha256').update(fs.readFileSync(file)).digest('hex');

// ---------------------------------------------------------------------------
// checks
// ---------------------------------------------------------------------------

function emotionCharacters(template) {
  const ids = new Set();
  const chars = path.join(template, 'assets', 'characters');
  if (fs.existsSync(chars)) {
    for (const entry of fs.readdirSync(chars, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      if (EMOTIONS.some((emo) => fs.existsSync(path.join(chars, entry.name, `${emo}.webp`)))) ids.add(entry.name);
    }
  }
  const manifest = path.join(template, 'assets', 'character-media.json');
  if (fs.existsSync(manifest)) {
    try {
      for (const row of JSON.parse(fs.readFileSync(manifest, 'utf8')).assets || []) {
        if (row.emo) ids.add(row.character);
      }
    } catch {
      // checkManifest reports the parse failure with the template name.
    }
  }
  return [...ids].sort();
}

function checkPublishDir(template, id, findings, advisories) {
  const world = path.basename(template);
  const dir = path.join(template, 'assets', 'characters', id);
  for (const emo of EMOTIONS) {
    const f = path.join(dir, `${emo}.webp`);
    if (!fs.existsSync(f)) {
      findings.push(`A ${world}/${id}/${emo}: missing`);
      continue;
    }
    const { width, height } = probeDims(f);
    const { transparentRatio, pixels } = decodeAlpha(f, 'webp');
    if (pixels === 0) findings.push(`B ${world}/${id}/${emo}: decoded to zero pixels`);
    else if (transparentRatio <= 0) findings.push(`B ${world}/${id}/${emo}: no transparent pixels (flattened)`);
    const ratio = height / width;
    if (!(ratio >= 1.7 && ratio <= 1.85)) {
      advisories.push(`C ${world}/${id}/${emo}: ${width}x${height} (recommended portrait ratio ~9:16)`);
    }
  }
}

function checkClip(file, advisories, findings) {
  const rel = path.relative(ROOT, file);
  const { width, height } = probeDims(file);
  const { transparentRatio, pixels } = decodeAlpha(file, 'webm');
  if (pixels === 0) findings.push(`D ${rel}: decoded to zero pixels`);
  else if (transparentRatio <= 0) findings.push(`D ${rel}: webm has no transparency`);
  if (!(width === 360 && height === 640)) {
    advisories.push(`C ${rel}: ${width}x${height} (recommended character output 360x640)`);
  }
}

function walk(dir, prefix = '') {
  const out = [];
  if (!fs.existsSync(dir)) return out;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const rel = path.posix.join(prefix, entry.name);
    if (entry.isDirectory()) out.push(...walk(path.join(dir, entry.name), rel));
    else out.push(rel);
  }
  return out;
}


function checkClips(template, findings, advisories) {
  const dir = path.join(template, 'assets', 'motion', 'seedance', 'characters');
  if (!fs.existsSync(dir)) return;
  for (const file of fs.readdirSync(dir).filter((name) => name.endsWith('-transparent.webm'))) {
    checkClip(path.join(dir, file), advisories, findings);
  }
}
function checkVideoPreference(template, findings) {
  const assetRoot = path.join(template, 'assets');
  const videos = walk(assetRoot)
    .filter((file) => file.endsWith('.webm'))
    .map((file) => path.basename(file, '.webm'));
  for (const rel of walk(template).filter((file) => file.endsWith('.md'))) {
    const file = path.join(template, rel);
    const text = fs.readFileSync(file, 'utf8');
    const frontmatter = text.match(/^---\n([\s\S]*?)\n---/)?.[1];
    if (!frontmatter) continue;
    for (const [field, videoField] of [['bg', 'bgVideo'], ['avatar', 'avatarVideo']]) {
      const image = frontmatter.match(new RegExp(`^${field}:\\s*[\"']?([^\\s\"']+)`, 'm'))?.[1];
      if (!image || !image.startsWith('assets/') || !/\.(png|jpe?g|webp)$/i.test(image)) continue;
      if (new RegExp(`^${videoField}:`, 'm').test(frontmatter)) continue;
      const stem = path.basename(image, path.extname(image));
      const names = field === 'avatar' ? [stem, `${stem}-transparent`] : [stem];
      if (videos.some((video) => names.includes(video))) {
        findings.push(`F ${path.relative(ROOT, file)}: ${field} references an image while a same-name webm exists; add ${videoField}`);
      }
    }
  }
}

function checkManifest(template, findings) {
  const world = path.basename(template);
  const p = path.join(template, 'assets', 'character-media.json');
  if (!fs.existsSync(p)) {
    findings.push(`D ${world}: character-media.json missing`);
    return;
  }
  let manifest;
  try {
    manifest = JSON.parse(fs.readFileSync(p, 'utf8'));
  } catch (error) {
    findings.push(`D ${world}: character-media.json does not parse (${error.message})`);
    return;
  }
  for (const row of manifest.assets || []) {
    const rel = row.asset || row.target;
    if (!rel) continue;
    const asset = path.join(template, rel);
    if (!fs.existsSync(asset)) {
      findings.push(`D ${world}: manifest target missing ${rel}`);
      continue;
    }
    const expected = row.assetSha256 || row.targetSha256 || row.sha256;
    if (expected && sha256(asset) !== expected) findings.push(`D ${world}: asset digest stale for ${rel}`);
  }
}

function checkTemplate(template, findings, advisories) {
  const emotionIds = emotionCharacters(template);
  for (const id of emotionIds) checkPublishDir(template, id, findings, advisories);
  const manifestPath = path.join(template, 'assets', 'character-media.json');
  if (emotionIds.length > 0 && !fs.existsSync(manifestPath)) {
    findings.push(`D ${path.basename(template)}: character-media.json missing`);
  } else if (fs.existsSync(manifestPath)) {
    checkManifest(template, findings);
  }
  checkClips(template, findings, advisories);
  checkVideoPreference(template, findings);
}

function checkDoubleWorld(findings) {
  const a = templatePath('firstsnow');
  const b = templatePath('first-snow-jp');
  if (!fs.existsSync(a) || !fs.existsSync(b)) return;
  for (const rel of walk(b)) {
    if (!rel.startsWith('assets/')) continue;
    if (/\.(md|json)$/.test(rel) && rel !== 'assets/character-media.json') continue;
    const other = path.join(a, rel);
    if (!fs.existsSync(other)) {
      findings.push(`F first-snow-jp: counterpart missing ${rel}`);
      continue;
    }
    if (sha256(path.join(b, rel)) !== sha256(other)) findings.push(`F first-snow-jp: byte mismatch ${rel}`);
  }
}

// ---------------------------------------------------------------------------
// cli
// ---------------------------------------------------------------------------

function main() {
  const argv = process.argv.slice(2);
  const json = argv.includes('--json');
  const all = argv.includes('--all');
  let worldArg = null;
  for (let i = 0; i < argv.length; i++) if (argv[i] === '--world') worldArg = argv[++i];

  for (const bin of ['ffmpeg', 'ffprobe', 'dwebp']) {
    try {
      execFileSync('which', [bin], { stdio: 'ignore' });
    } catch {
      console.error(`missing required binary: ${bin}`);
      process.exit(2);
    }
  }

  const available = templateDirs();
  const worlds = worldArg ? [worldArg] : available;
  if (worlds.some((world) => !available.includes(world))) {
    console.error(`unknown template "${worlds.find((world) => !available.includes(world))}"`);
    process.exit(2);
  }
  const findings = [];
  const advisories = [];
  for (const world of worlds) checkTemplate(templatePath(world), findings, advisories);
  if (all || !worldArg) checkDoubleWorld(findings);

  const report = { worlds, findings, advisories, clean: findings.length === 0 };
  if (json) console.log(JSON.stringify(report, null, 2));
  else {
    if (findings.length === 0) console.log(`verify-emotions: clean (${worlds.join(', ')})`);
    else {
      console.error(`verify-emotions: ${findings.length} finding(s)`);
      for (const finding of findings) console.error(`  ✗ ${finding}`);
    }
    for (const advisory of advisories) console.log(`  ℹ ${advisory}`);
  }
  process.exit(findings.length ? 1 : 0);
}
main();
