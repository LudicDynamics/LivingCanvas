#!/usr/bin/env node
/**
 * openai-image-gen.mjs — generate development assets through the OpenAI Images API.
 *
 * This is deliberately separate from the in-game generate_image action: it writes
 * directly to a workshop/publish path chosen by the developer and does not open a
 * WorldStore or emit AIRP events.
 *
 * Usage:
 *   pnpm gen:openai-image --prompt "..." -o assets/_inbox/scene.png
 *   pnpm gen:openai-image --prompt "..." --ref-image base.png -o out.png
 */

import fs from 'node:fs';
import path from 'node:path';

for (const name of ['.env.local', '.env']) {
  if (fs.existsSync(name)) process.loadEnvFile(name);
}

const API_KEY = process.env.OPENAI_API_KEY || '';
const BASE = (process.env.AIRP_IMAGE_BASE_URL || process.env.OPENAI_BASE_URL || 'https://api.openai.com/v1').replace(/\/+$/, '');
const DEFAULT_MODEL = process.env.AIRP_IMAGE_MODEL || 'openai/gpt-image-2';

function die(message, code = 1) {
  console.error(`\n✗ ${message}\n`);
  process.exit(code);
}

function parseArgs(argv) {
  const opts = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '-h' || arg === '--help') opts.help = true;
    else if (arg === '-o') opts.out = argv[++i];
    else if (arg.startsWith('--')) {
      const eq = arg.indexOf('=');
      if (eq !== -1) opts[arg.slice(2, eq)] = arg.slice(eq + 1);
      else if (argv[i + 1] !== undefined && !argv[i + 1].startsWith('-')) opts[arg.slice(2)] = argv[++i];
      else opts[arg.slice(2)] = true;
    } else opts._.push(arg);
  }
  return opts;
}

function fileMime(file) {
  const ext = path.extname(file).toLowerCase();
  if (ext === '.png') return 'image/png';
  if (ext === '.webp') return 'image/webp';
  if (ext === '.jpg' || ext === '.jpeg') return 'image/jpeg';
  die(`参考图必须是 PNG、JPEG 或 WebP：${file}`);
}

function readReference(file) {
  const absolute = path.resolve(file);
  if (!fs.existsSync(absolute)) die(`找不到参考图：${absolute}`);
  return { data: fs.readFileSync(absolute), mime: fileMime(absolute), name: path.basename(absolute) };
}

function defaultOutput(prompt) {
  const slug = String(prompt || 'image').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 48) || 'image';
  return `openai-image-${slug}-${Date.now()}.png`;
}

function outputPath(raw, prompt) {
  if (!raw) return path.resolve(defaultOutput(prompt));
  const absolute = path.resolve(raw);
  if (raw.endsWith('/') || (fs.existsSync(absolute) && fs.statSync(absolute).isDirectory())) {
    return path.join(absolute, defaultOutput(prompt));
  }
  return absolute;
}

function help() {
  console.log(`openai-image-gen — 通过 OpenAI Images API 生成开发期世界素材

用法:
  pnpm gen:openai-image --prompt "描述" [选项]

选项:
  -o, --out <路径>             输出文件或目录（默认：当前目录自动命名）
      --model <名>             默认 AIRP_IMAGE_MODEL 或 openai/gpt-image-2
      --size <尺寸>             例如 1024x1024、1536x1024、1024x1536
      --width <像素>            与 --height 一起指定尺寸
      --height <像素>
      --quality <档位>          auto | low | medium | high（默认 AIRP_IMAGE_QUALITY 或 low）
      --ref-image <路径>        参考图；有参考图时调用 /images/edits
      --json                    额外输出机器可读结果
  -h, --help                   显示帮助

环境变量:
  OPENAI_API_KEY               OpenAI 或兼容网关密钥
  AIRP_IMAGE_MODEL             模型名，默认 openai/gpt-image-2
  AIRP_IMAGE_BASE_URL          图片 API 基地址，优先于 OPENAI_BASE_URL
  OPENAI_BASE_URL              OpenAI-compatible API 基地址
  AIRP_IMAGE_QUALITY           默认 quality
`);
}

async function requestJson(url, body, headers) {
  const response = await fetch(url, { method: 'POST', headers, body: JSON.stringify(body) });
  const text = await response.text();
  let json;
  try { json = JSON.parse(text); } catch { json = null; }
  if (!response.ok) {
    const message = json?.error?.message || json?.error || text.slice(0, 500);
    die(`图片接口 HTTP ${response.status}：${message}`);
  }
  return json;
}

async function requestEdit(url, params, reference) {
  const form = new FormData();
  for (const [key, value] of Object.entries(params)) form.set(key, String(value));
  form.set('image', new Blob([reference.data], { type: reference.mime }), reference.name);
  const response = await fetch(url, { method: 'POST', headers: { Authorization: `Bearer ${API_KEY}` }, body: form });
  const text = await response.text();
  let json;
  try { json = JSON.parse(text); } catch { json = null; }
  if (!response.ok) {
    const message = json?.error?.message || json?.error || text.slice(0, 500);
    die(`图片编辑接口 HTTP ${response.status}：${message}`);
  }
  return json;
}

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  if (opts.help) return help();
  const prompt = opts.prompt || opts._[0];
  if (!prompt) die('缺少 --prompt');
  if (!API_KEY) die('缺少 OPENAI_API_KEY');

  const width = opts.width ? Number(opts.width) : null;
  const height = opts.height ? Number(opts.height) : null;
  if ((width && !height) || (!width && height)) die('--width 与 --height 必须同时提供');
  const size = opts.size || (width && height ? `${width}x${height}` : '1024x1024');
  const quality = opts.quality || process.env.AIRP_IMAGE_QUALITY || 'low';
  if (!['auto', 'low', 'medium', 'high'].includes(quality)) die(`无效的 --quality：${quality}`);

  const model = opts.model || DEFAULT_MODEL;
  const reference = opts.refImage || opts['ref-image'] ? readReference(opts.refImage || opts['ref-image']) : null;
  const params = { model: model.replace(/^openai\//, ''), prompt, n: 1, size, quality, output_format: 'png' };
  const endpoint = `${BASE}/images/${reference ? 'edits' : 'generations'}`;
  console.log(`生图  provider=openai model=${model} size=${size} quality=${quality}`);
  if (reference) console.log(`      参考图：${reference.name}`);

  const result = reference
    ? await requestEdit(endpoint, params, reference)
    : await requestJson(endpoint, params, { Authorization: `Bearer ${API_KEY}`, 'Content-Type': 'application/json' });
  const encoded = result?.data?.find((item) => typeof item?.b64_json === 'string')?.b64_json;
  if (!encoded) die('接口未返回 b64_json 图片');

  const destination = outputPath(opts.out, prompt);
  fs.mkdirSync(path.dirname(destination), { recursive: true });
  fs.writeFileSync(destination, Buffer.from(encoded, 'base64'));
  const report = { file: destination, model, size, quality, reference: reference?.name || null, bytes: fs.statSync(destination).size };
  console.log(`  ✓ ${destination}  (${report.bytes} bytes)`);
  if (opts.json) console.log(JSON.stringify(report, null, 2));
}

main().catch((error) => die(error instanceof Error ? error.message : String(error)));
