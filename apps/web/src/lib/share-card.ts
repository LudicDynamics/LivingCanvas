/**
 * Share cards: a PNG drawn entirely in this tab with canvas 2D —
 * nothing leaves the page, and every picture drawn comes from this origin (the world's assets through
 * `/api/…`, the runtime's VFS, or a blob kept by lib/share-art.ts), so the canvas is never tainted and
 * `toBlob` always works.
 *
 *   renderInviteCard(input)  「邀请好友」: the CG full-bleed, world title in the world's display font, ending
 *                            name + a one-line quote, the LivingCanvas wordmark, and a glass band with the
 *                            invite code (big, unambiguous letters), the link and a QR code.
 *   renderResultCard(input)  the ending / 复盘 result: world, ending, playtime, turns, secrets x/y, the CG —
 *                            with the invite code + QR in the corner, so sharing a result also invites.
 *
 * Both: portrait 1080×1350 (default) or landscape 1200×630; film grain + vignette baked in; fall back to
 * painted art when there is no picture. Pure apart from the canvas: tests pass `createCanvas` with a fake.
 * Copy is per locale (zh-CN / ja / ko / en) inside this module — the card is an image, not UI.
 */
import { encodeQr } from './qr.js';

export type CardFormat = 'portrait' | 'landscape';
export type CardLocale = 'zh-CN' | 'ja' | 'ko' | 'en';
export const CARD_SIZES: Record<CardFormat, { width: number; height: number }> = {
  portrait: { width: 1080, height: 1350 },
  landscape: { width: 1200, height: 630 },
};

/** Anything drawImage takes, with its pixel size. */
export interface CardArt { image: CanvasImageSource; width: number; height: number }

export interface CardFonts {
  /** The world's display face (titles), e.g. getComputedStyle(root).getPropertyValue('--ux-font-human'). */
  display?: string;
  ui?: string;
  mono?: string;
}

interface CardBase {
  locale: CardLocale | string;
  format?: CardFormat;
  /** The invite code (WL-XXXXXX) and its link (https://canvas.worldlines.gg/?invite=CODE). */
  code: string;
  url: string;
  /** Credits the invitee gets (billing GET /v1/me/invite invitee_credits; 500 by default). */
  credits?: number;
  art?: CardArt | null;
  worldTitle?: string | null;
  endingTitle?: string | null;
  /** One line from the ending (or the CG caption); trimmed to fit. */
  quote?: string | null;
  fonts?: CardFonts;
}
export type InviteCardInput = CardBase;
export interface ResultCardInput extends CardBase {
  /** Minutes played (summary startedAt → endedAt); null hides it. */
  playtimeMinutes?: number | null;
  turns?: number | null;
  secrets?: { found: number; total: number } | null;
}

/** The 2D context surface the renderer uses (a real CanvasRenderingContext2D, or a test fake). */
export type Ctx = CanvasRenderingContext2D;
export interface CanvasLike {
  width: number;
  height: number;
  getContext(kind: '2d'): Ctx | null;
}
export interface RenderOptions {
  createCanvas?: (width: number, height: number) => CanvasLike;
  /** Wait for the fonts before drawing (document.fonts.load). Default true in a browser. */
  loadFonts?: boolean;
}

// ── copy ────────────────────────────────────────────────────────────────────

