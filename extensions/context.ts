/**
 * AIRP per-turn world-state injection — the ONE top-level extension that
 * registers the `airp_world_state` custom type and the hooks behind it.
 *
 * Registered (the design notes as revised by 07 §2.5 table D — five, exact
 * and closed):
 *   1. `registerCustomType(WORLD_STATE_CUSTOM_TYPE, ...)` — declares the dynamic
 *      injection layer (context:'include', llmRole:'user', compaction:'exclude').
 *   2. `pi.on('agent_start', ...)` — the TURN BOUNDARY. All the heavy work
 *      (directory scan, two db reads, rendering) runs here ONCE, and the result
 *      is cached (01 §3.2 / 06 §4.1).
 *   3. `pi.on('context', ...)` — the injection seam. PURE, O(1): read the cached
 *      string and append one message. Never renders, never does I/O.
 *   4. `pi.on('turn_start', ...)` — records `event.turnIndex`: the injection
 *      gate's input (01 §3.3). `toolkit/turn.ts` has its own independent module
 *      instance; the loader's `moduleCache:false` means they share no state.
 *   5. `pi.on('turn_end', ...)` — resets the mirror to -1 so a trace is fully
 *      forgotten the moment it ends (07 §4.1 hardening 2).
 *
 * NOT registered, on purpose (06 §2.2 / §2.4):
 *   - `renderContent`: the inject block never touches the session transcript, so
 *     there is no storage round-trip that needs its identity to survive the
 *     custom → user seam. If anyone ever moves the block onto a persistent path
 *     (`sendCustomMessage` / `before_agent_start.message`), they MUST add
 *     `renderContent` in the same change — otherwise the block loses its marker.
 *   - `before_agent_start`: its `message` is persisted as a `custom_message`
 *     entry and ACCUMULATES every turn (AUDIT S1). `agent_start` covers the
 *     turn-boundary signal without that trap.
 *   - `session_compact`: every turn recomputes in full and the cache has no
 *     fingerprint — there is nothing to reset (00 §9.2 / AUDIT §3.3).
 *   - `session_start` / `leaf_changed`: not needed by the minimal version
 *     (§4.3 below).
 *   - `tool_result` (the event-table write side): outside this batch.
 *   - any `state_*` / state file / state namespace: 00 §12 item 5.
 *
 * Module state (`currentTurnIndex`, the store getters) is per-EXTENSION-FILE,
 * not per-process (00 §9 / 06 §3.1): the loader builds one
 * `createJiti(..., { moduleCache: false })` per extension file
 * (`loader.ts:503-509`, call site :556), so this file CANNOT reuse
 * `extensions/toolkit/actor.ts`'s actor cache or `deps.ts`'s store cache — those
 * are different module instances. Hence the local identity resolution below (a
 * COPY of toolkit's pattern, not a re-export) and the store getter in
 * `./toolkit/deps.js` (`peekWorldStore`), plus a self-open fallback here.
 *
 * SUBAGENTS GET NO INJECTION (06 §7): the scene-init / nook-init subagents build
 * a child session with ZERO extensions (`subagent/run.ts:79-98`) and only the
 * `tool_*` handlers are forwarded (`:109-138`). `context` / `agent_start` are
 * never forwarded. Do NOT go looking for "why B5 has no block" here — it has
 * none by design (the initialiser wants a brief, not the player's viewpoint).
 *
 * CACHE INVALIDATION IS DELIBERATELY NOT IMPLEMENTED (06 §4.3): the single-slot
 * cache is unconditionally overwritten at every turn boundary, so there is no
 * "carry the previous turn over" path and nothing to evict. A branch switch
 * (`/new`, `/resume`, `/fork`, `/tree`) is covered by the cache key containing
 * the sessionId plus the next unconditional recompute. The only stale window is
 * `previewPrompt()` (`/prompt` preview), which never feeds a model. If a
 * long-lived process ever multiplexes several sessions, this MUST be revisited
 * by adding the two clear hooks (06 §4.3):
 *   pi.on('session_start', (event) => { writeTurnBlock(event.sessionId, null); });
 *   pi.on('leaf_changed',  (event) => { writeTurnBlock(event.sessionId, null); });
 *
 * STORAGE IS OPENED READ-WRITE, not read-only (00 §10 / 06 §5, rejecting
 * doc-22 §6):
 *   - `LocalWorldStore` unconditionally opens canvas.db / history.db read-write
 *     and runs DDL (`packages/shared/src/store/local-store.ts:63-73`).
 *   - This extension MUST write `read_cursors` (`local-store.ts:448`), so a pure
 *     read-only path is impossible.
 *   - Concurrency is carried by WAL + `busy_timeout=5000`
 *     (`packages/shared/src/db/schema.ts:5-6`, `:91-92`).
 *   Side effect to know: constructing a store in the agent process also runs the
 *   DDL, so the `viewpoint` table is created by the writer process too — not by
 *   the server alone (`CREATE TABLE IF NOT EXISTS` is idempotent).
 *   DISCIPLINE (06 §5.3 / REVIEW A-10): never let this extension open a SECOND
 *   store when one already exists. `initCanvasDatabase` carries shape-probing
 *   REBUILDS (`DROP TABLE` then `CREATE` for presence / links, schema.ts:29-58 /
 *   :117-136), and WAL + busy_timeout do NOT stop DDL. Max 2 connections per
 *   process, and prefer reusing B1's store via `peekWorldStore()`.
 */
