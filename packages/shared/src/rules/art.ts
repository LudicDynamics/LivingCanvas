/**
 * Creation-mode art: every picture a world needs,
 * written down BEFORE it is painted, with the prompt that paints it.
 *
 * The prompts live in frontmatter `art:` beside what they illustrate:
 *
 *   world/<…>/README.md      art: { scene: { path, prompt }, map: { path, prompt } }
 *   world/README.md          the same, plus  art.cg: [{ id, path, prompt, when? }]
 *   characters/<id>/README.md, `type: npc` cards
 *                            art: { portrait: { path, prompt } }
 *   endings/<id>/README.md   art: { scene: { path, prompt } }
 *   world.json triggers[]    assets: [{ kind, path, prompt }]   (schemas/triggers.ts)
 *
 * `path` is where the picture WILL be (under `assets/`); the file may not exist
 * yet. A declared path is never wired into `bg:` / `map.plan.picture` /
 * `avatar` until the file exists — the server does that when a picture lands
 * (apps/server/src/routes/workshop-art.ts).
 *
 * Two readers, on purpose:
 *   - `artOf` is LENIENT (runtime): a bad entry is skipped, never thrown, so
 *     one typo in a README cannot hide every other slot from the panel;
 *   - `artErrors` is STRICT (check:worlds, templates that declare `art`).
 *
 * `worldArtManifest` is pure: the server reads the files and the disk, this
 * turns them into the slot list the 素材 panel shows.
 */
import { z } from 'zod';

/** Where a picture may live: the world's own `assets/`, an image type. */
export const ART_PATH_RE = /^assets\/[A-Za-z0-9_./-]+\.(webp|png|jpg|jpeg|gif)$/;
export const ART_PROMPT_MAX = 4000;
const CG_ID_RE = /^[a-z0-9][a-z0-9-]{0,47}$/;

const artPath = z.string().regex(ART_PATH_RE, 'an art path is assets/….(webp|png|jpg|jpeg|gif)').refine((p) => !p.includes('..'), 'no ".." in an art path');
const artPrompt = z.string().max(ART_PROMPT_MAX);

export const ArtImageSchema = z
  .object({
    path: artPath,
    /** The generation prompt; empty while the author has not written it yet. */
    prompt: artPrompt,
    /** Portraits only: the author asked for a background cutout (tools/art/cutout-portrait.py). */
    cutout: z.boolean().optional(),
  })
  .strict();
export type ArtImage = z.infer<typeof ArtImageSchema>;

export const ArtCgSchema = z
  .object({
    id: z.string().regex(CG_ID_RE),
    path: artPath,
    prompt: artPrompt,
    /** Author-facing note on when the CG shows (prose, or a trigger id). */
    when: z.string().max(400).optional(),
  })
  .strict();
export type ArtCg = z.infer<typeof ArtCgSchema>;

export const ArtBlockSchema = z
  .object({
    scene: ArtImageSchema.optional(),
    map: ArtImageSchema.optional(),
    portrait: ArtImageSchema.optional(),
    cg: z.array(ArtCgSchema).max(32).optional(),
  })
  .strict();
export type ArtBlock = z.infer<typeof ArtBlockSchema>;

export const ART_IMAGE_KINDS = ['scene', 'map', 'portrait'] as const;
export type ArtImageKind = (typeof ART_IMAGE_KINDS)[number];

/** Lenient read of one `art` block: invalid entries are dropped, never thrown. */
export function artOf(frontmatter: Record<string, unknown> | null | undefined): ArtBlock {
  const raw = frontmatter?.art;
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return {};
  const source = raw as Record<string, unknown>;
  const out: ArtBlock = {};
  for (const kind of ART_IMAGE_KINDS) {
    const parsed = ArtImageSchema.safeParse(source[kind]);
    if (parsed.success) out[kind] = parsed.data;
  }
  if (Array.isArray(source.cg)) {
    const cg: ArtCg[] = [];
    const seen = new Set<string>();
    for (const entry of source.cg) {
      const parsed = ArtCgSchema.safeParse(entry);
      if (parsed.success && !seen.has(parsed.data.id)) {
        seen.add(parsed.data.id);
        cg.push(parsed.data);
      }
    }
    if (cg.length) out.cg = cg;
  }
  return out;
}