const COPY = {
  'zh-CN': {
    invite: (n: string) => `用我的邀请码，送你 ${n} 积分`,
    codeLabel: '邀请码',
    scan: '扫码进入世界',
    brandLine: '会自己画出来的 AI 跑团世界',
    reached: '结局达成',
    playtime: '游玩时长',
    turns: '回合',
    secrets: '秘密',
    cornerScan: (n: string) => `扫码领 ${n} 积分`,
    minutes: (h: number, m: number) => (h ? `${h} 小时 ${m} 分` : `${m} 分钟`),
    quoteOpen: '「', quoteClose: '」',
  },
  ja: {
    invite: (n: string) => `招待コードで ${n} クレジットをプレゼント`,
    codeLabel: '招待コード',
    scan: 'スキャンして世界へ',
    brandLine: '世界が自ら描かれる AI TRPG',
    reached: 'エンディング到達',
    playtime: 'プレイ時間',
    turns: 'ターン',
    secrets: '秘密',
    cornerScan: (n: string) => `スキャンで ${n} クレジット`,
    minutes: (h: number, m: number) => (h ? `${h}時間${m}分` : `${m}分`),
    quoteOpen: '「', quoteClose: '」',
  },
  ko: {
    invite: (n: string) => `내 초대 코드로 ${n} 크레딧을 드려요`,
    codeLabel: '초대 코드',
    scan: '스캔해서 세계로',
    brandLine: '세계가 스스로 그려지는 AI TRPG',
    reached: '엔딩 달성',
    playtime: '플레이 시간',
    turns: '턴',
    secrets: '비밀',
    cornerScan: (n: string) => `스캔하고 ${n} 크레딧 받기`,
    minutes: (h: number, m: number) => (h ? `${h}시간 ${m}분` : `${m}분`),
    quoteOpen: '“', quoteClose: '”',
  },
  en: {
    invite: (n: string) => `Use my invite code — get ${n} credits`,
    codeLabel: 'INVITE CODE',
    scan: 'Scan to step in',
    brandLine: 'An AI tabletop that paints itself',
    reached: 'ENDING REACHED',
    playtime: 'PLAYTIME',
    turns: 'TURNS',
    secrets: 'SECRETS',
    cornerScan: (n: string) => `Scan for ${n} credits`,
    minutes: (h: number, m: number) => (h ? `${h}h ${m}m` : `${m} min`),
    quoteOpen: '“', quoteClose: '”',
  },
} as const;
export type CardCopy = (typeof COPY)[CardLocale];

export function cardLocale(locale: string): CardLocale {
  if (locale === 'zh-CN' || locale === 'zh' || locale.startsWith('zh')) return 'zh-CN';
  if (locale === 'ja' || locale === 'ko') return locale;
  return 'en';
}
export function cardCopy(locale: string): CardCopy {
  return COPY[cardLocale(locale)];
}
/** The line the share sheet / caption uses (same as on the card). */
export function inviteLine(locale: string, credits = 500): string {
  return cardCopy(locale).invite(credits.toLocaleString('en-US'));
}
export function playtimeLabel(locale: string, minutes: number): string {
  const m = Math.max(0, Math.round(minutes));
  return cardCopy(locale).minutes(Math.floor(m / 60), m % 60);
}

// ── fonts ───────────────────────────────────────────────────────────────────

const DISPLAY = "'LXGW WenKai', 'Gowun Batang', 'Songti SC', 'Noto Serif CJK SC', serif";
const UI = "'Manrope', 'Noto Sans KR', 'PingFang SC', 'Hiragino Sans', system-ui, sans-serif";
const MONO = "'DM Mono', 'SFMono-Regular', ui-monospace, Menlo, monospace";
const fontsOf = (f: CardFonts | undefined) => ({ display: f?.display?.trim() || DISPLAY, ui: f?.ui?.trim() || UI, mono: f?.mono?.trim() || MONO });

async function loadFonts(specs: string[], sample: string): Promise<void> {
  const fonts = typeof document !== 'undefined' ? (document as Document & { fonts?: FontFaceSet }).fonts : undefined;
  if (!fonts?.load) return;
  const timeout = new Promise<void>((resolve) => setTimeout(resolve, 2500));
  await Promise.race([Promise.all(specs.map((s) => fonts.load(s, sample).catch(() => []))).then(() => undefined), timeout]);
}

// ── drawing helpers ─────────────────────────────────────────────────────────

function makeCanvas(opts: RenderOptions | undefined, width: number, height: number): CanvasLike {
  if (opts?.createCanvas) return opts.createCanvas(width, height);
  if (typeof document !== 'undefined') {
    const c = document.createElement('canvas');
    c.width = width;
    c.height = height;
    return c as unknown as CanvasLike;
  }
  if (typeof OffscreenCanvas !== 'undefined') return new OffscreenCanvas(width, height) as unknown as CanvasLike;
  throw new Error('share-card: no canvas available');
}

function roundRect(ctx: Ctx, x: number, y: number, w: number, h: number, r: number): void {
  const rr = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + rr, y);
  ctx.arcTo(x + w, y, x + w, y + h, rr);
  ctx.arcTo(x + w, y + h, x, y + h, rr);
  ctx.arcTo(x, y + h, x, y, rr);
  ctx.arcTo(x, y, x + w, y, rr);
  ctx.closePath();
}