import fs from 'node:fs';
import path from 'node:path';
import type { ExtensionAPI, ExtensionContext } from '@earendil-works/pi-coding-agent';
import {
  LocalWorldStore,
  resolveAgentActor,
  readerOfActor,
  AGENT_ROLE_ENV,
  sectionsFor,
  makeSectionDeps,
  collectSections,
  buildNextStepFacts,
  renderState,
  writeTurnBlock,
  readTurnBlock,
  isFirstProviderRequest,
  warnOnce,
  settleTurnCursor,
  themeWriterBlock,
  worldRulesOf,
  parseSheet,
  sheetsWriterBlock,
  activeKeywordIntents,
  keywordIntentsBlock,
  mappedStates,
  parseFrontmatter,
  debriefWriterNote,
  owedConsequencesBlock,
  livingContextBlock,
  WorldMysterySchema,
  collectWriterPages,
  writerPagesOptionsFromEnv,
} from '../packages/shared/dist/index.js';
import { peekWorldStore } from './toolkit/deps.js';

/** The inject block's customType. Frozen: tests, logs and diagnostics assert on it. */
export const WORLD_STATE_CUSTOM_TYPE = 'airp_world_state';

export default function registerAirpContext(pi: ExtensionAPI): void {
  // Identity resolution is a COPY of `extensions/toolkit/actor.ts:17-31` — the
  // pattern (resolve once, warn once), NOT its module instance (06 §3.3): the
  // loader's `moduleCache:false` means this file cannot read toolkit's cache.
  // A session is a process (00 §9), so resolving in the factory (once per process
  // start) is enough — no lazy loading, no `warned` flag needed. The scope note:
  // this module-level state is visible to THIS FILE ONLY (06 §3.1).
  const resolved = resolveAgentActor(process.env[AGENT_ROLE_ENV]);
  const actor = resolved.actor;
  if (resolved.warning) {
    // Include the reader id so a mis-degraded role is locatable after the fact
    // (06 §10 item 1).
    process.stderr.write(`[airp/context] ${resolved.warning} (reader=${readerOfActor(actor)})\n`);
  }
  // 02's table selection: writer → 6 sections, character:<id> → 4 sections.
  // `sectionsFor` is a pure function, so both loader behaviours (shared modules
  // or not) give the same answer (06 §3.1) — never reuse toolkit's cache here.
  const specs = sectionsFor(actor);
  // The second use of the same identity (00 §6.1): 'writer' | 'character:<id>' | null.
  const reader = readerOfActor(actor);

  // (1) customType policy — first declarer wins (`loader.ts:210-214`; only one
  // declaration per process). `compaction:'exclude'` only keeps summarisation
  // input clean; it is NOT a bound (AUDIT §2.3 pit 2).
  pi.registerCustomType(WORLD_STATE_CUSTOM_TYPE, {
    context: 'include', // visible in the live context
    llmRole: 'user', // matches 00 §4.1: the model receives one user text
    compaction: 'exclude', // dropped from summary input only
  });

  // (1b) The injection gate's input (01 §3.3 / 07 §4.1). The engine resets its
  // own `turnIndex` to 0 at `agent_start` and increments it after each
  // `turn_end`, so a tool-loop continuation carries >= 1 and a first provider
  // request carries exactly 0. This recorder is a SECOND, independent module
  // instance from `toolkit/turn.ts`'s (see the file header) — neither can read
  // the other's state.
  pi.on('turn_start', (event) => {
    currentTurnIndex = event.turnIndex;
  });
  // (1c) Trace end → forget immediately (07 §4.1 hardening 2). Without this, the
  // mirror would sit at the LAST turnIndex of the finished trace; for the common
  // single-request trace that is `0`, and a `previewPrompt()` landing between
  // two traces would then inject a stale block. Safe here: this handler is
  // awaited before `_turnIndex++` and after the turn's last provider response.
  pi.on('turn_end', () => {
    currentTurnIndex = -1;
  });

  // (2) Turn boundary: compute once, cache, settle the writer's cursor.
  // `agent_start` is emitted (and awaited) before this run's first provider
  // request (`agent-loop.ts:109` → `:116`), so the cache is never a turn late.
  pi.on('agent_start', async (_event, ctx) => {
    currentTurnIndex = -1; // fail-closed, FIRST line: the gate stays shut until this trace's `turn_start{0}` (07 §4.1 hardening 1)
    const sessionId = ctx.sessionManager.getSessionId(); // the cache key (01 §3.2)
    // The store open sits INSIDE the try: a locked / unreadable / deleted world
    // must degrade to "no injection", never fail a turn (06 §8, 00 §11).
    let store: LocalWorldStore | null = null;
    try {
      store = worldStoreFor(ctx);
      // Heavy work, once per turn, all inside 01's functions (01 §4/§5):
      // §4.7 resolves deps.layer / viewport / the memoised event read once.
      const deps = await makeSectionDeps({ store, actor, reader, specs });
      const collected = await collectSections({ ...deps, specs }); // 01 §4.1, per-section fail-soft
      const facts = await buildNextStepFacts(deps, collected); // 01 §4.5: async (reads the memo)
      const themed = withThemeBlock(renderState(collected, facts), actor.type === 'writer' ? store.worldRoot : null); // 01 §4.2: pure, total, never ''
      // Character skills: the writer sees every
      // sheet, a character process only its own.
      const block = withSheetsBlock(themed, store.worldRoot, actor.type === 'writer' ? null : actor.type === 'character' ? actor.id ?? '' : '');
      // Turning points + the player's condition: writer only.
      const withTriggers = actor.type === 'writer' ? await withTriggerBlock(block, store) : block;
      // A living world: the hour, today's events and
      // the residents for the writer; the hour and their own whereabouts for a character.
      const withLiving = await withLivingBlock(withTriggers, store, actor);
      // The page the player stands on, already opened:
      // writer only, so its first step can write instead of reading.
      writeTurnBlock(sessionId, actor.type === 'writer' ? await withPagesBlock(withLiving, store, deps.layer) : withLiving); // L3 normal path
      // 00 §6.2 item 2: ONLY the writer advances at the turn boundary. Character
      // processes load this extension too (`launch.ts:129-130`), and
      // `readerOfActor` returns 'character:<id>' for them — so `if (block &&
      // reader)` would be a bug: a character would push its cursor to
      // `getMaxSeq()` every turn, exactly the "advance on open" that 00 §6.2
      // forbids. The character cursor is settled by 03 on the server side when
      // the overlay closes (06 §4.4).
      if (actor.type === 'writer') {
        await settleTurnCursor(store, reader, { advance: true });
      }
    } catch (err) {
      // L3: whole-block failure → null → `readTurnBlock` returns null → no
      // injection. A turn is NEVER failed by injection (00 §11).
      writeTurnBlock(sessionId, null);
      warnOnce('[airp/context] state block assembly failed', err);
      // No injection = no consumption: `{ advance: false }` is a documented
      // no-op (03 §4.3 table row 2). Skipped when the store never opened.
      if (actor.type === 'writer' && store) {
        await settleTurnCursor(store, reader, { advance: false });
      }
    }
  });

  // (3) Injection seam: pure, cheap, no I/O (01 §2.1 — THE single version; do
  // not write a second one). Returning `undefined` leaves `messages` untouched.
  pi.on('context', (event, ctx) => {
    // (0) Injection gate — 00 §2 constraint 4 / 01 §3.3: inject ONLY on the first
    //     provider request of this trace (engine `turnIndex === 0`). The engine
    //     still calls this handler on every tool-loop continuation (and on
    //     `previewPrompt()`), but those carry `>= 1` / `-1` and must return
    //     `undefined`. Gate first = continuations cost nothing: no cache read, no
    //     string concat.
    if (!isFirstProviderRequest(currentTurnIndex)) return;
    // (1) Filter out any existing block of this customType. Mechanically
    //     unreachable (the context path never persists, S2), but asserted here:
    //     "exactly one per trace (first provider request)" stays a LOCAL
    //     invariant, not an assumption about engine behaviour.
    const kept = event.messages.filter(
      (m) => !(m.role === 'custom' && m.customType === WORLD_STATE_CUSTOM_TYPE)
    );

    // (2) Read this trace's cached block (sync, pure memory; sessionId from ctx).
    const text = readTurnBlock(ctx.sessionManager.getSessionId());
    if (text === null) return; // assembly failed / no slot → do not inject (00 §11)

    // (3) Append one custom message; never insert mid-list, never touch
    //     systemPrompt (00 §2 item 3, §12 item 4).
    return {
      messages: [
        ...kept,
        {
          role: 'custom' as const,
          customType: WORLD_STATE_CUSTOM_TYPE,
          content: [{ type: 'text' as const, text }],
          display: false, // never reaches the canvas (00 §2 item 3)
          timestamp: Date.now(), // CustomMessage requires it (`messages.ts:112`)
        },
      ],
    };
  });
}

