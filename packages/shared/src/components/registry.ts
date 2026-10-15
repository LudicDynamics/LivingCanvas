import { CARD_FORMS, registerComponentKindResolver, type CardForm } from '../schemas/forms.js';
import { isHtmlPath } from '../rules/html-head.js';
import { isPlayerNoteCard, PLAYER_NOTE_KIND } from '../rules/player-notes.js';
import { COMPONENT_SCHEMAS } from '../schemas/components.js';
import type { Accepts } from '../schemas/components.js';
import { CORE_PACK } from './core.js';
import { ADVENTURE_PACK } from './packs/adventure.js';
import { MYSTERY_PACK } from './packs/mystery.js';
import { CHRONICLE_PACK } from './packs/chronicle.js';
import { CRAFT_PACK } from './packs/craft.js';
import { ROOM_PACK } from './packs/room.js';
import { SHOWS } from './performances.js';
import type { ComponentDef, FieldDoc, ShowDef } from './types.js';

/** Registry order IS dispatch order for `match`. core first, always. */
const ALL: ComponentDef[] = [
  ...CORE_PACK,
  ...ADVENTURE_PACK,
  ...MYSTERY_PACK,
  ...CHRONICLE_PACK,
  ...CRAFT_PACK,
  ...ROOM_PACK,
];

export const COMPONENT_REGISTRY: Record<string, ComponentDef> = Object.fromEntries(
  ALL.map((d) => [d.kind, d])
);

export const SHOW_REGISTRY: Record<string, ShowDef> = Object.fromEntries(SHOWS.map((s) => [s.id, s]));

/** Footprint lookup that fails loud: a registered kind without a form is a dev error. */
function formOf(kind: string): CardForm {
  const form = CARD_FORMS[kind];
  if (!form) throw new Error(`component "${kind}" has no CARD_FORMS entry`);
  return form;
}

// --- m-20: forms.ts stays a leaf. Push the resolver in rather than importing it
// back, which would create the cycle forms.ts -> registry.ts -> forms.ts.
registerComponentKindResolver((fm, filename) => resolveComponentKind(fm, filename));

// Fail loud at module load (doc 10 appendix B, disciplines 3 & 4).
for (const d of ALL) {
  if (!CARD_FORMS[d.kind]) throw new Error(`component "${d.kind}" has no CARD_FORMS entry`);
  if (SHOW_REGISTRY[d.kind]) throw new Error(`"${d.kind}" is both a docked component and a performance`);
  // `accepts` and `channels.useItemTarget` are two views of one fact (doc 10
  // §2.1: the index marker comes from the channel, hover filtering from accepts).
  // Drift means the index either hides a target or advertises a dead one.
  if (Boolean(d.accepts) !== Boolean(d.channels.useItemTarget)) {
    throw new Error(`component "${d.kind}" disagrees on use_item_on target status (accepts vs channels.useItemTarget)`);
  }
}
if (Object.keys(COMPONENT_SCHEMAS).length !== ALL.length) {
  throw new Error('COMPONENT_SCHEMAS and COMPONENT_REGISTRY have different sizes');
}

/**
 * Resolve a component kind from parsed frontmatter + filename (doc 10 §3.1).
 * Registry order is the dispatch order; the first matching predicate wins.
 *
 * The non-component kinds are handled BEFORE the registry loop so a component
 * predicate can never swallow chalk / a scene gate / a character sprite / an
 * HTML page:
 *   - `type: chalk` is narration;
 *   - `type: gate` or a `README.md` is a scene gate (derived, never registered);
 *   - `type: sprite` or `type: character` is a character presence;
 *   - a `.html` filename is an HTML page card (derived, never registered —
 *     MUST be filename-driven, see the branch below).
 * Everything else falls through to the note predicate, matching the historical
 * `forms.ts` fallback (a bare markdown file is a sticky note).
 */