/** Cover-fit a picture into the box (centred; `focusY` 0 = top … 1 = bottom). */
export function coverRect(iw: number, ih: number, bw: number, bh: number, focusY = 0.4): { sx: number; sy: number; sw: number; sh: number } {
  const scale = Math.max(bw / iw, bh / ih);
  const sw = bw / scale;
  const sh = bh / scale;
  return { sx: (iw - sw) / 2, sy: Math.max(0, Math.min(ih - sh, (ih - sh) * focusY)), sw, sh };
}

const CJK = /[　-鿿가-힯＀-￯]/;
/** Lines that fit `maxWidth` (CJK breaks anywhere, Latin at spaces), at most `maxLines`, the last with … */
export function wrapLines(ctx: Pick<Ctx, 'measureText'>, text: string, maxWidth: number, maxLines: number): string[] {
  const tokens: string[] = [];
  for (const part of text.replace(/\s+/g, ' ').trim().split(/(\s+)/)) {
    if (!part) continue;
    if (CJK.test(part)) tokens.push(...Array.from(part));
    else tokens.push(part);
  }
  const lines: string[] = [];
  let cur = '';
  for (const tok of tokens) {
    const next = cur + tok;
    if (cur && ctx.measureText(next.trimEnd()).width > maxWidth) {
      lines.push(cur.trim());
      cur = tok.trimStart();
      if (lines.length === maxLines) break;
    } else cur = next;
  }
  if (lines.length < maxLines && cur.trim()) lines.push(cur.trim());
  const used = lines.join('').replace(/\s/g, '').length;
  if (used < text.replace(/\s/g, '').length && lines.length) {
    let last = lines[lines.length - 1];
    while (last && ctx.measureText(`${last}…`).width > maxWidth) last = last.slice(0, -1);
    lines[lines.length - 1] = `${last.trimEnd()}…`;
  }
  return lines;
}

/** Draw text with letter spacing (canvas letterSpacing where supported, else char by char). */
function spaced(ctx: Ctx, text: string, x: number, y: number, spacing: number, align: 'left' | 'right' = 'left'): number {
  const chars = Array.from(text);
  const width = chars.reduce((w, ch) => w + ctx.measureText(ch).width, 0) + spacing * (chars.length - 1);
  let cx = align === 'right' ? x - width : x;
  const prev = ctx.textAlign;
  ctx.textAlign = 'left';
  for (const ch of chars) {
    ctx.fillText(ch, cx, y);
    cx += ctx.measureText(ch).width + spacing;
  }
  ctx.textAlign = prev;
  return width;
}

/** A small deterministic noise tile (film grain), drawn as a pattern. */
function grain(ctx: Ctx, opts: RenderOptions | undefined, w: number, h: number, alpha: number): void {
  try {
    const tile = makeCanvas(opts, 192, 192);
    const tctx = tile.getContext('2d');
    if (!tctx?.createImageData) return;
    const img = tctx.createImageData(192, 192);
    let seed = 0x2f6b1d;
    for (let i = 0; i < img.data.length; i += 4) {
      seed = (seed * 1664525 + 1013904223) >>> 0;
      const v = seed >>> 24;
      img.data[i] = v;
      img.data[i + 1] = v;
      img.data[i + 2] = v;
      img.data[i + 3] = 255;
    }
    tctx.putImageData(img, 0, 0);
    const pattern = ctx.createPattern(tile as unknown as CanvasImageSource, 'repeat');
    if (!pattern) return;
    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.globalCompositeOperation = 'overlay';
    ctx.fillStyle = pattern;
    ctx.fillRect(0, 0, w, h);
    ctx.restore();
  } catch {
    /* no grain: the card still works */
  }
}

function vignette(ctx: Ctx, w: number, h: number, strength: number): void {
  const g = ctx.createRadialGradient(w / 2, h * 0.45, Math.min(w, h) * 0.35, w / 2, h * 0.5, Math.max(w, h) * 0.8);
  g.addColorStop(0, 'rgba(0,0,0,0)');
  g.addColorStop(1, `rgba(0,0,0,${strength})`);
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, w, h);
}