// ——— local helpers (06 §2.4 note: these are NOT exports to import) ———

/**
 * The world theme rides at the end of the WRITER's state
 * block: rules flavour, dice convention, structure flags. A world without a
 * `theme` gets nothing appended, so every existing world keeps its block. Read
 * straight from world.json (no layer scan) and fail-soft: an unreadable
 * manifest only drops the theme lines, never the block.
 */
function withThemeBlock(block: string, worldRoot: string | null): string {
  if (!worldRoot) return block;
  try {
    const manifest = JSON.parse(fs.readFileSync(path.join(worldRoot, 'world.json'), 'utf8')) as { theme?: unknown; mysteries?: unknown; locale?: unknown };
    const theme = themeWriterBlock(manifest.theme, { mysteriesSeeded: Array.isArray(manifest.mysteries) && manifest.mysteries.length > 0 });
    // The 复盘 / debrief: the writer knows the
    // secrets exist — the questions, never the answers — so it doesn't spell them out.
    const parsedMysteries = Array.isArray(manifest.mysteries)
      ? manifest.mysteries.flatMap((m) => { const r = WorldMysterySchema.safeParse(m); return r.success ? [r.data] : []; })
      : [];
    const debrief = debriefWriterNote(parsedMysteries, typeof manifest.locale === 'string' ? manifest.locale : undefined);
    return [block, theme, debrief].filter(Boolean).join('\n\n');
  } catch {
    return block;
  }
}