/** Strict check of one `art` block; `[]` when there is none or it is valid. */
export function artErrors(frontmatter: Record<string, unknown> | null | undefined): string[] {
  if (frontmatter?.art === undefined) return [];
  const parsed = ArtBlockSchema.safeParse(frontmatter.art);
  const errors = parsed.success ? [] : parsed.error.issues.map((issue) => `art${issue.path.length ? '.' + issue.path.join('.') : ''}: ${issue.message}`);
  const ids = new Set<string>();
  for (const cg of parsed.success ? parsed.data.cg ?? [] : []) {
    if (ids.has(cg.id)) errors.push(`art.cg: duplicate id ${cg.id}`);
    ids.add(cg.id);
  }
  return errors;
}

// ---------------------------------------------------------------------------
// The slot list

export type ArtOwner = 'layer' | 'character' | 'npc' | 'ending' | 'cg' | 'trigger';
export type ArtSlotKind = 'scene' | 'map' | 'portrait' | 'cg' | 'item';

export interface ArtSlot {
  /** Stable id: what the prompt / generate / upload routes name. */
  id: string;
  owner: ArtOwner;
  /** The file the prompt is written in (a README or card, or `world.json` for a trigger). */
  ownerPath: string;
  kind: ArtSlotKind;
  /** The layer this slot belongs to (`map` for the root), when it belongs to one. */
  layer?: string;
  /** What to call it in the panel: the place / person / ending / CG. */
  label: string;
  path: string;
  prompt: string;
  exists: boolean;
  /** False when the owner has no `art` entry yet: `path` is only a suggestion. */
  declared: boolean;
  /** What is wired now (`bg`, `map.plan.picture`, `avatar`), when it differs from `path`. */
  inUse?: string;
  inUseExists?: boolean;
  /** CGs: the author's note on when it shows. Trigger assets: the trigger id. */
  when?: string;
  /** Portraits: the author asked for a background cutout. */
  cutout?: boolean;
}

export interface ArtDoc {
  /** World-relative file path, e.g. `world/well/README.md`. */
  path: string;
  frontmatter: Record<string, unknown> | null;
}

export interface WorldArtInput {
  manifest: Record<string, unknown>;
  /** READMEs and cards under world/, characters/<id>/README.md, endings/<id>/README.md. */
  docs: readonly ArtDoc[];
  /** World-relative paths that exist on disk. */
  exists(path: string): boolean;
}

const str = (value: unknown): string | undefined => (typeof value === 'string' && value.trim() ? value.trim() : undefined);