/** No picture: a painted dusk (deep indigo → teal, warm light) so the card never looks empty. */
function paintedArt(ctx: Ctx, w: number, h: number): void {
  const base = ctx.createLinearGradient(0, 0, w * 0.3, h);
  base.addColorStop(0, '#141a3a');
  base.addColorStop(0.55, '#1d3b4f');
  base.addColorStop(1, '#0b1220');
  ctx.fillStyle = base;
  ctx.fillRect(0, 0, w, h);
  const blobs: [number, number, number, string][] = [
    [0.72, 0.22, 0.55, 'rgba(255,186,120,0.38)'],
    [0.18, 0.4, 0.45, 'rgba(120,170,255,0.22)'],
    [0.6, 0.7, 0.5, 'rgba(90,220,200,0.16)'],
  ];
  for (const [bx, by, br, color] of blobs) {
    const g = ctx.createRadialGradient(w * bx, h * by, 0, w * bx, h * by, Math.max(w, h) * br);
    g.addColorStop(0, color);
    g.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, w, h);
  }
  // a few brush strokes of light
  ctx.save();
  ctx.globalAlpha = 0.12;
  ctx.strokeStyle = '#f6e7c8';
  ctx.lineWidth = Math.max(w, h) * 0.004;
  for (let i = 0; i < 7; i++) {
    const y = h * (0.18 + i * 0.09);
    ctx.beginPath();
    ctx.moveTo(w * 0.08, y);
    ctx.quadraticCurveTo(w * 0.5, y - h * 0.06, w * 0.92, y + h * 0.02);
    ctx.stroke();
  }
  ctx.restore();
}

function drawArt(ctx: Ctx, art: CardArt | null | undefined, x: number, y: number, w: number, h: number, focusY = 0.4): void {
  if (!art) return paintedArt(ctx, w, h);
  const r = coverRect(art.width, art.height, w, h, focusY);
  ctx.drawImage(art.image, r.sx, r.sy, r.sw, r.sh, x, y, w, h);
}

/** The glass band: the art behind it blurred and dimmed, a light fill, a hairline border, a top highlight. */
function glass(ctx: Ctx, art: CardArt | null | undefined, cw: number, ch: number, x: number, y: number, w: number, h: number, r: number): void {
  ctx.save();
  roundRect(ctx, x, y, w, h, r);
  ctx.clip();
  const canFilter = typeof (ctx as { filter?: unknown }).filter === 'string';
  if (canFilter) {
    ctx.filter = 'blur(28px) brightness(0.55) saturate(1.2)';
    drawArt(ctx, art, 0, 0, cw, ch);
    ctx.filter = 'none';
  } else {
    ctx.fillStyle = 'rgba(8,10,20,0.55)';
    ctx.fillRect(x, y, w, h);
  }
  const fill = ctx.createLinearGradient(x, y, x, y + h);
  fill.addColorStop(0, 'rgba(255,255,255,0.16)');
  fill.addColorStop(1, 'rgba(255,255,255,0.05)');
  ctx.fillStyle = fill;
  ctx.fillRect(x, y, w, h);
  ctx.restore();
  ctx.save();
  roundRect(ctx, x + 0.75, y + 0.75, w - 1.5, h - 1.5, r);
  ctx.strokeStyle = 'rgba(255,255,255,0.30)';
  ctx.lineWidth = 1.5;
  ctx.stroke();
  ctx.restore();
}

/** The QR on a white rounded tile (4-module quiet zone). → the tile size */
export function drawQr(ctx: Ctx, text: string, x: number, y: number, size: number): number {
  const qr = encodeQr(text);
  const modules = qr.size + 8;
  const cell = Math.floor(size / modules) || 1;
  const tile = cell * modules;
  ctx.save();
  roundRect(ctx, x, y, tile, tile, cell * 2);
  ctx.fillStyle = '#ffffff';
  ctx.fill();
  ctx.fillStyle = '#0d1020';
  for (let r = 0; r < qr.size; r++) {
    for (let c = 0; c < qr.size; c++) if (qr.modules[r][c]) ctx.fillRect(x + (c + 4) * cell, y + (r + 4) * cell, cell, cell);
  }
  ctx.restore();
  return tile;
}

