import { fail } from './errors.js';
import { registerAction } from './service.js';
import type { ActionContext, ActionResult } from './types.js';
import type { Actor } from './actor.js';
import { parseFrontmatter, entityName } from '../schemas/frontmatter.js';
import { SHOW_REGISTRY, componentDefOf } from '../components/registry.js';
import { SHOW_IDS } from '../components/performances.js';
import type { ShowDef } from '../components/types.js';

/** Input shape of `show` (doc 10 §2.2). */
export interface ShowInput {
  component: string;
  target?: string;
  links?: string[];
  params?: Record<string, unknown>;
  duration_ms?: number;
  caption?: string;
}

/** The frame the server relays verbatim (doc 10 §2.2). */
export interface ShowFrame {
  type: 'show_frame';
  component: string;
  target?: string;
  targetName?: string;
  links?: string[];
  params: Record<string, unknown>;
  durationMs: number;
  caption?: string;
  actor: Actor;
  /** Filled by the server mapping layer, never by the tool. */
  timestamp?: string;
}

export interface ShowDetails {
  performance: string;
  resolved: {
    target?: string;
    targetName?: string;
    links?: string[];
    params: Record<string, unknown>;
    durationMs: number;
  };
  frame: ShowFrame;
}

const MIN_DURATION = 300;
const MAX_DURATION = 12000;

/**
 * A compact description of a performance's accepted params, used in the E8
 * error copy. Zod's own issue message covers the specific failure; this names
 * the whole shape so the model can retry without another lookup.
 */
function paramShape(def: ShowDef): string {
  const shape = def.params;
  const keys =
    typeof shape === 'object' && shape !== null && 'shape' in shape
      ? Object.keys((shape as { shape: Record<string, unknown> }).shape)
      : [];
  return keys.length ? `{ ${keys.join(', ')} }` : '{}';
}

/**
 * `show` — the one-shot channel for a performance component (doc 10).
 * Read-only with respect to the world: it reads the target file (for existence
 * and its name) and returns `details.frame`. It never writes a file, touches the
 * canvas DB, or appends an event — a performance is a transient frame, not a
 * world change. The frame reaches the server through `details`, because the
 * extension MUST NOT assume it has a WebSocket (00 §1).
 */
export async function showComponent(
  ctx: ActionContext,
  input: ShowInput
): Promise<ActionResult<ShowDetails>> {
  const id = input.component;
  if (typeof id !== 'string' || id === '') {
    fail('invalid_argument', 'component is required and must be a performance id.');
  }

  // E4: a docked component kind is legal but is not a performance. Push the
  // caller back to the write/chalk path rather than performing an empty show.
  if (!SHOW_REGISTRY[id] && componentDefOf(id) !== null) {
    fail(
      'unsupported',
      `${id} is a docked component, not a performance. Write it with write or chalk; run get_component({component:"${id}"}) for its frontmatter.`
    );
  }

  const def = SHOW_REGISTRY[id];
  if (!def) {
    fail('not_found', `Unknown performance "${id}". Available: ${SHOW_IDS.join(', ')}.`);
  }

  // E9: a non-numeric duration is a parameter type error, not a silent default.
  if (input.duration_ms !== undefined && typeof input.duration_ms !== 'number') {
    fail('invalid_argument', 'duration_ms must be a number of milliseconds.');
  }

  // E6: performances that focus on a card need a target path.
  const target = input.target;
  if (def.requiresTarget && !target) {
    fail(
      'invalid_argument',
      `${id} needs a target path (the card to focus). Pass target: "world/<layer>/<file>.md".`
    );
  }

  let targetName: string | undefined;
  if (target) {
    let raw: string;
    try {
      raw = await ctx.store.readFile(target);
    } catch {
      fail('not_found', `Target not found: "${target}". Nothing was shown.`);
    }
    // `detail` self-sufficiency (doc 21 §3.3): carry the name as it is NOW, so
    // the frame still says the right thing if the file is renamed later.
    targetName = entityName(parseFrontmatter(raw).frontmatter, target) || target.split('/').pop()!.replace(/\.md$/, '');
  }

  // E10: evidence_burst degrades visibly — bad link paths are dropped and
  // counted; if every link is bad the whole performance is refused.
  let links: string[] | undefined;
  let droppedLinks = 0;
  if (input.links !== undefined) {
    if (!Array.isArray(input.links)) {
      fail('invalid_argument', 'links must be an array of world-relative paths.');
    }
    const kept: string[] = [];
    for (const link of input.links) {
      try {
        await ctx.store.readFile(link);
        kept.push(link);
      } catch {
        droppedLinks += 1;
      }
    }
    if (input.links.length > 0 && kept.length === 0) {
      fail('not_found', `None of the ${input.links.length} link paths were found. Nothing was shown.`);
    }
    links = kept;
  }

  // E8: params are validated by the performance's own schema.
  const parsedParams = def.params.safeParse(input.params ?? {});
  if (!parsedParams.success) {
    const detail = parsedParams.error.issues
      .map((i) => `${i.path.join('.') || 'params'}: ${i.message}`)
      .join('; ');
    fail('invalid_field_value', `Bad params for ${id}: ${detail}. Expected: ${paramShape(def)}.`);
  }
  const params = parsedParams.data as Record<string, unknown>;

  const durationMs = Math.min(MAX_DURATION, Math.max(MIN_DURATION, input.duration_ms ?? def.defaultDuration));

  const frame: ShowFrame = {
    type: 'show_frame',
    component: id,
    ...(target ? { target } : {}),
    ...(targetName ? { targetName } : {}),
    ...(links ? { links } : {}),
    params,
    durationMs,
    ...(input.caption ? { caption: input.caption } : {}),
    actor: ctx.actor,
  };

  const parts: string[] = [`Showing "${id}"`];
  if (targetName && target) parts.push(`on "${targetName}" (${target})`);
  parts.push(`for ${durationMs}ms.`);
  if (droppedLinks > 0) {
    parts.push(
      `${droppedLinks} of ${input.links!.length} link paths were not found and were skipped; showing ${links!.length} thread${links!.length === 1 ? '' : 's'}.`
    );
  }
  if (input.caption) parts.push(`Caption: ${input.caption}`);

  return {
    text: parts.join(' '),
    details: {
      performance: id,
      resolved: {
        ...(target ? { target } : {}),
        ...(targetName ? { targetName } : {}),
        ...(links ? { links } : {}),
        params,
        durationMs,
      },
      frame,
    },
  };
}

registerAction('showComponent', (ctx, input) => showComponent(ctx, input as unknown as ShowInput));
