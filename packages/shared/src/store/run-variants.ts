/**
 * Run variants: a world that plays differently each
 * new run — 「最后的证人」 picks its culprit this way.
 *
 * `world.json` declares the choices:
 *
 *   "variants": [{ "id": "culprit", "options": ["eve", "ross", "koharu"], "state": "culprit" }]
 *
 * and the template carries one overlay directory per option,
 * `variants/<id>/<option>/…`, mirroring the world root. When a NEW RUN starts
 * (a template / published world / draft is copied into a fresh save —
 * `POST /api/worlds/load`, the boot copy), `prepareRun` on that copy:
 *
 *   1. draws a seed (`randomUUID`, or a caller-given one) and picks each
 *      variant's option deterministically from it (`pickVariant`, FNV-1a — the
 *      same seed always picks the same options, in Node and in the browser);
 *   2. copies the picked option's overlay over the save root (replacing files);
 *   3. deletes the whole `variants/` directory from the save, so neither the
 *      writer nor a character agent can read the options that were not picked;
 *   4. sets the variant's `state` (a declared enum state in `world/README.md`)
 *      to the picked option, so triggers and endings can compare against it;
 *   5. records `run: { seed, variants: { <id>: <option> } }` in
 *      `world/README.md` — a reserved key (only the engine writes it).
 *
 * A save that already has `run` is never re-rolled: preparing is idempotent.
 * A world without `variants` is left untouched (no `run` either).
 *
 * The template itself is played-as-authored: its base files ARE the first
 * option (check:worlds holds them byte-identical to `variants/<id>/<first>/`),
 * so a template opened in place, and every gate that reads the template, sees a
 * complete, consistent world.
 */
import fs from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { parseFrontmatter, stringifyFrontmatter } from '../schemas/frontmatter.js';
import { parseStateDecls, STATE_ID_RE } from '../rules/states.js';

/** `world/README.md` key holding the run record. Reserved: commands and agents cannot write it. */
export const RUN_KEY = 'run';
/** Template directory with one overlay per option: `variants/<variant id>/<option>/`. */
export const VARIANTS_DIR = 'variants';
const RUN_FILE = 'world/README.md';
const VARIANT_ID_RE = /^[a-z][a-z0-9-]{0,39}$/;

const unique = (list: readonly string[]) => new Set(list).size === list.length;

export const RunVariantSchema = z
  .object({
    id: z.string().regex(VARIANT_ID_RE, 'a variant id is lowercase ASCII kebab-case'),
    options: z
      .array(z.string().regex(VARIANT_ID_RE, 'an option id is lowercase ASCII kebab-case'))
      .min(2)
      .max(12)
      .refine(unique, 'options must be distinct'),
    /** A declared enum state in `world/README.md` that receives the picked option. */
    state: z.string().regex(STATE_ID_RE).optional(),
  })
  .strict();
export type RunVariant = z.infer<typeof RunVariantSchema>;

export const RunVariantsSchema = z
  .array(RunVariantSchema)
  .max(8)
  .refine((list) => unique(list.map((v) => v.id)), 'variant ids must be distinct');

export interface RunRecord {
  seed: string;
  variants: Record<string, string>;
}

/** The variants a manifest declares; `errors` for a malformed block (the run then has none). */
export function runVariantsOf(manifest: unknown): { variants: RunVariant[]; errors: string[] } {
  const raw = manifest && typeof manifest === 'object' ? (manifest as { variants?: unknown }).variants : undefined;
  if (raw === undefined) return { variants: [], errors: [] };
  const parsed = RunVariantsSchema.safeParse(raw);
  if (!parsed.success) return { variants: [], errors: parsed.error.issues.map((i) => `variants.${i.path.join('.')}: ${i.message}`) };
  return { variants: parsed.data, errors: [] };
}