function wordmark(ctx: Ctx, fonts: ReturnType<typeof fontsOf>, x: number, y: number, size: number, align: 'left' | 'right' = 'left'): void {
  ctx.save();
  ctx.fillStyle = 'rgba(255,255,255,0.94)';
  ctx.font = `600 ${size}px ${fonts.ui}`;
  ctx.textBaseline = 'alphabetic';
  const w = spaced(ctx, 'LIVINGCANVAS', x, y, size * 0.32, align);
  // the small brush dot after the wordmark
  ctx.fillStyle = '#f2c27b';
  ctx.beginPath();
  const dotX = align === 'left' ? x + w + size * 0.55 : x + size * 0.55;
  ctx.arc(dotX, y - size * 0.32, size * 0.18, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

function shadowText(ctx: Ctx, on: boolean): void {
  ctx.shadowColor = on ? 'rgba(0,0,0,0.55)' : 'transparent';
  ctx.shadowBlur = on ? 24 : 0;
  ctx.shadowOffsetY = on ? 2 : 0;
}

/** The code, readable from across a room: monospace, wide tracking, no ambiguous letters (WL-XXXXXX). */
function codeText(ctx: Ctx, fonts: ReturnType<typeof fontsOf>, code: string, x: number, y: number, size: number): number {
  ctx.save();
  ctx.font = `600 ${size}px ${fonts.mono}`;
  ctx.fillStyle = '#ffffff';
  shadowText(ctx, true);
  const w = spaced(ctx, code, x, y, size * 0.12);
  ctx.restore();
  return w;
}

function fit(ctx: Ctx, font: (px: number) => string, text: string, maxWidth: number, start: number, min: number): number {
  let px = start;
  for (; px > min; px -= 2) {
    ctx.font = font(px);
    if (ctx.measureText(text).width <= maxWidth) break;
  }
  ctx.font = font(px);
  return px;
}

const displayUrl = (url: string) => url.replace(/^https?:\/\//, '');

// ── the cards ───────────────────────────────────────────────────────────────

async function prepare(input: CardBase, opts: RenderOptions | undefined) {
  const format = input.format ?? 'portrait';
  const { width, height } = CARD_SIZES[format];
  const fonts = fontsOf(input.fonts);
  if (opts?.loadFonts !== false) {
    const sample = [input.worldTitle, input.endingTitle, input.quote, input.code, cardCopy(input.locale).invite('500')].filter(Boolean).join('');
    await loadFonts([`600 40px ${fonts.display}`, `400 40px ${fonts.display}`, `600 40px ${fonts.ui}`, `600 40px ${fonts.mono}`], sample || 'LivingCanvas');
  }
  const canvas = makeCanvas(opts, width, height);
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('share-card: no 2d context');
  return { format, width, height, fonts, canvas, ctx, copy: cardCopy(input.locale), credits: (input.credits ?? 500).toLocaleString('en-US') };
}

function backdrop(ctx: Ctx, art: CardArt | null | undefined, w: number, h: number, landscape: boolean): void {
  ctx.fillStyle = '#05060c';
  ctx.fillRect(0, 0, w, h);
  drawArt(ctx, art, 0, 0, w, h, landscape ? 0.35 : 0.3);
  // top scrim (wordmark) and the bottom fall to black (title + band)
  const top = ctx.createLinearGradient(0, 0, 0, h * 0.22);
  top.addColorStop(0, 'rgba(0,0,0,0.55)');
  top.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = top;
  ctx.fillRect(0, 0, w, h * 0.22);
  if (landscape) {
    const side = ctx.createLinearGradient(0, 0, w * 0.75, 0);
    side.addColorStop(0, 'rgba(4,5,12,0.88)');
    side.addColorStop(0.55, 'rgba(4,5,12,0.45)');
    side.addColorStop(1, 'rgba(4,5,12,0)');
    ctx.fillStyle = side;
    ctx.fillRect(0, 0, w, h);
  }
  const bottom = ctx.createLinearGradient(0, h * (landscape ? 0.45 : 0.42), 0, h);
  bottom.addColorStop(0, 'rgba(4,5,12,0)');
  bottom.addColorStop(0.55, 'rgba(4,5,12,0.72)');
  bottom.addColorStop(1, 'rgba(4,5,12,0.95)');
  ctx.fillStyle = bottom;
  ctx.fillRect(0, 0, w, h);
  vignette(ctx, w, h, 0.5);
}

/** Title block: kicker (ending), world title (display face), the quote. → the y under it */
function titleBlock(ctx: Ctx, input: CardBase, fonts: ReturnType<typeof fontsOf>, copy: CardCopy, x: number, yBottom: number, maxWidth: number, scale: number, kicker: string | null): void {
  const quote = input.quote?.trim() ? `${copy.quoteOpen}${input.quote.trim().replace(/^[「“"]|[」”"]$/g, '')}${copy.quoteClose}` : null;
  ctx.save();
  ctx.textAlign = 'left';
  ctx.textBaseline = 'alphabetic';
  shadowText(ctx, true);
  let y = yBottom;
  // the quote sits at the bottom of the block, the title above it, the kicker above that
  let quoteLines: string[] = [];
  if (quote) {
    ctx.font = `400 ${Math.round(30 * scale)}px ${fonts.display}`;
    quoteLines = wrapLines(ctx, quote, maxWidth, 2);
  }
  const quoteLead = Math.round(44 * scale);
  const titleText = input.worldTitle?.trim() || 'LivingCanvas';
  const titlePx = fit(ctx, (px) => `600 ${px}px ${fonts.display}`, titleText, maxWidth, Math.round(96 * scale), Math.round(48 * scale));
  ctx.font = `600 ${titlePx}px ${fonts.display}`;
  const titleLines = wrapLines(ctx, titleText, maxWidth, 2);
  const titleLead = Math.round(titlePx * 1.12);
  // draw from the bottom up
  ctx.fillStyle = 'rgba(255,244,226,0.86)';
  ctx.font = `400 ${Math.round(30 * scale)}px ${fonts.display}`;
  for (let i = quoteLines.length - 1; i >= 0; i--) {
    ctx.fillText(quoteLines[i], x, y);
    y -= quoteLead;
  }
  if (quoteLines.length) y -= Math.round(14 * scale);
  ctx.fillStyle = '#ffffff';
  ctx.font = `600 ${titlePx}px ${fonts.display}`;
  for (let i = titleLines.length - 1; i >= 0; i--) {
    ctx.fillText(titleLines[i], x, y);
    y -= titleLead;
  }
  const kick = [kicker, input.endingTitle?.trim()].filter(Boolean).join(' · ');
  if (kick) {
    y += Math.round(titleLead * 0.18);
    ctx.font = `600 ${Math.round(24 * scale)}px ${fonts.ui}`;
    ctx.fillStyle = '#f2c27b';
    const k = wrapLines(ctx, kick, maxWidth, 1)[0] ?? '';
    spaced(ctx, k, x, y, Math.round(3 * scale));
  }
  ctx.restore();
}

export async function renderInviteCard(input: InviteCardInput, opts?: RenderOptions): Promise<CanvasLike> {
  const { format, width: w, height: h, fonts, canvas, ctx, copy, credits } = await prepare(input, opts);
  const landscape = format === 'landscape';
  backdrop(ctx, input.art, w, h, landscape);
  if (!landscape) {
    const pad = 72;
    wordmark(ctx, fonts, pad, 104, 30);
    ctx.save();
    ctx.font = `500 22px ${fonts.ui}`;
    ctx.fillStyle = 'rgba(255,255,255,0.72)';
    ctx.textAlign = 'left';
    ctx.fillText(copy.brandLine, pad, 146);
    ctx.restore();
    // glass band
    const bandH = 330;
    const bandY = h - pad - bandH;
    glass(ctx, input.art, w, h, pad - 8, bandY, w - (pad - 8) * 2, bandH, 34);
    titleBlock(ctx, input, fonts, copy, pad, bandY - 52, w - pad * 2, 1, null);
    const qrSize = 256;
    const qrTile = drawQr(ctx, input.url, w - pad - 8 - 36 - qrSize, bandY + (bandH - qrSize) / 2, qrSize);
    const textX = pad + 32;
    const textW = w - pad * 2 - qrTile - 130;
    ctx.save();
    ctx.textAlign = 'left';
    ctx.fillStyle = 'rgba(255,255,255,0.92)';
    const linePx = fit(ctx, (px) => `600 ${px}px ${fonts.ui}`, copy.invite(credits), textW, 34, 22);
    ctx.font = `600 ${linePx}px ${fonts.ui}`;
    ctx.fillText(copy.invite(credits), textX, bandY + 78);
    ctx.font = `600 20px ${fonts.ui}`;
    ctx.fillStyle = '#f2c27b';
    spaced(ctx, copy.codeLabel, textX, bandY + 138, 4);
    ctx.restore();
    const codePx = fit(ctx, (px) => `600 ${px}px ${fonts.mono}`, input.code, (textW - 20) / 1.18, 92, 40); // ÷: the letter spacing
    codeText(ctx, fonts, input.code, textX, bandY + 138 + codePx + 6, codePx);
    ctx.save();
    ctx.font = `500 24px ${fonts.ui}`;
    ctx.fillStyle = 'rgba(255,255,255,0.78)';
    ctx.textAlign = 'left';
    ctx.fillText(wrapLines(ctx, displayUrl(input.url), textW + 40, 1)[0] ?? '', textX, bandY + bandH - 44);
    ctx.restore();
  } else {
    const pad = 56;
    wordmark(ctx, fonts, pad, 82, 24);
    ctx.save();
    ctx.font = `500 18px ${fonts.ui}`;
    ctx.fillStyle = 'rgba(255,255,255,0.7)';
    ctx.fillText(copy.brandLine, pad, 116);
    ctx.restore();
    const bandH = 196;
    const bandY = h - pad - bandH;
    const bandW = w - pad * 2 + 16;
    glass(ctx, input.art, w, h, pad - 8, bandY, bandW, bandH, 28);
    titleBlock(ctx, input, fonts, copy, pad, bandY - 36, w * 0.62, 0.66, null);
    const qrSize = 164;
    const qrTile = drawQr(ctx, input.url, pad - 8 + bandW - 16 - qrSize, bandY + (bandH - qrSize) / 2, qrSize);
    const textX = pad + 22;
    const textW = bandW - qrTile - 80;
    ctx.save();
    ctx.fillStyle = 'rgba(255,255,255,0.92)';
    const linePx = fit(ctx, (px) => `600 ${px}px ${fonts.ui}`, copy.invite(credits), textW, 28, 18);
    ctx.font = `600 ${linePx}px ${fonts.ui}`;
    ctx.fillText(copy.invite(credits), textX, bandY + 50);
    ctx.font = `600 16px ${fonts.ui}`;
    ctx.fillStyle = '#f2c27b';
    spaced(ctx, copy.codeLabel, textX, bandY + 88, 3);
    ctx.restore();
    const codePx = fit(ctx, (px) => `600 ${px}px ${fonts.mono}`, input.code, (textW - 20) / 1.18, 52, 30);
    codeText(ctx, fonts, input.code, textX, bandY + 88 + Math.round(codePx * 0.86) + 6, codePx);
    ctx.save();
    ctx.font = `500 18px ${fonts.ui}`;
    ctx.fillStyle = 'rgba(255,255,255,0.78)';
    ctx.fillText(wrapLines(ctx, displayUrl(input.url), textW, 1)[0] ?? '', textX, bandY + bandH - 22);
    ctx.restore();
  }
  grain(ctx, opts, w, h, 0.07);
  return canvas;
}

export async function renderResultCard(input: ResultCardInput, opts?: RenderOptions): Promise<CanvasLike> {
  const { format, width: w, height: h, fonts, canvas, ctx, copy, credits } = await prepare(input, opts);
  const landscape = format === 'landscape';
  backdrop(ctx, input.art, w, h, landscape);
  const stats: { label: string; value: string }[] = [];
  if (input.playtimeMinutes != null && Number.isFinite(input.playtimeMinutes)) stats.push({ label: copy.playtime, value: playtimeLabel(input.locale, input.playtimeMinutes) });
  if (input.turns != null && Number.isFinite(input.turns)) stats.push({ label: copy.turns, value: String(input.turns) });
  if (input.secrets && input.secrets.total > 0) stats.push({ label: copy.secrets, value: `${input.secrets.found} / ${input.secrets.total}` });
  const pad = landscape ? 56 : 72;
  const s = landscape ? 0.66 : 1;
  wordmark(ctx, fonts, pad, landscape ? 82 : 104, landscape ? 24 : 30);
  // the corner invite: a small glass tile with the QR and the code (top right)
  const tileW = landscape ? 236 : 300;
  const qrSize = landscape ? 140 : 188;
  const tileH = qrSize + (landscape ? 86 : 110);
  const tileX = w - pad - tileW + 8;
  const tileY = landscape ? pad - 16 : pad - 8;
  glass(ctx, input.art, w, h, tileX, tileY, tileW, tileH, 24);
  const qrTile = drawQr(ctx, input.url, tileX + (tileW - qrSize) / 2, tileY + 18, qrSize);
  ctx.save();
  ctx.textAlign = 'center';
  ctx.fillStyle = 'rgba(255,255,255,0.9)';
  const scanPx = fit(ctx, (px) => `600 ${px}px ${fonts.ui}`, copy.cornerScan(credits), tileW - 24, landscape ? 16 : 20, 12);
  ctx.font = `600 ${scanPx}px ${fonts.ui}`;
  ctx.fillText(copy.cornerScan(credits), tileX + tileW / 2, tileY + 18 + qrTile + (landscape ? 26 : 34));
  ctx.font = `600 ${landscape ? 22 : 28}px ${fonts.mono}`;
  ctx.fillStyle = '#ffffff';
  ctx.fillText(input.code, tileX + tileW / 2, tileY + 18 + qrTile + (landscape ? 54 : 72));
  ctx.restore();
  // stats band at the bottom, the title block above it
  const bandH = stats.length ? (landscape ? 120 : 170) : 0;
  const bandY = h - pad - bandH;
  if (stats.length) {
    const bandW = landscape ? w * 0.6 : w - pad * 2 + 16;
    glass(ctx, input.art, w, h, pad - 8, bandY, bandW, bandH, landscape ? 22 : 30);
    const colW = (bandW - 32) / stats.length;
    stats.forEach((st, i) => {
      const cx = pad - 8 + 16 + colW * i + (i === 0 ? 24 : 36);
      ctx.save();
      ctx.textAlign = 'left';
      ctx.font = `600 ${Math.round(18 * s + (landscape ? 2 : 2))}px ${fonts.ui}`;
      ctx.fillStyle = '#f2c27b';
      spaced(ctx, st.label, cx, bandY + Math.round(56 * s), 3);
      const vPx = fit(ctx, (px) => `600 ${px}px ${fonts.display}`, st.value, colW - 64, Math.round(56 * s), 22);
      ctx.font = `600 ${vPx}px ${fonts.display}`;
      ctx.fillStyle = '#ffffff';
      shadowText(ctx, true);
      ctx.fillText(st.value, cx, bandY + bandH - Math.round(40 * s));
      ctx.restore();
      if (i > 0) {
        ctx.fillStyle = 'rgba(255,255,255,0.18)';
        ctx.fillRect(pad - 8 + 16 + colW * i, bandY + 26 * s, 1.5, bandH - 52 * s);
      }
    });
  }
  titleBlock(ctx, input, fonts, copy, pad, (stats.length ? bandY : h - pad) - Math.round(52 * s), landscape ? w * 0.6 : w - pad * 2, s, copy.reached);
  grain(ctx, opts, w, h, 0.07);
  return canvas;
}

// ── output ──────────────────────────────────────────────────────────────────

export async function cardToBlob(canvas: CanvasLike, type = 'image/png'): Promise<Blob> {
  const c = canvas as unknown as { toBlob?: (cb: (b: Blob | null) => void, type?: string) => void; convertToBlob?: (o: { type: string }) => Promise<Blob> };
  if (c.convertToBlob) return c.convertToBlob({ type });
  if (!c.toBlob) throw new Error('share-card: canvas cannot export');
  return new Promise((resolve, reject) => c.toBlob!((b) => (b ? resolve(b) : reject(new Error('share-card: export failed'))), type));
}

/**
 * Load a picture for the card. Same-origin URLs (`/api/…`, the runtime's VFS) and blobs only: a picture
 * from another origin would taint the canvas, so anything else → null (the caller falls back).
 */
export async function loadCardArt(src: string | Blob): Promise<CardArt | null> {
  try {
    if (typeof src !== 'string') {
      const bmp = await createImageBitmap(src);
      return { image: bmp, width: bmp.width, height: bmp.height };
    }
    const url = new URL(src, typeof location !== 'undefined' ? location.href : 'http://localhost/');
    if (typeof location !== 'undefined' && url.origin !== location.origin && url.protocol !== 'blob:' && url.protocol !== 'data:') return null;
    const img = new Image();
    img.decoding = 'async';
    img.src = url.href;
    await img.decode();
    if (!img.naturalWidth) return null;
    return { image: img, width: img.naturalWidth, height: img.naturalHeight };
  } catch {
    return null;
  }
}

/** The world's display / UI faces from the page's CSS (the ending card uses --ux-font-human). */
export function pageCardFonts(): CardFonts {
  if (typeof document === 'undefined' || typeof getComputedStyle === 'undefined') return {};
  const css = getComputedStyle(document.documentElement);
  const v = (k: string) => css.getPropertyValue(k).trim() || undefined;
  return { display: v('--ux-font-human'), ui: v('--ux-font-ui') };
}
