#!/usr/bin/env node
/**
 * motion-clip.mjs — turn a green-screen / plate video into a canvas-ready asset.
 *
 * Two jobs, one tool:
 *   alpha  — key a green-screen portrait clip into a transparent VP9/WebM
 *            (the "living portrait" that sits on the canvas like a sticker).
 *   bg     — compress a plate video (or still) into a small seamless-loop
 *            WebM for the full-screen scene backdrop.
 *
 * THE TRAP THIS TOOL EXISTS TO AVOID:
 *   ffmpeg's NATIVE vp9 decoder silently drops the alpha plane of a WebM.
 *   `ffprobe` will even report alpha_mode=1 while the decoded pixels are
 *   fully opaque. Any quality check MUST decode with `-c:v libvpx-vp9`.
 *   `verifyAlpha()` below does exactly that — do not "simplify" it away.
 *
 * Usage:
 *   node tools/motion-clip.mjs <input> -o <out.webm> [options]
 *
 * Run `node tools/motion-clip.mjs --help` for the full option list.
 *
 * Producer runbook + the lessons that produced this file:
 *   assets/skills/motion-portrait/SKILL.md
 */

import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const PAPER = '0xf4ecd8'; // --paper canvas colour used for preview compositing

// ---------------------------------------------------------------------------
// shell helpers
// ---------------------------------------------------------------------------

const FFMPEG = process.env.FFMPEG || 'ffmpeg';
const FFPROBE = process.env.FFPROBE || 'ffprobe';

/** Run ffmpeg/ffprobe, capture stdout as a Buffer. Throws on non-zero exit. */
function runCapture(bin, args) {
  return execFileSync(bin, args, { maxBuffer: 1 << 28 });
}

/** Run a command with inherited stdio (so progress is visible). */
function runLive(bin, args) {
  execFileSync(bin, args, { stdio: ['ignore', 'inherit', 'inherit'] });
}

function ffprobeJson(file) {
  const out = runCapture(FFPROBE, [
    '-v', 'error',
    '-select_streams', 'v:0',
    '-show_entries', 'stream=width,height,r_frame_rate,nb_frames,pix_fmt',
    '-of', 'json',
    file,
  ]);
  return JSON.parse(out.toString()).streams[0];
}

function videoDims(file) {
  const s = ffprobeJson(file);
  const [num, den] = (s.r_frame_rate || '0/1').split('/').map(Number);
  return {
    width: s.width,
    height: s.height,
    fps: den ? num / den : 0,
    frames: Number(s.nb_frames) || 0,
    pixFmt: s.pix_fmt,
  };
}

// ---------------------------------------------------------------------------
// colour probing
// ---------------------------------------------------------------------------

function rgbDist(a, b) {
  return Math.sqrt((a[0] - b[0]) ** 2 + (a[1] - b[1]) ** 2 + (a[2] - b[2]) ** 2);
}

function toHex([r, g, b]) {
  return '0x' + [r, g, b].map((v) => v.toString(16).padStart(2, '0')).join('');
}