export function resolveComponentKind(
  fm: Record<string, unknown> | null | undefined,
  filename: string
): string {
  const f = fm || {};
  if (f.type === 'chalk') return 'chalk';
  if (f.type === 'gate' || filename === 'README.md') return 'gate';
  if (f.type === 'sprite' || f.type === 'character') return 'sprite';
  // H1 / contract §4.2: a bare `.html` is a non-component kind, same class as
  // chalk / gate / sprite. Position is load-bearing: this MUST sit before the
  // registry loop because the `note` predicate matches `{}` (core.ts:100-103),
  // so a branch after the loop would be swallowed.
  //
  // FILENAME-driven on purpose: `seatFileOf` / `anchorOf` / `cardWritingFrame`
  // never see the virtual frontmatter, so `f.type === 'html'` would miss all
  // three. This one branch is also what makes `cardWritingFrame` correct with
  // zero changes (contract §6.6).
  if (isHtmlPath(filename)) return 'html';
  // A player's sticky note: type AND the
  // owned file name, so frontmatter alone can never forge one.
  if (isPlayerNoteCard(f, filename)) return PLAYER_NOTE_KIND;
  for (const def of ALL) {
    if (def.match(f, filename)) return def.kind;
  }
  return 'note';
}

/**
 * The registry entry for a kind, or null when it is not a docked component.
 * Named `componentDefOf` (not `getComponent`) so it does not collide with the
 * `get_component` action of the same domain — both reach the barrel.
 */
export function componentDefOf(kind: string | null | undefined): ComponentDef | null {
  if (!kind) return null;
  return COMPONENT_REGISTRY[kind] ?? null;
}

/** `get_component`'s per-kind payload (doc 10 §2.1). */
export interface ComponentDoc {
  kind: string;
  pack: string;
  label: string;
  purpose: string;
  click: string;
  channels: { choice?: boolean; status?: boolean; rollDice?: boolean; useItemTarget?: boolean };
  movable: boolean;
  secondLayer: string;
  accepts?: Accepts;
  form: CardForm;
  fields: FieldDoc[];
  example: string;
  related: string[];
}

/** Tools that matter for a kind, in the order a model should reach for them. */
function relatedOf(def: ComponentDef): string[] {
  const related = ['look_at'];
  if (def.channels.choice) related.push('choose');
  if (def.channels.rollDice) related.push('roll_dice');
  if (def.channels.useItemTarget) related.push('use_item_on');
  return related;
}

/** Compose one `ComponentDoc`; `form` is read LIVE from `CARD_FORMS` (never copied). */
export function componentDocOf(kind: string): ComponentDoc | null {
  const def = COMPONENT_REGISTRY[kind];
  if (!def) return null;
  return {
    kind: def.kind,
    pack: def.pack,
    label: def.label,
    purpose: def.purpose,
    click: def.click,
    channels: def.channels,
    movable: def.movable,
    secondLayer: def.secondLayer,
    accepts: def.accepts,
    form: formOf(def.kind),
    fields: def.fields,
    example: def.example,
    related: relatedOf(def),
  };
}

/** Every kind, in registry order. */
export function listComponents(): ComponentDoc[] {
  return ALL.map((d) => componentDocOf(d.kind)).filter((d): d is ComponentDoc => d !== null);
}

/** Every performance id, in the §14.3 table order. */
export function listPerformances(): ShowDef[] {
  return SHOWS;
}

/**
 * The ONE accept-matching function the frontend and `use_item_on` both call
 * (doc 10 §15.2). Never a second switch elsewhere — that is how the two drift.
 *
 * Rule: `any === true` → hit; else the item's `component`/`type` is in
 * `itemKinds` → hit; else the item's `tags` intersect `itemTags` → hit; else no.
 * `candidate` means "could be a legal target", never "will succeed".
 */
export function useItemTargetOf(
  targetKind: string,
  itemFm: Record<string, unknown> | null | undefined
): { candidate: boolean; hint?: string } {
  const accepts = COMPONENT_REGISTRY[targetKind]?.accepts;
  if (!accepts) return { candidate: false };
  // `hint` only rides along on a hit — the hover glow is the only consumer, and
  // a miss with a hint would be a lie ("Use a key here" on a card that rejects it).
  const hit = (): { candidate: true; hint?: string } =>
    accepts.hint ? { candidate: true, hint: accepts.hint } : { candidate: true };

  if (accepts.any === true) return hit();

  const fm = itemFm || {};
  const kinds = accepts.itemKinds ?? [];
  const itemKindTokens = [fm.component, fm.type].filter((v): v is string => typeof v === 'string');
  if (itemKindTokens.some((t) => kinds.includes(t))) return hit();

  const tags = accepts.itemTags ?? [];
  const itemTags = Array.isArray(fm.tags)
    ? fm.tags.filter((t): t is string => typeof t === 'string')
    : [];
  if (itemTags.some((t) => tags.includes(t))) return hit();

  return { candidate: false };
}
