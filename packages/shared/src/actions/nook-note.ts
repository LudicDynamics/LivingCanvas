import { fail } from './errors.js';
import { writeChalk, nextOrdinal, slugify } from './chalk.js';
import type { ActionContext, ActionResult } from './types.js';
import type { WorldStore } from '../store/world-store.js';
import { isValidCharacterId, nookIdOf } from '../rules/characters.js';
import {
  NookNoteInputSchema,
  type NookNoteInput,
  type NookNoteOutcome,
} from '../schemas/nook-note.js';
import type { WorldEvent } from '../schemas/events.js';


type CachedNote = {
  fingerprint: string;
  result: ActionResult<NookNoteDetails>;
};

/** Serialise ordinal allocation per world/nook without adding persistent state. */
const NOTE_LOCKS = new Map<string, Promise<void>>();
const CLIENT_RESULTS = new WeakMap<WorldStore, Map<string, CachedNote>>();

async function inNookQueue<T>(key: string, run: () => Promise<T>): Promise<T> {
  const previous = NOTE_LOCKS.get(key) ?? Promise.resolve();
  let release!: () => void;
  const current = new Promise<void>((resolve) => { release = resolve; });
  NOTE_LOCKS.set(key, current);
  await previous;
  try {
    return await run();
  } finally {
    release();
    if (NOTE_LOCKS.get(key) === current) NOTE_LOCKS.delete(key);
  }
}

export interface NookNoteDetails extends NookNoteOutcome {
  /** The authoritative event retained for the event bridge / callers. */
  event: WorldEvent;
  clientRef?: string;
}

/**
 * Player Nook note seam.
 *
 * This is intentionally a narrow adapter over writeChalk: it owns the player
 * authorization and nook path generation, while the existing chalk action
 * remains the one file serializer and entity_created event writer.
 */
export async function writeNookNote(
  ctx: ActionContext,
  input: NookNoteInput,
): Promise<ActionResult<NookNoteDetails>> {
  if (ctx.actor.type !== 'player' || ctx.actor.id !== undefined) {
    fail('invalid_argument', 'nook notes require the player actor');
  }

  const parsed = NookNoteInputSchema.safeParse(input);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    fail('invalid_argument', issue?.message ?? 'Invalid nook note input');
  }

  const { characterId, title, body, clientRef } = parsed.data;
  if (!isValidCharacterId(characterId)) {
    fail('invalid_argument', 'characterId must be a lower-kebab-case id');
  }
  const nookId = nookIdOf(characterId);
  if (nookId === null) {
    // Keep path construction behind the shared helper even though the shape
    // check above already establishes this branch as unreachable.
    fail('invalid_argument', 'characterId must be a lower-kebab-case id');
  }
  const key = `${ctx.store.worldRoot}\u0000${nookId}`;
  return inNookQueue(key, async () => {
    if ((await ctx.store.statKind(nookId)) !== 'dir') {
      fail('not_found', `character "${characterId}" has no nook directory`);
    }

    const fingerprint = `${title}\u0000${body}`;
    let clientCache: Map<string, CachedNote> | undefined;
    if (clientRef !== undefined) {
      clientCache = CLIENT_RESULTS.get(ctx.store);
      if (!clientCache) {
        clientCache = new Map();
        CLIENT_RESULTS.set(ctx.store, clientCache);
      }
      const cached = clientCache.get(`${nookId}\u0000${clientRef}`);
      if (cached) {
        if (cached.fingerprint !== fingerprint) {
          fail('invalid_argument', `clientRef '${clientRef}' was already used for a different note`);
        }
        return cached.result;
      }
    }

    // Generate the target while holding the per-world/nook queue, rather than
    // accepting any client path. It is necessarily one direct child; writeChalk
    // still performs its own path and collision checks before writing.
    const files = await ctx.store.listFiles(nookId);
    const ordinal = nextOrdinal(files.map((file) => file.slice(file.lastIndexOf('/') + 1)));
    const targetPath = `${nookId}/${ordinal}-${slugify(title)}.md`;

    const result = await writeChalk({ ...ctx, nookNote: true }, {
      body,
      title,
      path: targetPath,
      layer: nookId,
      ...(clientRef !== undefined ? { clientRef } : {}),
    });
    const event = result.details.event;
    if (!event) {
      fail('event_failed', 'Nook note was written but its world event was not recorded');
    }

    const outcome: ActionResult<NookNoteDetails> = {
      text: result.text,
      details: {
        path: targetPath,
        eventSeq: event.seq,
        actor: { type: 'player' },
        created: true,
        event,
        ...(clientRef !== undefined ? { clientRef } : {}),
      },
    };
    if (clientRef !== undefined) {
      clientCache!.set(`${nookId}\u0000${clientRef}`, { fingerprint, result: outcome });
    }
    return outcome;
  });
}