/**
 * `[Character Sheets]`: the world's rule system
 * and the sheets a skill_check reads. `only === null` → the writer (protagonist
 * + every character with a sheet); a character id → that character's own sheet;
 * '' → nothing. A world without `rules` gets nothing appended. Fail-soft.
 */
function withSheetsBlock(block: string, worldRoot: string, only: string | null): string {
  if (only === '') return block;
  try {
    const manifest = JSON.parse(fs.readFileSync(path.join(worldRoot, 'world.json'), 'utf8')) as { characters?: Array<{ id?: unknown; name?: unknown }>; locale?: unknown };
    const rules = worldRulesOf(manifest);
    if (!rules) return block;
    const sheetOf = (rel: string) => {
      try {
        const fm = parseFrontmatter(fs.readFileSync(path.join(worldRoot, rel), 'utf8')).frontmatter ?? {};
        return parseSheet(fm, rules.system, manifest.locale).sheet;
      } catch {
        return null;
      }
    };
    const characters = (Array.isArray(manifest.characters) ? manifest.characters : []).flatMap((c) => {
      const id = typeof c?.id === 'string' ? c.id : '';
      if (!id || (only !== null && id !== only)) return [];
      const sheet = sheetOf(`characters/${id}/README.md`);
      return sheet ? [{ id, name: typeof c.name === 'string' ? c.name : id, sheet }] : [];
    });
    const player = only === null ? sheetOf('player/README.md') : null;
    if (!player && characters.length === 0) return block;
    const text = sheetsWriterBlock(rules, player, characters);
    return text ? `${block}\n\n${text}` : block;
  } catch {
    return block;
  }
}

