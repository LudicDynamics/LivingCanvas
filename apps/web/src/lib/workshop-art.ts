/**
 * Creation-mode art: the pure half of the 素材
 * panel. The panel shows every picture the world needs with the prompt that
 * paints it — the current place first (scene + map, switchable), then
 * portraits, CGs, endings, and the other places.
 *
 * Only for the author's own DRAFT workshop world: `manifest.authoring` (the
 * server decides it) and `workshop.status === 'draft'`. Play mode and a
 * published world never see it.
 */
import type { WorkshopArtSlot } from './airp-gateway.js';

export type ArtPanelTab = 'assets' | 'setup' | 'states' | 'triggers' | 'outcomes';
/**
 * The planned authoring panel: 素材 and 设定
 * (the world type / rules / structure picked at creation, the design notes)
 * are built; the rest are placeholders.
 */
export const ART_PANEL_TABS: readonly { id: ArtPanelTab; label: string; ready: boolean }[] = [
  { id: 'assets', label: 'Assets', ready: true },
  { id: 'setup', label: 'World setup', ready: true },
  { id: 'states', label: 'States', ready: false },
  { id: 'triggers', label: 'Triggers', ready: false },
  { id: 'outcomes', label: 'Outcomes', ready: false },
];

export function isArtAuthoring(manifest: { authoring?: boolean; workshop?: { status?: string } } | null | undefined): boolean {
  return manifest?.authoring === true && manifest.workshop?.status === 'draft';
}

/**
 * The workshop's floating chrome — the 「素材」 tab and the 「试玩」 pill — belongs
 * to the creation-mode canvas only
 * Hidden while the
 * launcher, the first-entry intro card, a full-screen dialog or a Nook is up.
 */
export function showWorkshopChrome(view: { artAuthoring: boolean; nook: boolean; launcherOpen: boolean; introOpen: boolean; modalOpen?: boolean }): boolean {
  return view.artAuthoring && !view.nook && !view.launcherOpen && !view.introOpen && !view.modalOpen;
}

export interface ArtSections {
  /** The current place's scene and map, when it has a README. */
  scene: WorkshopArtSlot | null;
  map: WorkshopArtSlot | null;
  portraits: WorkshopArtSlot[];
  cgs: WorkshopArtSlot[];
  endings: WorkshopArtSlot[];
  /** Every other place's scene + map, in the server's order. */
  places: WorkshopArtSlot[];
}

/** Split the slot list for the panel. Pure; unknown owners are dropped. */
export function artSections(slots: readonly WorkshopArtSlot[], layer: string): ArtSections {
  const out: ArtSections = { scene: null, map: null, portraits: [], cgs: [], endings: [], places: [] };
  for (const slot of slots) {
    if (slot.owner === 'layer') {
      if (slot.layer === layer && slot.kind === 'scene') out.scene = slot;
      else if (slot.layer === layer && slot.kind === 'map') out.map = slot;
      else out.places.push(slot);
    } else if (slot.owner === 'character' || slot.owner === 'npc') out.portraits.push(slot);
    else if (slot.owner === 'cg' || slot.owner === 'trigger') out.cgs.push(slot);
    else if (slot.owner === 'ending') out.endings.push(slot);
  }
  return out;
}

export type ArtPreview =
  | { state: 'ready'; url: string }
  /** The declared picture is missing, but an older one is wired now. */
  | { state: 'in-use'; url: string }
  | { state: 'missing' };

export function artPreview(slot: WorkshopArtSlot | null | undefined): ArtPreview {
  if (slot?.exists && slot.url) return { state: 'ready', url: slot.url };
  if (slot?.inUseExists && slot.inUseUrl) return { state: 'in-use', url: slot.inUseUrl };
  return { state: 'missing' };
}

/** The current layer's map slot when its picture is not painted yet (the in-world map view's note). */
export function missingMapSlot(slots: readonly WorkshopArtSlot[], layer: string): WorkshopArtSlot | null {
  const slot = slots.find((s) => s.owner === 'layer' && s.kind === 'map' && s.layer === layer);
  return slot && !slot.exists ? slot : null;
}

/** Replace one slot in the list after a write answered with its new state. */
export function withSlot(slots: readonly WorkshopArtSlot[], next: WorkshopArtSlot | null): WorkshopArtSlot[] {
  if (!next) return [...slots];
  return slots.map((s) => (s.id === next.id ? next : s));
}

export const ART_UPLOAD_TYPES = ['image/png', 'image/jpeg', 'image/webp'] as const;
export const ART_UPLOAD_MAX_BYTES = 8 * 1024 * 1024;

/** Why a picked file cannot be uploaded, or `null` when it can. Mirrors the server's limits. */
export function uploadProblem(file: { type: string; size: number }): 'type' | 'size' | null {
  if (!(ART_UPLOAD_TYPES as readonly string[]).includes(file.type)) return 'type';
  if (file.size === 0 || file.size > ART_UPLOAD_MAX_BYTES) return 'size';
  return null;
}

/** `data:<mime>;base64,<data>` → the base64 part. */
export function base64OfDataUrl(dataUrl: string): string {
  const comma = dataUrl.indexOf(',');
  return comma < 0 ? '' : dataUrl.slice(comma + 1);
}

/** Whether a slot's prompt has unsaved edits. */
export function promptDirty(slot: WorkshopArtSlot | null | undefined, draft: string | undefined): boolean {
  return Boolean(slot) && draft !== undefined && draft.trim() !== slot!.prompt;
}
