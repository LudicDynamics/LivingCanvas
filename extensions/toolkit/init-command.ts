/**
 * `airp-init` — the initialization execution kernel.
 *
 * Architecture: pi-rp's subagents are IN-PROCESS —
 * `ctx.spawnAgent` exists only on the agent process's extension context, never on
 * the server. So the server triggers initialization by sending the RPC command
 * `/airp-init <json>` into this process, and this handler does the work here. The
 * path reuses this process's extensions and skills, so R2's environment matches
 * R1's (the writer's `subagent` tool) exactly, as doc-11 §2.4 requires.
 *
 * The command is the ONE kernel: parse → short-circuit when already filled →
 * resolve context → build brief → spawn the initializer profile → record the
 * outcome. R1 never runs this code (the writer delegates directly and shares the
 * same preset); only the brief *builder* is shared, and it lives in
 * `packages/shared/src/render/brief.ts`.
 *
 * Registration lives in `extensions/tools.ts` (same `initialize` as the tools),
 * so presets and command share one entry point.
 */
import {
  buildNookInitBrief,
  buildSceneInitBrief,
  dirOfLayer,
  hasInitProduct,
  isLayerEmpty,
  isNookEmpty,
  nookIdOf,
  parseFrontmatter,
  w2SceneTemplate,
  type LocalWorldStore,
  type WorldManifest,
} from '../../packages/shared/dist/index.js';
import type { ExtensionAPI, ExtensionContext } from '@earendil-works/pi-coding-agent';
import type { ActivityTurnContext } from './activity-relay.js';
import { AIRP_TOOLS } from '../tools.js';
import { getActionService, worldStore } from './deps.js';

export const INIT_COMMAND = 'airp-init';

/** doc-11 §6.2: a scene may take longer than a nook. Command constants for now. */
const TIMEOUT_MS = { scene: 60_000, nook: 45_000 } as const;

/** The command's single positional argument, JSON-encoded. */
export interface InitArgs {
  kind: 'scene' | 'nook';
  target: string;
  request?: string;
  by: 'player' | 'engine';
  /** Zero-AI path: land the W2 template without spawning. */
  template?: boolean;
}

/**
 * In-flight guard. pi-rp runs extension commands
 * immediately even mid-stream and does NOT serialize prompts, so a double-click
 * can put two `/airp-init` calls in flight; the emptiness short-circuit only
 * covers the sequential case. One process, one Set — no cross-process lock needed.
 */
const inFlight = new Set<string>();

/** Test seam (probe / unit tests). */
export function resetInFlightForTests(): void {
  inFlight.clear();
}

export function parseInitArgs(raw: string): InitArgs {
  const parsed: unknown = JSON.parse(raw);
  if (typeof parsed !== 'object' || parsed === null) throw new Error('args must be a JSON object');
  const o = parsed as Record<string, unknown>;
  if (o.kind !== 'scene' && o.kind !== 'nook') throw new Error("kind must be 'scene' or 'nook'");
  if (typeof o.target !== 'string' || o.target === '') throw new Error('target must be a non-empty string');
  if (o.by !== 'player' && o.by !== 'engine') throw new Error("by must be 'player' or 'engine'");
  if (o.request !== undefined && typeof o.request !== 'string') throw new Error('request must be a string');
  if (o.template !== undefined && typeof o.template !== 'boolean') throw new Error('template must be a boolean');
  return {
    kind: o.kind,
    target: o.target,
    by: o.by,
    ...(o.request !== undefined ? { request: o.request } : {}),
    ...(o.template !== undefined ? { template: o.template } : {}),
  };
}

/**
 * Files referenced by a character preset's file slots that are not on disk yet
 *. Reads `items[].{slot:'file'}.options.path` — the real
 * preset shape (`templates/holmes-world/characters/watson/preset.json:47`).
 */
async function missingFilesFor(store: LocalWorldStore, nookDir: string): Promise<string[]> {
  let preset: { items?: Array<{ kind?: string; slot?: string; options?: { path?: unknown } }> };
  try {
    preset = JSON.parse(await store.readFile(`${nookDir}/preset.json`));
  } catch {
    return [];
  }
  const declared: string[] = [];
  for (const item of Array.isArray(preset.items) ? preset.items : []) {
    if (item?.kind !== 'slot' || item?.slot !== 'file') continue;
    const paths = item.options?.path;
    for (const p of Array.isArray(paths) ? paths : []) {
      if (typeof p === 'string') declared.push(p);
    }
  }
  if (declared.length === 0) return [];
  const present = new Set((await store.listFiles(nookDir)).map((f) => f.slice(nookDir.length + 1)));
  return [...new Set(declared)].filter((name) => !present.has(name));
}