/**
 * Keyword triggers: the INTENTS still able to fire
 * where the player is — never their consequences — so the writer can call
 * `trigger_keyword` when the player's words mean one. Plus the player's
 * declared states as prose (hidden hp as 「受了伤」, never a number). Fail-soft:
 * any error leaves the block as it was.
 */
async function withTriggerBlock(block: string, store: LocalWorldStore): Promise<string> {
  try {
    const parts = [block];
    const intents = keywordIntentsBlock(await activeKeywordIntents(store));
    if (intents) parts.push(intents);
    // Dice owed: a 大失败 / 大成功 the writer has
    // not paid yet, and what the engine applies when its turn ends without it.
    const owed = await owedConsequencesBlock({ store, actor: { type: 'writer' } } as never).catch(() => '');
    if (owed) parts.push(owed);
    if ((await store.statKind('player/README.md')) === 'file') {
      const states = mappedStates(parseFrontmatter(await store.readFile('player/README.md')).frontmatter);
      if (states.length > 0) {
        parts.push([
          '[The player\'s condition — tell it in prose, never as numbers]',
          ...states.map((s) => `- ${s.label}: ${s.text}`),
          'Injuries and such states change only through dice and world commands; describe them, never set them.',
        ].join('\n'));
      }
    }
    return parts.join('\n\n');
  } catch {
    return block;
  }
}

/**
 * A living world's clock and residents, read once
 * at the turn boundary. '' for every other world, so their blocks are unchanged.
 * Fail-soft: any error leaves the block as it was.
 */
async function withLivingBlock(block: string, store: LocalWorldStore, actor: { type: string; id?: string }): Promise<string> {
  try {
    const reader = actor.type === 'writer' ? { type: 'writer' as const } : actor.type === 'character' && actor.id ? { type: 'character' as const, id: actor.id } : null;
    if (!reader) return block;
    const living = await livingContextBlock(store, reader);
    return living ? `${block}\n\n${living}` : block;
  } catch {
    return block;
  }
}

/**
 * The current page's files in full, ahead of the state block.
 * Budgeted by `AIRP_WRITER_PAGES_BUDGET`, off with `AIRP_WRITER_PAGES=0`. Fail-soft:
 * no layer, no files or any error leaves the block as it was.
 */
async function withPagesBlock(block: string, store: LocalWorldStore, layer: string | null): Promise<string> {
  try {
    const opts = writerPagesOptionsFromEnv(process.env);
    if (!opts || !layer) return block;
    const pages = await collectWriterPages(store, layer, opts);
    return pages ? `${pages}\n\n${block}` : block;
  } catch {
    return block;
  }
}

let currentTurnIndex = -1; // module state: per-EXTENSION-FILE (00 §9 / 06 §3.1), NOT per-process; readable only here

let own: LocalWorldStore | null = null;
let ownRoot: string | null = null;

/**
 * This file's own lazily-opened store, used only when B1's cache is cold.
 *
 * `ctx.cwd` is the world root (launch.ts pins the process cwd there), matching
 * `toolkit/deps.ts:27-40`. A cwd switch reopens: the old root's connection would
 * silently write the wrong world.
 */
function ownStore(ctx: ExtensionContext): LocalWorldStore {
  const root = path.resolve(ctx.cwd);
  if (own && ownRoot !== root) {
    own.close();
    own = null;
  }
  if (!own) {
    ownRoot = root;
    own = new LocalWorldStore(root);
  }
  return own;
}

/**
 * `peekWorldStore() ?? ownStore(ctx)` (06 §5.4): reuse B1's connection when it
 * exists for THIS root, otherwise open our own. `peekWorldStore` is an
 * optimisation, never a correctness dependency — falling back to self-open is
 * always safe (worst case: 2 connections in the process, harmless under WAL).
 * The root check keeps a long-lived process that switched worlds from reading
 * the previous world through a stale peek.
 */
function worldStoreFor(ctx: ExtensionContext): LocalWorldStore {
  const peeked = peekWorldStore();
  // `worldRoot` is `path.resolve`d by the constructor; `ctx.cwd` may not be.
  if (peeked && peeked.worldRoot === path.resolve(ctx.cwd)) return peeked;
  return ownStore(ctx);
}