function parseHexColor(s) {
  const m = /^(?:0x|#)?([0-9a-f]{6})$/i.exec(s.trim());
  if (!m) throw new Error(`not a hex colour: ${s}`);
  const n = parseInt(m[1], 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

/**
 * Average colour of a small top-left patch, one sample per frame.
 * One ffmpeg pass, 3 bytes per frame — cheap even for long clips.
 */
function probeCorners(file) {
  const buf = runCapture(FFMPEG, [
    '-v', 'error', '-i', file,
    '-vf', 'crop=8:8:0:0,scale=1:1:flags=area',
    '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-',
  ]);
  const n = Math.floor(buf.length / 3);
  const out = [];
  for (let i = 0; i < n; i++) out.push([buf[i * 3], buf[i * 3 + 1], buf[i * 3 + 2]]);
  return out;
}

/** Most common corner colour in the back half — that is the plate behind the subject. */
function dominantBackColor(corners) {
  const tail = corners.slice(Math.floor(corners.length / 2));
  const counts = new Map();
  for (const c of tail) {
    const k = c.join(',');
    counts.set(k, (counts.get(k) || 0) + 1);
  }
  let best = null;
  let bestN = -1;
  for (const [k, v] of counts) {
    if (v > bestN) {
      bestN = v;
      best = k;
    }
  }
  return best ? best.split(',').map(Number) : [0, 0, 0];
}

/** First frame whose corner matches `key` for 3 consecutive frames (screen "arrives"). */
function detectTrimStart(corners, key, tol = 40) {
  let run = 0;
  for (let i = 0; i < corners.length; i++) {
    if (rgbDist(corners[i], key) < tol) {
      if (++run >= 3) return Math.max(0, i - 2);
    } else {
      run = 0;
    }
  }
  return 0;
}

function screenKind([r, g, b]) {
  if (g > r + 30 && g > b + 30) return 'green';
  if (b > r + 30 && b > g + 30) return 'blue';
  return null;
}

// ---------------------------------------------------------------------------
// verification — the whole point of this tool
// ---------------------------------------------------------------------------

/** Decode the FIRST frame the RIGHT way and report the true alpha statistics. */
function alphaStats(file) {
  const { width, height } = videoDims(file);
  // No `-c:v libvpx-vp9` here => native decoder => alpha silently flattened.
  const buf = runCapture(FFMPEG, [
    '-v', 'error',
    '-c:v', 'libvpx-vp9',
    '-i', file,
    '-frames:v', '1',
    '-f', 'rawvideo', '-pix_fmt', 'rgba', '-',
  ]);
  const px = width * height;
  if (buf.length < px * 4) return null;
  const seen = new Set();
  let transparent = 0;
  for (let i = 0; i < px; i++) {
    const a = buf[i * 4 + 3];
    if (a < 128) transparent++;
    if (seen.size < 300) seen.add(a);
  }
  return { width, height, transparentRatio: transparent / px, distinct: seen.size };
}

// ---------------------------------------------------------------------------
// filter graph
// ---------------------------------------------------------------------------

export function buildAlphaFilter(opts, key) {
  const parts = [];
  if (opts.trimStart > 0) parts.push(`trim=start_frame=${opts.trimStart}`);
  parts.push('setpts=PTS-STARTPTS');
  parts.push(`chromakey=${key}:${opts.similarity}:${opts.blend}`);
  if (opts.despill) {
    // `expand` stays 0 by default (see parseArgs): it is not a spill-removal knob.
    parts.push(`despill=type=${opts.screenType}:mix=${opts.despillMix}:expand=${opts.despillExpand}`);
  }
  if (opts.scale) parts.push(`scale=${opts.scale}:-2:flags=lanczos`);
  parts.push('format=yuva420p');
  return parts.join(',');
}

function buildBgFilter(opts) {
  const parts = [];
  if (opts.trimStart > 0) parts.push(`trim=start_frame=${opts.trimStart}`);
  parts.push('setpts=PTS-STARTPTS');
  if (opts.scale) parts.push(`scale=${opts.scale}:-2:flags=lanczos`);
  parts.push('format=yuv420p');
  return parts.join(',');
}

/** Forward + reverse concat = a perfect loop, at the cost of doubled motion duration. */
function pingpongGraph(filter, withAlpha) {
  const fmt = withAlpha ? 'yuva420p' : 'yuv420p';
  return (
    `[0:v]${filter},format=${fmt},split[a][b];` +
    `[b]reverse[r];[a][r]concat=n=2:v=1:a=0,format=${fmt}[v]`
  );
}

/**
 * Crossfade the head into the tail so the result loops without a visible jump.
 * Recipe: play clip[d:], then blend the last d seconds back into clip[:d].
 * Out length = N - d; the first and last output frames are both clip[d].
 */
function loopFadeGraph(filter, fadeSec, totalSec, withAlpha) {
  const fmt = withAlpha ? 'yuva420p' : 'yuv420p';
  const d = fadeSec;
  const offset = totalSec - 2 * d;
  return (
    `[0:v]${filter},format=${fmt},split[main][head];` +
    `[main]trim=start=${d},setpts=PTS-STARTPTS[m];` +
    `[head]trim=0:${d},setpts=PTS-STARTPTS[h];` +
    `[m][h]xfade=transition=fade:duration=${d}:offset=${offset},format=${fmt}[v]`
  );
}

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

const HELP = `motion-clip — green-screen clip -> transparent WebM (or plate -> loop WebM)

Usage:
  node tools/motion-clip.mjs <input> -o <out.webm> [options]

Core:
  -o, --out <path>        output path (required)
  --mode <auto|alpha|bg>  alpha = keyed transparent portrait, bg = plain loop
                          (default auto: alpha when a green/blue screen is found)
  --trim-start <auto|n>   frames to drop before the screen appears (default auto)
  --fps <n>               resample fps (default: keep source)

Chroma key (alpha mode):
  --key-color <auto|hex>  key colour, e.g. 0x1e8549 (default auto)
  --similarity <f>        chromakey similarity 0..1        (default 0.12)
  --blend <f>             chromakey edge blend 0..1        (default 0.03)
  --despill-mix <f>       despill spillmap mix 0..1        (default 0.6)
  --despill-expand <f>    despill spillmap expand 0..1     (default 0)
  --no-despill            skip the green-spill pass

Encoding:
  --scale <width>         downscale to this width (default: keep source)
  --crf <n>               quality, lower = bigger (default 30 alpha / 34 bg)

Loop sealing:
  --pingpong              forward + reversed = perfect loop (doubles duration)
  --loop-fade <sec>       crossfade tail into head (default 0 = off)

Output:
  --preview <path>        also render a still composited on the paper colour
  --no-verify             skip the decode-and-check-alpha step
  --ffmpeg <bin>          ffmpeg binary (default $FFMPEG or "ffmpeg")
`;

export function parseArgs(argv) {
  const o = {
    input: null,
    out: null,
    mode: 'auto',
    trimStart: 'auto',
    fps: 0,
    keyColor: 'auto',
    similarity: 0.12,
    blend: 0.03,
    despill: true,
    // 0 — matching ffmpeg's own `despill` default. Measured on three plates:
    // `expand` removes no spill that `mix` has not already removed, and only
    // eats the subject's green channel (an off-white blouse turns pink).
    // Raise it only if a specific plate still shows fringing.
    despillMix: 0.6,
    despillExpand: 0,
    scale: 0,
    crf: 0,
    pingpong: false,
    loopFade: 0,
    preview: null,
    verify: true,
  };
  const num = (v, name) => {
    const n = Number(v);
    if (!Number.isFinite(n)) throw new Error(`${name} expects a number, got "${v}"`);
    return n;
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    switch (a) {
      case '-h': case '--help': o.help = true; break;
      case '-o': case '--out': o.out = argv[++i]; break;
      case '--mode': o.mode = argv[++i]; break;
      case '--trim-start':
        o.trimStart = argv[++i] === 'auto' ? 'auto' : num(argv[i], '--trim-start');
        break;
      case '--fps': o.fps = num(argv[++i], '--fps'); break;
      case '--key-color': o.keyColor = argv[++i]; break;
      case '--similarity': o.similarity = num(argv[++i], '--similarity'); break;
      case '--blend': o.blend = num(argv[++i], '--blend'); break;
      case '--despill-mix': o.despillMix = num(argv[++i], '--despill-mix'); break;
      case '--despill-expand': o.despillExpand = num(argv[++i], '--despill-expand'); break;
      case '--no-despill': o.despill = false; break;
      case '--scale': o.scale = num(argv[++i], '--scale'); break;
      case '--crf': o.crf = num(argv[++i], '--crf'); break;
      case '--pingpong': o.pingpong = true; break;
      case '--loop-fade': o.loopFade = num(argv[++i], '--loop-fade'); break;
      case '--preview': o.preview = argv[++i]; break;
      case '--no-verify': o.verify = false; break;
      case '--ffmpeg': process.env.FFMPEG = argv[++i]; break;
      default:
        if (a.startsWith('-')) throw new Error(`unknown option: ${a}`);
        if (!o.input) o.input = a;
        else throw new Error(`unexpected argument: ${a}`);
    }
  }
  return o;
}

// ---------------------------------------------------------------------------
// main
// ---------------------------------------------------------------------------

function main() {
  let opts;
  try {
    opts = parseArgs(process.argv.slice(2));
  } catch (e) {
    console.error(`error: ${e.message}\n\n${HELP}`);
    process.exit(2);
  }
  if (opts.help) {
    console.log(HELP);
    return;
  }
  if (!opts.input || !opts.out) {
    console.error(`error: <input> and --out are required\n\n${HELP}`);
    process.exit(2);
  }
  if (!fs.existsSync(opts.input)) {
    console.error(`error: input not found: ${opts.input}`);
    process.exit(2);
  }

  const dims = videoDims(opts.input);
  console.log(`input : ${opts.input} (${dims.width}x${dims.height} @ ${dims.fps || '?'}fps, ${dims.frames || '?'} frames)`);

  const corners = probeCorners(opts.input);
  const back = dominantBackColor(corners);
  const kind = screenKind(back);

  // ---- decide mode -------------------------------------------------------
  let mode = opts.mode;
  if (mode === 'auto') mode = kind ? 'alpha' : 'bg';
  if (mode === 'alpha' && !kind && opts.keyColor === 'auto') {
    console.error(`error: auto mode found no green/blue screen (dominant back colour ${toHex(back)}).`);
    console.error(`       pass --key-color 0xRRGGBB to force it, or --mode bg for a plain plate.`);
    process.exit(2);
  }

  // ---- key colour & trim -------------------------------------------------
  let key = null;
  let screenType = kind || 'green';
  if (mode === 'alpha') {
    key = opts.keyColor === 'auto' ? toHex(back) : toHex(parseHexColor(opts.keyColor));
    if (opts.keyColor !== 'auto') screenType = screenKind(parseHexColor(opts.keyColor)) || 'green';
  }

  let trimStart = 0;
  if (opts.trimStart === 'auto') {
    trimStart = mode === 'alpha' ? detectTrimStart(corners, mode === 'alpha' ? back : null) : 0;
  } else {
    trimStart = opts.trimStart;
  }
  if (mode === 'alpha') {
    console.log(`key   : ${key} (${screenType} screen)`);
    console.log(`trim  : drop first ${trimStart} frame(s)` + (trimStart > 0 ? ' (leading non-screen frames)' : ''));
  } else {
    console.log('mode  : bg (plain plate loop)');
  }

  const crf = opts.crf || (mode === 'alpha' ? 30 : 34);
  const withAlpha = mode === 'alpha';
  const filter = withAlpha
    ? buildAlphaFilter({ ...opts, screenType, trimStart }, key)
    : buildBgFilter({ ...opts, trimStart });

  // ---- assemble the ffmpeg command --------------------------------------
  const args = ['-y', '-v', 'error', '-i', opts.input];
  const enc = [];
  if (opts.fps) {
    args.splice(3, 0, '-r', String(opts.fps));
  }

  if (opts.pingpong) {
    args.push('-filter_complex', pingpongGraph(filter, withAlpha), '-map', '[v]');
  } else if (opts.loopFade > 0) {
    const fps = opts.fps || dims.fps || 24;
    // Duration AFTER the trim: the graph's offsets are relative to the trimmed clip.
    const totalSec = (dims.frames ? dims.frames - trimStart : 0) / fps;
    if (!totalSec || opts.loopFade * 2 >= totalSec) {
      console.error(`error: --loop-fade ${opts.loopFade}s is too long for a ${totalSec.toFixed(2)}s clip (needs < half)`);
      process.exit(2);
    }
    args.push('-filter_complex', loopFadeGraph(filter, opts.loopFade, totalSec, withAlpha), '-map', '[v]');
  } else {
    args.push('-vf', filter);
  }

  enc.push(
    '-c:v', 'libvpx-vp9',
    '-crf', String(crf),
    '-b:v', '0',
    '-auto-alt-ref', '0', // required for alpha; harmless for bg
    '-pix_fmt', withAlpha ? 'yuva420p' : 'yuv420p',
    '-an',
    opts.out,
  );

  fs.mkdirSync(path.dirname(path.resolve(opts.out)), { recursive: true });
  console.log(`encode: crf=${crf} ${withAlpha ? 'alpha' : 'opaque'}${opts.pingpong ? ' pingpong' : ''}${opts.loopFade ? ` loop-fade=${opts.loopFade}s` : ''}`);
  runLive(FFMPEG, [...args, ...enc]);

  const size = fs.statSync(opts.out).size;
  console.log(`wrote : ${opts.out} (${(size / 1024 / 1024).toFixed(2)} MB)`);

  // ---- verify ------------------------------------------------------------
  if (opts.verify) {
    const st = alphaStats(opts.out);
    if (!st) {
      console.error('verify: could not decode the output — inspect manually');
      process.exitCode = 1;
    } else if (withAlpha) {
      const pct = (st.transparentRatio * 100).toFixed(1);
      if (st.transparentRatio < 0.005) {
        console.error(`verify: FAIL — alpha looks fully opaque (transparent ${pct}%).`);
        console.error('        the key colour probably missed the plate; check --key-color / --similarity.');
        process.exitCode = 1;
      } else {
        console.log(`verify: OK — ${pct}% transparent, ${st.distinct} distinct alpha levels (decoded via libvpx-vp9)`);
        if (st.distinct < 16) {
          console.log('        note: few alpha levels => hard edges. Raise --blend for softer matting.');
        }
      }
    } else {
      console.log('verify: OK — opaque video decoded');
    }
  }

  // ---- preview -----------------------------------------------------------
  if (opts.preview) {
    const { width, height } = videoDims(opts.out);
    const src = withAlpha
      ? `[1:v]format=yuva420p,setpts=PTS-STARTPTS[v1];[0:v][v1]overlay=format=auto:shortest=1,format=rgb24[v]`
      : `[1:v]format=yuv420p,setpts=PTS-STARTPTS,scale=${width}:${height}[v]`;
    runLive(FFMPEG, [
      '-y', '-v', 'error',
      '-f', 'lavfi', '-i', `color=c=${PAPER}:s=${width}x${height}`,
      '-c:v', 'libvpx-vp9', '-i', opts.out,
      '-filter_complex', src,
      '-map', '[v]', '-frames:v', '1', opts.preview,
    ]);
    console.log(`preview: ${opts.preview} (first frame on paper colour)`);
  }
}

// Only run when invoked directly; the test imports the pure parts. A gate that
// never fires is coverage theatre — without this, `--despill-expand` could drift
// back to 0.4 and nothing would notice (it did: see the note in parseArgs).
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