/** README frontmatter `name`, falling back to the character id. */
async function displayNameFor(store: LocalWorldStore, nookDir: string, characterId: string): Promise<string> {
  try {
    const name = parseFrontmatter(await store.readFile(`${nookDir}/README.md`)).frontmatter?.name;
    return typeof name === 'string' && name !== '' ? name : characterId;
  } catch {
    return characterId;
  }
}

/** Parent layer name/path from the derived manifest. */
function parentLayerOf(
  manifest: WorldManifest,
  layer: string
): { parentLayerName?: string; parentLayerPath?: string } | null {
  const parent = manifest.layers?.[layer]?.parent ?? null;
  if (!parent) return null;
  const name = manifest.layers?.[parent]?.name;
  return {
    ...(typeof name === 'string' ? { parentLayerName: name } : {}),
    parentLayerPath: dirOfLayer(parent),
  };
}

/** Write the W2 template files (scene only — a nook failure writes nothing). */
async function writeW2Scene(store: LocalWorldStore, dir: string, dirName: string): Promise<string[]> {
  const files = w2SceneTemplate(dirName);
  const written: string[] = [];
  for (const [name, body] of Object.entries(files)) {
    await store.writeFile(`${dir}/${name}`, body);
    written.push(`${dir}/${name}`);
  }
  return written;
}

async function nookBrief(
  store: LocalWorldStore,
  manifest: WorldManifest,
  characterId: string,
  dir: string
): Promise<string> {
  const entry = manifest.characters.find((c) => c.id === characterId);
  const displayName = await displayNameFor(store, dir, characterId);
  const missingFiles = await missingFilesFor(store, dir);
  return buildNookInitBrief({
    characterId,
    displayName,
    manifest,
    ...(entry?.description ? { roleDesc: entry.description } : {}),
    ...(entry?.home ? { home: entry.home } : {}),
    ...(entry?.role ? { role: entry.role } : {}),
    ...(missingFiles.length > 0 ? { missingFiles } : {}),
  });
}

function report(args: InitArgs, outcome: string): string {
  return `[airp-init] ${args.kind} "${args.target}" (by ${args.by}): ${outcome}`;
}

