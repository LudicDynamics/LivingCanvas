import type { z } from 'zod';
import type { Actor } from '../actions/actor.js';
import type { WorldStore } from '../store/world-store.js';
import type { Accepts } from '../schemas/components.js';

export type { Accepts };

/** One frontmatter field a kind documents. Echoed verbatim by `get_component`. */
export interface FieldDoc {
  name: string;
  type: string;
  required: boolean;
  desc: string;
  example?: string;
}

export type PackId = 'core' | 'adventure' | 'mystery' | 'chronicle' | 'craft' | 'room';

/** doc 10 E12: the four click outcomes. */
export type ClickOutcome = 'read' | 'continue' | 'visual' | 'look';

/** doc 10 §16.2: the seven second-layer shapes. */
export type SecondLayer =
  | 'none'
  | 'read'
  | 'read+continue'
  | 'fragments'
  | 'pairs'
  | 'pages'
  | 'board';

/**
 * An entity handed to a `use_item_on` handler, frontmatter already parsed.
 * `body` is optional because doc 08 §3.4's frozen shape is `{path,name,frontmatter}`;
 * doc 10 §15.3's handler example needs the body to rewrite the file intact, so
 * callers that have it pass it and handlers treat a missing body as empty.
 */
export interface EntityRef {
  path: string;
  name: string;
  frontmatter: Record<string, unknown>;
  body?: string;
}

export type HandlerOutcome =
  | { handled: true; summary?: string; details?: Record<string, unknown> }
  | { handled: false; reason?: string };

/**
 * Deterministic `use_item_on` outcome (doc 10 §15.3 == doc 08 §3.4). Four
 * disciplines, all enforced by doc 08 §3.4:
 *   1. looked up by the TARGET's kind, never the item's;
 *   2. the only world change is rewriting the target's own frontmatter, via
 *      `store.writeFileAtomic` — never create/move/delete, never prompt, never
 *      emit a WS frame;
 *   3. `handled:false` is a legal result, not an error and not a silent drop;
 *   4. the target's parsed frontmatter is passed in so the handler need not
 *      re-read the file.
 */
export type UseItemOnHandler = (args: {
  item: EntityRef;
  target: EntityRef;
  actor: Actor;
  store: WorldStore;
  turn: string;
}) => Promise<HandlerOutcome>;

/** One registry entry (doc 10 §13.1). Lives in code, not in world data. */
export interface ComponentDef {
  /** Registry key == the frontmatter `component` value. */
  kind: string;
  pack: PackId;
  /** English UI label, shown on the card's type tab. */
  label: string;
  /** ONE English line: what the kind is for. */
  purpose: string;
  /**
   * Frontmatter predicate. First match wins; registry order is dispatch order.
   * Pure and side-effect free.
   */
  match: (fm: Record<string, unknown>, filename: string) => boolean;
  /** The kind's own extra fields, on top of the shared kernel. */
  fields: FieldDoc[];
  click: ClickOutcome;
  channels: { choice?: boolean; status?: boolean; rollDice?: boolean; useItemTarget?: boolean };
  /** Presentation-layer draggability only (00 §2.4: the engine adds no allowlist). */
  movable: boolean;
  secondLayer: SecondLayer;
  /** What this kind responds to as a `use_item_on` target (doc 10 §15.2). */
  accepts?: Accepts;
  /** Optional deterministic outcome handler (doc 10 §15.3). */
  handler?: UseItemOnHandler;
  /** Smallest valid frontmatter + one body line, English. Echoed by get_component. */
  example: string;
}

/** One performance in the `show` registry (doc 10 §14.3). */
export interface ShowDef {
  id: string;
  /** ONE English line: what the performance looks like. */
  purpose: string;
  /** The performance's own param schema; `params` is validated against it. */
  params: z.ZodTypeAny;
  /** Default duration in ms; `duration_ms` overrides it, clamped to [300,12000]. */
  defaultDuration: number;
  /** True when the performance is meaningless without a `target` path. */
  requiresTarget: boolean;
}