/** `world/a/b` → `a-b`; the root layer → `world`. */
export function artSlug(layer: string): string {
  if (layer === 'map' || layer === 'world') return 'world';
  return layer.replace(/^world\//, '').replace(/[^A-Za-z0-9_-]+/g, '-').replace(/^-+|-+$/g, '') || 'world';
}

/** The layer a README belongs to: `world/README.md` → `map`, `world/x/README.md` → `world/x`. */
export function layerOfReadme(file: string): string | null {
  if (file === 'world/README.md') return 'map';
  const match = /^(world\/.+)\/README\.md$/.exec(file);
  return match ? match[1] : null;
}

/** The layer a card sits in: `world/x/npc.md` → `world/x`, `world/npc.md` → `map`. */
function layerOfCard(file: string): string {
  const dir = file.split('/').slice(0, -1).join('/');
  return dir === 'world' ? 'map' : dir;
}

const suggest = {
  scene: (layer: string) => `assets/scenes/${artSlug(layer)}.png`,
  map: (layer: string) => `assets/maps/${artSlug(layer)}.png`,
  portrait: (id: string) => `assets/characters/${id.replace(/[^A-Za-z0-9_-]+/g, '-')}.png`,
  ending: (id: string) => `assets/endings/${id.replace(/[^A-Za-z0-9_-]+/g, '-')}.png`,
};

function mapPictureOf(frontmatter: Record<string, unknown> | null): string | undefined {
  const map = frontmatter?.map;
  if (typeof map !== 'object' || map === null) return undefined;
  const plan = (map as Record<string, unknown>).plan;
  if (typeof plan !== 'object' || plan === null) return undefined;
  return str((plan as Record<string, unknown>).picture);
}

/**
 * Every picture the world needs, in panel order: each layer's scene + map
 * (root first, then by path), characters' and NPCs' portraits, CGs (world
 * README, then trigger assets), endings. Pure.
 */
export function worldArtManifest(input: WorldArtInput): ArtSlot[] {
  const { manifest, docs, exists } = input;
  const byPath = new Map(docs.map((doc) => [doc.path, doc]));
  const slots: ArtSlot[] = [];
  const push = (slot: Omit<ArtSlot, 'exists' | 'inUseExists'>) => {
    const { inUse, ...rest } = slot;
    const out: ArtSlot = { ...rest, exists: exists(rest.path) };
    if (inUse && inUse !== rest.path) {
      out.inUse = inUse;
      out.inUseExists = exists(inUse);
    }
    slots.push(out);
  };
  const image = (image: ArtImage | undefined, fallback: string) =>
    image ? { path: image.path, prompt: image.prompt, declared: true, ...(image.cutout ? { cutout: true } : {}) } : { path: fallback, prompt: '', declared: false };

  // Layers: root first, then by path so a place sits right after its parent.
  const layerDocs = docs
    .map((doc) => ({ doc, layer: layerOfReadme(doc.path) }))
    .filter((entry): entry is { doc: ArtDoc; layer: string } => entry.layer !== null)
    .sort((a, b) => (a.layer === 'map' ? -1 : b.layer === 'map' ? 1 : a.layer.localeCompare(b.layer)));
  const layerName = (layer: string, fm: Record<string, unknown> | null) =>
    str(fm?.title) ?? str(fm?.name) ?? (layer === 'map' ? str(manifest.name) ?? 'World' : layer.split('/').pop() ?? layer);
  for (const { doc, layer } of layerDocs) {
    const art = artOf(doc.frontmatter);
    const label = layerName(layer, doc.frontmatter);
    push({ id: `layer:${layer}:scene`, owner: 'layer', ownerPath: doc.path, kind: 'scene', layer, label, ...image(art.scene, suggest.scene(layer)), inUse: str(doc.frontmatter?.bg) });
    push({ id: `layer:${layer}:map`, owner: 'layer', ownerPath: doc.path, kind: 'map', layer, label, ...image(art.map, suggest.map(layer)), inUse: mapPictureOf(doc.frontmatter) });
  }

  // Characters (world.json order), then NPC cards.
  const characters = Array.isArray(manifest.characters) ? manifest.characters : [];
  for (const character of characters) {
    const id = str((character as Record<string, unknown> | null)?.id);
    if (!id) continue;
    const ownerPath = `characters/${id}/README.md`;
    const doc = byPath.get(ownerPath);
    if (!doc) continue;
    const art = artOf(doc.frontmatter);
    const label = str((character as Record<string, unknown>).name) ?? str(doc.frontmatter?.name) ?? id;
    const home = str((character as Record<string, unknown>).home);
    push({
      id: `character:${id}:portrait`, owner: 'character', ownerPath, kind: 'portrait', label,
      ...(home ? { layer: home === 'world' ? 'map' : home } : {}),
      ...image(art.portrait, suggest.portrait(id)),
      inUse: str(doc.frontmatter?.avatar) ?? str((character as Record<string, unknown>).avatar),
    });
  }
  for (const doc of [...docs].sort((a, b) => a.path.localeCompare(b.path))) {
    if (doc.frontmatter?.type !== 'npc' || !doc.path.startsWith('world/') || layerOfReadme(doc.path)) continue;
    const art = artOf(doc.frontmatter);
    const name = doc.path.split('/').pop()!.replace(/\.md$/, '');
    push({
      id: `npc:${doc.path}:portrait`, owner: 'npc', ownerPath: doc.path, kind: 'portrait', layer: layerOfCard(doc.path),
      label: str(doc.frontmatter?.name) ?? name,
      ...image(art.portrait, suggest.portrait(name)),
      inUse: str(doc.frontmatter?.avatar),
    });
  }

  // CGs: the world README's list, then what triggers declare.
  const root = byPath.get('world/README.md');
  for (const cg of artOf(root?.frontmatter ?? null).cg ?? []) {
    push({ id: `cg:${cg.id}`, owner: 'cg', ownerPath: 'world/README.md', kind: 'cg', label: cg.id, path: cg.path, prompt: cg.prompt, declared: true, ...(cg.when ? { when: cg.when } : {}) });
  }
  const triggers = Array.isArray(manifest.triggers) ? manifest.triggers : [];
  triggers.forEach((trigger) => {
    const t = trigger as Record<string, unknown> | null;
    const tid = str(t?.id);
    if (!tid || !Array.isArray(t?.assets)) return;
    (t.assets as unknown[]).forEach((asset, index) => {
      const a = asset as Record<string, unknown> | null;
      const path = str(a?.path);
      if (!path || !ART_PATH_RE.test(path) || path.includes('..')) return;
      const kind = a?.kind === 'background' ? 'scene' : a?.kind === 'portrait' ? 'portrait' : a?.kind === 'item' ? 'item' : 'cg';
      push({
        id: `trigger:${tid}:${index}`, owner: 'trigger', ownerPath: 'world.json', kind,
        label: str(t.label) ?? tid, path, prompt: typeof a?.prompt === 'string' ? a.prompt : '', declared: true, when: tid,
      });
    });
  });

  // Endings: world.json's list, each README's art.scene.
  const endings = Array.isArray(manifest.endings) ? manifest.endings : [];
  for (const ending of endings) {
    const e = ending as Record<string, unknown> | null;
    const id = str(e?.id);
    if (!id) continue;
    const ownerPath = str(e?.path) ?? `endings/${id}/README.md`;
    const doc = byPath.get(ownerPath);
    if (!doc) continue;
    const art = artOf(doc.frontmatter);
    push({ id: `ending:${id}:scene`, owner: 'ending', ownerPath, kind: 'scene', label: str(e?.title) ?? str(doc.frontmatter?.title) ?? id, ...image(art.scene, suggest.ending(id)), inUse: str(doc.frontmatter?.bg) });
  }
  return slots;
}

/**
 * The frontmatter after writing a slot's prompt (and path, for a slot not yet
 * declared). Pure; `null` when the slot is not a frontmatter slot (trigger
 * assets live in world.json — see `withTriggerAssetPrompt`).
 */
export function withArtPrompt(frontmatter: Record<string, unknown>, slot: Pick<ArtSlot, 'id' | 'owner' | 'kind' | 'path'>, prompt: string): Record<string, unknown> | null {
  const art = typeof frontmatter.art === 'object' && frontmatter.art !== null && !Array.isArray(frontmatter.art)
    ? { ...(frontmatter.art as Record<string, unknown>) }
    : {};
  if (slot.owner === 'cg') {
    const id = slot.id.slice('cg:'.length);
    const list = Array.isArray(art.cg) ? [...art.cg] : [];
    const index = list.findIndex((entry) => (entry as Record<string, unknown> | null)?.id === id);
    if (index < 0) return null;
    list[index] = { ...(list[index] as Record<string, unknown>), prompt };
    art.cg = list;
  } else if (slot.kind === 'scene' || slot.kind === 'map' || slot.kind === 'portrait') {
    const current = typeof art[slot.kind] === 'object' && art[slot.kind] !== null ? (art[slot.kind] as Record<string, unknown>) : {};
    art[slot.kind] = { ...current, path: typeof current.path === 'string' ? current.path : slot.path, prompt };
  } else {
    return null;
  }
  return { ...frontmatter, art };
}

/** Set one field on a slot's art entry (path after a landing changed its extension, `cutout`). Pure. */
export function withArtField(frontmatter: Record<string, unknown>, slot: Pick<ArtSlot, 'id' | 'owner' | 'kind' | 'path' | 'prompt'>, field: 'path' | 'cutout', value: string | boolean): Record<string, unknown> {
  const base = withArtPrompt(frontmatter, slot, slot.prompt) ?? { ...frontmatter };
  const art = { ...(base.art as Record<string, unknown>) };
  if (slot.owner === 'cg') {
    const id = slot.id.slice('cg:'.length);
    art.cg = (Array.isArray(art.cg) ? art.cg : []).map((entry) => ((entry as Record<string, unknown>)?.id === id ? { ...(entry as Record<string, unknown>), [field]: value } : entry));
  } else {
    art[slot.kind] = { ...(art[slot.kind] as Record<string, unknown>), [field]: value };
  }
  return { ...base, art };
}

/**
 * Wire a landed picture into what the page reads: a layer scene → `bg`, a map
 * → `map.plan.picture`, a portrait → `avatar`. Endings and CGs have nothing
 * to wire (the trigger / ending screen reads `art` itself). Pure.
 */
export function withLandedArt(frontmatter: Record<string, unknown>, slot: Pick<ArtSlot, 'owner' | 'kind'>, path: string): Record<string, unknown> {
  if (slot.owner === 'layer' && slot.kind === 'scene') return { ...frontmatter, bg: path };
  if (slot.owner === 'layer' && slot.kind === 'map') {
    const map = typeof frontmatter.map === 'object' && frontmatter.map !== null ? (frontmatter.map as Record<string, unknown>) : {};
    const plan = typeof map.plan === 'object' && map.plan !== null ? (map.plan as Record<string, unknown>) : {};
    return { ...frontmatter, map: { ...map, plan: { ...plan, picture: path } } };
  }
  if ((slot.owner === 'character' || slot.owner === 'npc') && slot.kind === 'portrait') return { ...frontmatter, avatar: path };
  return frontmatter;
}