export function registerInitCommand(pi: ExtensionAPI): void {
  pi.registerCommand(INIT_COMMAND, {
    description: 'Instantiate a stub scene layer or an empty character nook (docs/init).',
    handler: async (rawArgs: string, ctx) => {
      // The result line goes to the session log only (display:false) so the
      // player's canvas is never touched by bookkeeping.
      const emit = (text: string) =>
        pi.sendMessage({ customType: 'airp_init', content: text, display: false }, { triggerTurn: false });

      let args: InitArgs;
      try {
        args = parseInitArgs(rawArgs);
      } catch (err) {
        emit(`[airp-init] invalid args: ${msg(err)}`);
        return;
      }

      const ext = ctx as unknown as ExtensionContext;
      const store = worldStore(ext);
      const isScene = args.kind === 'scene';
      const dir = isScene ? dirOfLayer(args.target) : nookIdOf(args.target);
      if (dir === null) {
        emit(report(args, 'invalid character id'));
        return;
      }
      // `layer` is the event/`FileRecord` key: a scene's id (world/… or map), or
      // the nook id (`characters/<id>`) — the two id domains `local-store` uses
      //.
      const layer = isScene ? args.target : dir;
      const activityContext: ActivityTurnContext = {
        source: 'functional',
        agentId: isScene ? 'scene-init' : 'nook-init',
        turnId: `functional:${crypto.randomUUID()}`,
      };
      // Root activity self-reporting goes through the engine's transient
      // agent_activity channel (events only — nothing lands in the session
      // tree). The spawned child's tool activity is forwarded by the engine
      // itself (spawnAgent activityTurnId binds it to this same turn).
      const sendRootStart = () =>
        pi.emitActivity({
          origin: 'command',
          agentId: activityContext.agentId,
          turnId: activityContext.turnId,
          toolCallId: 'initialize',
          toolName: INIT_COMMAND,
          phase: 'start',
          args: { target: args.target },
        });
      const sendRootTerminal = (isError: boolean, errorKind?: 'tool_error' | 'timeout' | 'cancelled') =>
        pi.emitActivity({
          origin: 'command',
          agentId: activityContext.agentId,
          turnId: activityContext.turnId,
          toolCallId: 'initialize',
          toolName: INIT_COMMAND,
          phase: 'end',
          details: { target: args.target },
          isError,
          ...(errorKind ? { errorKind } : {}),
        });

      // A syntactically valid, addressable request gets an initialize capsule.
      // Invalid JSON/kind/target and invalid nook ids return before this point.
      sendRootStart();

      // (1) Emptiness short-circuit — the sequential idempotency source.
      let files: string[];
      let dirs: string[];
      try {
        files = await store.listFiles();
        // Same source as the nook scene tree (N2 00 §5.3): `listDirs` is a
        // DIRECTORY walk, so empty rooms still show up. A `listFiles` walk would
        // lose them and re-furnish an already-decorated nook (N2 00 §5.4).
        dirs = await store.listDirs(dir);
      } catch {
        sendRootTerminal(true, 'tool_error');
        emit(report(args, 'failed (store unavailable)'));
        return;
      }
      const empty = isScene ? isLayerEmpty(files, dir) : isNookEmpty(files, dir, dirs);
      if (!empty) {
        sendRootTerminal(false);
        emit(report(args, 'already initialized (no action)'));
        return;
      }

      // (2) Concurrency guard — the parallel idempotency source.
      const key = `${args.kind}:${args.target}`;
      if (inFlight.has(key)) {
        sendRootTerminal(true, 'cancelled');
        emit(report(args, 'initialization already in flight'));
        return;
      }
      inFlight.add(key);

      let terminalSent = false;
      const finish = (isError: boolean, errorKind?: 'tool_error' | 'timeout' | 'cancelled') => {
        if (terminalSent) return;
        terminalSent = true;
        sendRootTerminal(isError, errorKind);
      };

      try {
        const svc = getActionService(ext);

        // (3) Zero-AI path: land the template, never spawn.
        if (args.template === true && isScene) {
          const dirName = dir.split('/').pop() ?? layer;
          const written = await writeW2Scene(store, dir, dirName);
          const res = await svc.recordLayerInitialized({ layer, by: 'engine', files: written });
          finish(false);
          emit(report(args, `template placed — ${res.text}`));
          return;
        }

        // (4) Build the brief (shared module — the design notes).
        const manifest = await store.getManifest();
        const brief = isScene
          ? buildSceneInitBrief({
              layerId: layer,
              targetPath: dir,
              manifest,
              ...(parentLayerOf(manifest, layer) ?? {}),
              ...(args.request ? { userPrompt: args.request } : {}),
            })
          : await nookBrief(store, manifest, args.target, dir);

        // (5) Spawn the initializer in-process. `customTools` is required:
        //     spawnAgent does not inherit the parent's extension tools (spawn.ts:97).
        //
        // The spawned agent writes via the NATIVE `write` tool, which
        // `extensions/world-context.ts` turns into a `layer_initialized`
        // fallback — but this command OWNS that event and records it below.
        let result: { status: string; text?: string; error?: string };
        const previousScope = process.env.AIRP_AGENT_SCOPE;
        try {
          process.env.AIRP_AGENT_SCOPE = 'initializer';
          process.env.AIRP_INIT_IN_FLIGHT = '1';
          result = await ctx.spawnAgent({
            profileId: isScene ? 'scene-init' : 'nook-init',
            task: brief,
            customTools: AIRP_TOOLS.filter((t) => t.name !== 'create_char').map((t) => t.tool),
            timeoutMs: TIMEOUT_MS[args.kind],
            // Child tool activity is forwarded by the engine (transient
            // agent_activity events); binding it to this command's turn id
            // lets the server's projector fail-close root + child together.
            activityTurnId: activityContext.turnId,
          });
        } catch (err) {
          result = { status: 'failed', error: msg(err) };
        } finally {
          delete process.env.AIRP_INIT_IN_FLIGHT;
          if (previousScope === undefined) delete process.env.AIRP_AGENT_SCOPE;
          else process.env.AIRP_AGENT_SCOPE = previousScope;
        }

        // (6) Split: success needs BOTH 'completed' AND a product on disk.
        const after = await store.listFiles();
        if (result.status === 'completed' && hasInitProduct(after, dir, args.kind, dirs)) {
          const produced = after.filter((f) => f.startsWith(`${dir}/`));
          const res = await svc.recordLayerInitialized({ layer, by: args.by, files: produced });
          finish(false);
          emit(report(args, `done — ${res.text}`));
          return;
        }

        const reason = result.status === 'completed' ? 'no product written' : result.status;
        const errorKind =
          result.status === 'timed-out' ? 'timeout' : result.status === 'cancelled' ? 'cancelled' : 'tool_error';
        if (isScene) {
          const dirName = dir.split('/').pop() ?? layer;
          await writeW2Scene(store, dir, dirName);
          await svc.recordLayerInitFailed({ layer, reason, fallback: 'template' });
          finish(true, errorKind);
          emit(report(args, `failed (${reason}); scene fell back to template`));
        } else {
          // A nook that stays empty is a normal state — do not invent content.
          await svc.recordLayerInitFailed({ layer, reason, fallback: 'none' });
          finish(true, errorKind);
          emit(report(args, `failed (${reason}); nook left empty`));
        }
      } finally {
        inFlight.delete(key);
        // Covers store/action failures that bypass the normal result split.
        finish(true, 'tool_error');
      }
    },
  });
}

function msg(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