/** 32-bit FNV-1a: tiny, dependency-free and identical on every platform. */
function fnv1a(text: string): number {
  let h = 0x811c9dc5;
  for (const ch of new TextEncoder().encode(text)) {
    h ^= ch;
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h >>> 0;
}

/** The option a seed picks for one variant. Pure and deterministic. */
export function pickVariant(seed: string, variant: Pick<RunVariant, 'id' | 'options'>): string {
  return variant.options[fnv1a(`${seed}:${variant.id}`) % variant.options.length];
}

/** Every option a seed picks, by variant id. */
export function pickVariants(seed: string, variants: readonly RunVariant[]): Record<string, string> {
  return Object.fromEntries(variants.map((v) => [v.id, pickVariant(seed, v)]));
}

/** The run record in a `world/README.md` frontmatter, or null. */
export function runRecordOf(frontmatter: unknown): RunRecord | null {
  const raw = frontmatter && typeof frontmatter === 'object' ? (frontmatter as Record<string, unknown>)[RUN_KEY] : undefined;
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const { seed, variants } = raw as { seed?: unknown; variants?: unknown };
  if (typeof seed !== 'string' || !variants || typeof variants !== 'object' || Array.isArray(variants)) return null;
  const picks = Object.fromEntries(Object.entries(variants).filter(([, v]) => typeof v === 'string')) as Record<string, string>;
  return { seed, variants: picks };
}

/** Relative paths of every file under `dir` ('/'-separated); [] when it does not exist. */
export async function overlayFiles(dir: string): Promise<string[]> {
  const out: string[] = [];
  const walk = async (rel: string) => {
    const entries = await fs.readdir(path.join(dir, rel), { withFileTypes: true }).catch(() => []);
    for (const e of entries) {
      const child = rel ? `${rel}/${e.name}` : e.name;
      if (e.isDirectory()) await walk(child);
      else if (e.isFile()) out.push(child);
    }
  };
  await walk('');
  return out.sort();
}

export interface PrepareRunOptions {
  /** Fix the seed (tests, a reproducible dev run). Default: a fresh random UUID. */
  seed?: string;
  /** Force an option per variant, overriding the seed's pick (tests, contract checks). */
  force?: Record<string, string>;
}

/**
 * Start a new run on a freshly copied save (see the module comment). Returns
 * the run record — the existing one when the save was prepared before — or
 * null when the world declares no variants.
 */
export async function prepareRun(root: string, options: PrepareRunOptions = {}): Promise<RunRecord | null> {
  const manifest = JSON.parse(await fs.readFile(path.join(root, 'world.json'), 'utf8')) as unknown;
  const { variants, errors } = runVariantsOf(manifest);
  if (errors.length) throw new Error(`world.json: ${errors.join('; ')}`);
  if (!variants.length) return null;
  const runFile = path.join(root, RUN_FILE);
  const before = parseFrontmatter(await fs.readFile(runFile, 'utf8'));
  const existing = runRecordOf(before.frontmatter);
  if (existing) return existing;

  const seed = options.seed && options.seed.trim() ? options.seed.trim() : randomUUID();
  const picks = pickVariants(seed, variants);
  for (const v of variants) {
    const forced = options.force?.[v.id];
    if (forced !== undefined) {
      if (!v.options.includes(forced)) throw new Error(`variant "${v.id}" has no option "${forced}"`);
      picks[v.id] = forced;
    }
  }
  for (const v of variants) {
    const overlay = path.join(root, VARIANTS_DIR, v.id, picks[v.id]);
    for (const rel of await overlayFiles(overlay)) {
      if (rel === 'world.json' || rel.split('/')[0] === VARIANTS_DIR) continue;
      const target = path.join(root, ...rel.split('/'));
      await fs.mkdir(path.dirname(target), { recursive: true });
      await fs.copyFile(path.join(overlay, ...rel.split('/')), target);
    }
  }
  await fs.rm(path.join(root, VARIANTS_DIR), { recursive: true, force: true });

  // Re-read: an overlay may have replaced world/README.md itself.
  const parsed = parseFrontmatter(await fs.readFile(runFile, 'utf8'));
  const fm: Record<string, any> = { ...(parsed.frontmatter ?? {}) };
  const declared = parseStateDecls(fm).states;
  const status = fm.status && typeof fm.status === 'object' && !Array.isArray(fm.status) ? { ...fm.status } : {};
  const data = status.data && typeof status.data === 'object' && !Array.isArray(status.data) ? { ...status.data } : {};
  for (const v of variants) {
    if (!v.state) continue;
    const decl = declared.find((s) => s.id === v.state);
    if (!decl || decl.type !== 'enum' || !decl.values?.includes(picks[v.id])) {
      throw new Error(`variant "${v.id}": world/README.md must declare an enum state "${v.state}" whose values include "${picks[v.id]}"`);
    }
    data[v.state] = picks[v.id];
  }
  if (variants.some((v) => v.state)) fm.status = { ...status, data };
  const record: RunRecord = { seed, variants: picks };
  fm[RUN_KEY] = record;
  await fs.writeFile(runFile, stringifyFrontmatter(fm, parsed.body));
  return record;
}
