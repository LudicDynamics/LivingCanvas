/**
 * Process-level dependencies for every tool shell.
 *
 * The two processes (server / agent) each build ONE WorldStore — the design notes
 * §1: "动作实现 MUST 以『传入一个 WorldStore』为形状，两个进程各自 new 一个".
 * Inside the agent process we still only want ONE store: a store per tool call
 * would open two SQLite connections per call.
 *
 * `worldRoot` comes from `ctx.cwd` (never `process.cwd()`): launch.ts pins the
 * spawned process cwd to the world root, and `ctx.cwd` is the API that keeps
 * being right if that ever changes.
 *
 * Shared code is imported by RELATIVE path (`../../packages/shared/dist/index.js`):
 * `extensions/` is outside the pnpm workspace, so `@airp/shared` does not resolve
 * here. A change under `packages/shared/src/` therefore
 * requires `pnpm --filter @airp/shared build` before it is visible.
 */
import { LocalWorldStore, createActionService, type ActionService } from '../../packages/shared/dist/index.js';
import type { ExtensionContext } from '@earendil-works/pi-coding-agent';
import { agentActor, resetActorForTests } from './actor.js';
import { currentTurnAnchor } from './turn.js';

let store: LocalWorldStore | null = null;
let storeRoot: string | null = null;

/** Lazily open (once) the store for the given world root. */
export function worldStore(ctx: ExtensionContext): LocalWorldStore {
  const root = ctx.cwd;
  if (store && storeRoot !== root) {
    // A session can switch cwd (world switch in a long-lived process). Reopening
    // is correct here: the old root's connection would silently write the wrong world.
    store.close();
    store = null;
  }
  if (!store) {
    storeRoot = root;
    store = new LocalWorldStore(root);
  }
  return store;
}

/**
 * Read-only peek at the cached store: the store B1 already opened for THIS
 * module instance, or null. NEVER constructs one (06 §5.4).
 *
 * `extensions/context.ts` uses `peekWorldStore() ?? <its own store>` so that,
 * when the loader's jiti cache does happen to be shared, the process keeps ONE
 * SQLite connection. It is an optimisation, not a correctness dependency: a
 * cold cache returns null and the caller opens its own (worst case two
 * connections, harmless under WAL). The caller MUST check `worldRoot` before
 * reusing the result — a long-lived process can switch worlds.
 */
export function peekWorldStore(): LocalWorldStore | null {
  return store;
}

/**
 * The caller's current layer, or null when nothing reports it.
 *
 * Reads the `viewpoint` row through the store method (B2 / 05 §2.6) — the same
 * source `look_at`'s default chain uses, and no longer a second copy of the
 * `sqlite_master` probe. No row / empty / expired → null, so the `chalk` shell
 * then requires an explicit `path` instead of inventing a layer (the design notes
 * §12 item 1: guessing would put the file in the wrong scene). Note the `??`
 * nuance: an EMPTY layer string maps to null, not to a falsy passthrough.
 */
export function currentLayer(ctx: ExtensionContext): string | null {
  const layer = worldStore(ctx).readViewpoint()?.layer;
  return layer === undefined || layer === '' ? null : layer;
}

// Agent identity lives in ./actor.ts: the
// role env is read once per process, and only one module should own that cache.
export { agentActor };

/** The bound action service for this tool call. One instance per call: it carries the turn anchor. */
export function getActionService(ctx: ExtensionContext): ActionService {
  return createActionService(worldStore(ctx), agentActor(), { turn: currentTurnAnchor(ctx) });
}

/** Test seam — the probe / unit tests reset the cached store and actor. */
export function resetDepsForTests(): void {
  store?.close();
  store = null;
  storeRoot = null;
  resetActorForTests();
}
