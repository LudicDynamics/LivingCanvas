/**
 * AIRP world-context: the native write/edit gate and the write receipts.
 *
 * `the design notes` §3 is the spec for everything below —
 * steps 1-7 are marked inline. The three validators this hook CALLS
 * (`parseWorldCommand`, `parseOnBindings`, `classifyWorldWritePath`) are pure,
 * synchronous and I/O-free; the only I/O added by `07` is §3.3 step 5e's
 * `statKind` + `readFile` on the command a binding points at.
 *
 * A rejection happens BEFORE the tool runs, so "拒绝一次写入 = 世界零改动"
 * (§4.2) — that is why every `block.reason` starts by saying so (§2.3 R1).
 */
import path from 'node:path';
import type { ExtensionAPI } from '@earendil-works/pi-coding-agent';
import {
  assertNookMutationAllowed,
  parseFrontmatter,
  parseOnBindings,
  parseWorldCommand,
  COMMAND_TRIGGER_HOOKS,
  MAX_ARRAY_OPTIONS,
  MAX_ARRAY_REWARDS,
  type Actor,
  type AgentScope,
  type WorldCommandDiagnostic,
  type WorldCommandSpec,
} from '../packages/shared/dist/index.js';
// `packages/shared/src/index.ts` is a hand-written barrel (07 §8.2 adds the
// `paths.js` line). Imported by subpath so this hook does not depend on that
// line landing in the same commit.
import {
  classifyWorldWritePath,
  writeGateReason,
  COMMAND_FILE_SOFT_HINT_CHARS,
  MAX_REASON_CHARS,
  MAX_REASON_DIAGNOSTICS,
} from '../packages/shared/dist/commands/paths.js';
// Same subpath trick as above: do not depend on M3's barrel line landing in this
// commit (see the comment on the block above).
import { isHtmlPath } from '../packages/shared/dist/rules/html-head.js';
import { isNpcFrontmatter, npcCardErrors } from '../packages/shared/dist/rules/npc.js';
import { agentActor, worldStore } from './toolkit/deps.js';
import { currentTurnAnchor } from './toolkit/turn.js';

type TrackedWrite =
  | { file: string; existed: boolean; kind: 'entity' | 'html' }
  | { file: string; existed: boolean; kind: 'command'; id: string };

/** Agent scope from env — `[C-3]`'s identity check reads it. */
function scopeFromEnvironment(actor: Actor): AgentScope {
  const raw = process.env.AIRP_AGENT_SCOPE;
  if (raw === 'character' || raw === 'initializer' || raw === 'player' || raw === 'engine') return raw;
  if (raw === 'writer-top-level') return raw;
  return actor.type === 'character' ? 'character' : actor.type === 'player' ? 'player' : 'writer-top-level';
}

/**
 * @deprecated `07` §11.1 — the `newText` / `text` branches are unreachable for
 * `edit` (`prepareEditArguments` normalises to `edits[]` first), which is why
 * `mergedEditText`'s `oldText`/`newText` branch can never run. The ENTITY
 * branch still uses this pair (§4.1: replacing it there is out of scope); the
 * command branch and the `on` validation use `proposedFileText` instead.
 */
function inputText(input: Record<string, unknown>): string | undefined {
  if (typeof input.content === 'string') return input.content;
  if (typeof input.newText === 'string') return input.newText;
  if (typeof input.text === 'string') return input.text;
  return undefined;
}

/** @deprecated see `inputText`. */
function mergedEditText(previous: string, input: Record<string, unknown>): string | undefined {
  const direct = inputText(input);
  if (direct !== undefined) return direct;
  if (typeof input.oldText === 'string' && typeof input.newText === 'string') {
    return previous.replace(input.oldText, input.newText);
  }
  if (Array.isArray(input.edits)) {
    let result = previous;
    for (const edit of input.edits) {
      if (!edit || typeof edit !== 'object') return undefined;
      const item = edit as Record<string, unknown>;
      if (typeof item.oldText !== 'string' || typeof item.newText !== 'string') return undefined;
      result = result.replace(item.oldText, item.newText);
    }
    return result;
  }
  return undefined;
}

/**
 * §4.1 — the text this call WILL produce, for the command branch and the `on`
 * validation only. Recognises exactly the two shapes the hook receives:
 *
 * - `write`: `input.content`, the single source.
 * - `edit`: `input.edits[]` applied to `previous` with `String.replace`.
 *
 * Anything else → `undefined`, and the caller MUST treat that as "cannot
 * predict" and refuse. A prediction is not a fact: pi-rp's `edit` also does
 * NFKC / `trimEnd` / smart-quote normalisation, fuzzy matching and
 * duplicate/overlap errors (`edit-diff.ts:33-45,206-233,332-334,350-356`), so
 * the on-disk result is re-verified in `tool_result` (§3.4 T2).
 */
function proposedFileText(
  previous: string,
  toolName: 'write' | 'edit',
  input: Record<string, unknown>
): string | undefined {
  if (toolName === 'write') return typeof input.content === 'string' ? input.content : undefined;
  if (!Array.isArray(input.edits)) return undefined;
  let result = previous;
  for (const edit of input.edits) {
    if (!edit || typeof edit !== 'object') return undefined;
    const item = edit as Record<string, unknown>;
    if (typeof item.oldText !== 'string' || typeof item.newText !== 'string') return undefined;
    result = result.replace(item.oldText, item.newText);
  }
  return result;
}

function isPhotoContent(raw: string): boolean {
  const { frontmatter } = parseFrontmatter(raw);
  return frontmatter?.component === 'photo';
}

/* ── §2.3: assembling `block.reason` ─────────────────────────────────────── */

/**
 * One rendered diagnostic. `line`/`column` come from `01`'s struct when its
 * CST could position the problem; `path` (e.g. `do[0].action`) is the
 * structural fallback for the schema-level codes, which `01` reports without a
 * position (`07` §2.3 R2 wants a line whenever one exists — the gap is
 * registered against `01` in the report rather than papered over with a GUESSED
 * line number, which would send the model to the wrong line).
 */
type ReasonDiagnostic = { line?: number; column?: number; path?: string; message: string };

function diagnosticLine(diagnostic: ReasonDiagnostic): string {
  // `01` already prefixes `line N, column M:` on the messages it could position;
  // prefixing again would say it twice.
  if (/^line \d+/.test(diagnostic.message)) return diagnostic.message;
  if (diagnostic.line !== undefined) {
    return `line ${diagnostic.line}, column ${diagnostic.column ?? 1}: ${diagnostic.message}`;
  }
  return diagnostic.path === undefined ? diagnostic.message : `at ${diagnostic.path}: ${diagnostic.message}`;
}

/**
 * §2.3's grammar: R1 (line 1 asserts nothing was written) → diagnostics (R2
 * positions, sorted by line, R3 cut at `MAX_REASON_DIAGNOSTICS`) → R4 (an
 * imperative naming the next action). `MAX_REASON_CHARS` is the backstop for
 * ONE oversized diagnostic (`01`'s `unknown_action` prints the whole effect
 * list); whichever limit hits first wins (§2.4).
 */
function blockReason(headline: string, diagnostics: ReasonDiagnostic[], recovery: string): string {
  const sorted = [...diagnostics].sort(
    (a, b) => (a.line ?? Number.MAX_SAFE_INTEGER) - (b.line ?? Number.MAX_SAFE_INTEGER)
  );
  const shown = sorted.slice(0, MAX_REASON_DIAGNOSTICS).map(diagnosticLine);
  const omitted = sorted.length - shown.length;
  const body = [...shown];
  if (omitted > 0) {
    body.push(`...and ${omitted} more problem${omitted === 1 ? '' : 's'} (showing the first ${MAX_REASON_DIAGNOSTICS}).`);
  }
  if (headline.length + body.join('\n').length + recovery.length + 4 > MAX_REASON_CHARS) {
    const kept: string[] = [];
    let used = headline.length;
    for (const line of body) {
      if (used + line.length + 1 > MAX_REASON_CHARS - recovery.length - 40) break;
      kept.push(line);
      used += line.length + 1;
    }
    kept.push(`...truncated to fit ${MAX_REASON_CHARS} characters.`);
    return [headline, '', ...kept, '', recovery].join('\n');
  }
  return [headline, '', ...body, '', recovery].join('\n');
}

/** §3.2 step 4b — a command file that does not parse never reaches the disk. */
function commandRejection(id: string, errors: WorldCommandDiagnostic[]): string {
  const file = `command/${id}.yaml`;
  return blockReason(
    `${file} was NOT written. Nothing was changed on disk. ${errors.length} problem${errors.length === 1 ? '' : 's'}.`,
    errors,
    'Fix these lines and call write again with the whole file.'
  );
}

/** §3.3 steps 5d/5e — an entity whose `on` is wrong is refused whole. */
function bindingRejection(file: string, errors: ReasonDiagnostic[]): string {
  return blockReason(
    `${file} was NOT written. Nothing was changed on disk. ${errors.length} problem${errors.length === 1 ? '' : 's'}.`,
    errors,
    'Fix the binding and call edit again. A binding names a command file that must exist and parse.'
  );
}

/** §3.2 step 4a — an `edit` on a command file whose end state we cannot predict. */
function commandEditUnmergeable(): string {
  return [
    'Cannot predict the result of this edit on a world command, so it was not applied. Nothing was changed on disk.',
    '',
    'Send the whole file with write instead: command files are small (a typical one is 10-30 lines) and the limit is 32000 bytes.',
  ].join('\n');
}

/** §3.5 step 7b — one line that says "written" and "how to use it" together. */
function writeReceipt(id: string, spec: WorldCommandSpec, bytes: number): string {
  const params = Object.keys(spec.params).length;
  const first =
    `Wrote command/${id}.yaml: ${spec.steps.length} step${spec.steps.length === 1 ? '' : 's'}, ` +
    `${params} param${params === 1 ? '' : 's'}. ` +
    `Entities can bind it with on.<hook>[].run: ${id}.`;
  if (bytes <= COMMAND_FILE_SOFT_HINT_CHARS) return first;
  return `${first}\nThis command is ${bytes} bytes. If it keeps growing, split it into smaller parts and declare them as separate entries under "on".`;
}


/* ── §3.3 steps 5d / 5e: the entity-side validators ──────────────────────── */

/** Entry-side array bounds: `09`'s static-upper-bound argument rests on these (§7.6). */
const ARRAY_BOUNDS: Record<string, number> = { rewards: MAX_ARRAY_REWARDS, options: MAX_ARRAY_OPTIONS };

/** Every `on.<hook>[i].run` declared on an entity, with its index and hook. */
function declaredRuns(frontmatter: Record<string, any>): { hook: string; index: number; run: string }[] {
  const on = frontmatter['on'];
  if (!on || typeof on !== 'object' || Array.isArray(on)) return [];
  const runs: { hook: string; index: number; run: string }[] = [];
  for (const hook of COMMAND_TRIGGER_HOOKS) {
    const group = (on as Record<string, unknown>)[hook];
    if (!Array.isArray(group)) continue;
    group.forEach((entry, index) => {
      if (!entry || typeof entry !== 'object') return;
      const run = (entry as Record<string, unknown>)['run'];
      if (typeof run === 'string') runs.push({ hook, index, run });
    });
  }
  return runs;
}

/**
 * §3.3 step 5d (cross-field `from`, incl. the array-length ceiling) and step 5e
 * (`run:` must point at a command file that exists AND parses).
 *
 * 5d's shape and `from` checks are `parseOnBindings`' job and it implements
 * them; the length ceiling of §7.6 item 3 is checked here because
 * `packages/shared/src/commands/bindings.ts` does not implement it and `07`
 * owns wiring it into the write gate (§7.6's table lists it under 5d).
 *
 * Returns the reason to block, or `null` when the entity is acceptable.
 */
async function onBindingRejection(
  file: string,
  frontmatter: Record<string, any> | null,
  store: { statKind: (p: string) => Promise<'file' | 'dir' | 'missing'>; readFile: (p: string) => Promise<string> }
): Promise<string | null> {
  if (!frontmatter || frontmatter['on'] === undefined) return null;

  const parsed = parseOnBindings(frontmatter, null);
  if (parsed.errors.length > 0) return bindingRejection(file, parsed.errors);

  // §7.6 item 3: the array bound is what keeps ONE roll from producing an
  // unbounded number of changes. Checked on the `from`-named array itself and
  // on every bounded array nested in its entries (`07` §7.3 sample 4 is the
  // nested form: `dice_outcomes[1].rewards` with 5 items). This lives here
  // because `bindings.ts` does not implement it and §7.6 assigns the wiring to
  // `07`; the bound VALUES come from `01`, never re-declared.
  const violations: ReasonDiagnostic[] = [];
  for (const { hook, index } of declaredRuns(frontmatter)) {
    const entry = (frontmatter['on'] as Record<string, unknown>)[hook] as Record<string, unknown>[];
    const from = (entry[index] as Record<string, unknown>)['from'];
    if (typeof from !== 'string') continue;
    const list = frontmatter[from];
    if (!Array.isArray(list)) continue;
    const outer = ARRAY_BOUNDS[from];
    if (outer !== undefined && list.length > outer) {
      violations.push({
        message: `Binding ${index} takes its entries from "${from}", which has ${list.length}. The limit is ${outer}.`,
      });
    }
    list.forEach((item, itemIndex) => {
      if (!item || typeof item !== 'object' || Array.isArray(item)) return;
      for (const [key, value] of Object.entries(item as Record<string, unknown>)) {
        const inner = ARRAY_BOUNDS[key];
        if (inner === undefined || !Array.isArray(value) || value.length <= inner) continue;
        violations.push({
          message:
            `Binding ${index} takes its entries from "${from}", and entry ${itemIndex} has ` +
            `${value.length} ${key}. The limit is ${inner}. Split the extra ${key} into a second entry, or drop them.`,
        });
      }
    });
  }
  if (violations.length > 0) return bindingRejection(file, violations);

  // §3.3 step 5e: existence AND parseability. Existence alone would pass a file
  // `bash` wrote badly — exactly the product of §3.8's bypass — so a file that
  // IS there but does not parse is refused too. This is `07`'s only new I/O.
  //
  // Binding index is 0-based, matching `02`'s `on_bad_*` messages so one
  // offending binding is not called "0" by one validator and "1" by the other.
  const notFound: string[] = [];
  const unparseable: { run: string; detail: string }[] = [];
  for (const { index, run } of declaredRuns(frontmatter)) {
    const commandPath = `command/${run}.yaml`;
    if ((await store.statKind(commandPath)) === 'missing') {
      notFound.push(`Binding ${index} runs "${run}", but ${commandPath} does not exist.`);
      continue;
    }
    const result = parseWorldCommand(run, await store.readFile(commandPath));
    if (!result.ok) {
      unparseable.push({ run, detail: result.errors.map(diagnosticLine).join('\n  ') });
    }
  }
  const headline = `${file} was NOT written. Nothing was changed on disk.`;
  if (unparseable.length > 0) {
    const first = unparseable[0] as { run: string; detail: string };
    return blockReason(
      headline,
      unparseable.map(({ run, detail }) => ({ message: `Binding runs "${run}", but that command file does not parse:\n  ${detail}` })),
      `Fix command/${first.run}.yaml first - binding it now would only move the failure to the moment a player rolls.`
    );
  }
  if (notFound.length > 0) {
    return blockReason(
      headline,
      notFound.map((message) => ({ message })),
      'Create the command file first, then bind it.'
    );
  }
  return null;
}

/**
 * An NPC card (`type: npc`, the design notes) must be one the engine can
 * talk to: the shape `npcCardErrors` checks, plus an `avatar` that exists. A
 * `knows` card may be written after the NPC, so its existence is not required
 * here (the brief simply omits a card that is not there).
 */
async function npcWriteRejection(
  file: string,
  frontmatter: Record<string, unknown> | null | undefined,
  store: { statKind(path: string): Promise<string> },
): Promise<string | null> {
  if (!isNpcFrontmatter(frontmatter)) return null;
  const problems = npcCardErrors(frontmatter);
  if (!file.startsWith('world/')) problems.push('an NPC card lives under world/ (a place the player can stand in)');
  const avatar = (frontmatter as { avatar?: unknown }).avatar;
  if (typeof avatar === 'string' && problems.length === 0 && (await store.statKind(avatar)) !== 'file') {
    problems.push(`avatar ${avatar} does not exist; omit avatar until the picture exists`);
  }
  if (problems.length === 0) return null;
  return blockReason(
    `${file} was NOT written. Nothing was changed on disk.`,
    problems.map((message) => ({ message: `NPC card: ${message}` })),
    'Fix the card to the NPC schema (skills/world-workshop/references/npc.md): name, persona (1–3 lines), knows (world/… or player/… .md paths), optional wants/fears/voice/gender/avatar, and gives naming options this card declares in choice + choice_actions.',
  );
}

/** Native file tools need their own receipt; AIRP tools already append theirs. */
export default function registerWorldContext(pi: ExtensionAPI): void {
  const writes = new Map<string, TrackedWrite>();
  pi.on('tool_call', async (event, ctx) => {
    // §3.1 step 1 — tool filter (unchanged).
    if (event.toolName !== 'write' && event.toolName !== 'edit') return;
    // §3.1 step 2 — path normalisation (unchanged).
    if (typeof event.input.path !== 'string') return;
    const input = event.input as Record<string, unknown>;
    const file = path.relative(ctx.cwd, path.resolve(ctx.cwd, event.input.path)).split(path.sep).join('/');

    // §3.1 step 3 — classify. Contract §6.2: `command/` admits `.yaml` only,
    // the three content roots `.md` only. Before this, `command/x.yaml` failed
    // both dimensions and the Agent's command success rate was 0 (§3.7).
    const target = classifyWorldWritePath(file);
    if (target.kind === 'rejected') {
      return { block: true, reason: writeGateReason(target.code, file) };
    }

    const store = worldStore(ctx);
    const actor = agentActor();
    const agentScope = scopeFromEnvironment(actor);

    // §3.2 step 4 — the command branch, BEFORE the entity branch. The entity
    // branch's `isPhotoContent` runs `parseFrontmatter`, whose `FM_BLOCK` regex
    // matches from byte 0, so a command YAML starting with `---` would be read
    // as a frontmatter block. Front-loading the branch makes that impossible.
    if (target.kind === 'command') {
      // §12.2 [C-3] = A (frozen): a world command is the world's RULES, and a
      // character is a person in the world. Landed here, after classification,
      // so `classifyWorldWritePath` stays a pure path function.
      if (agentScope !== 'writer-top-level' && agentScope !== 'initializer') {
        return {
          block: true,
          reason:
            'World commands are the world\'s rules; only the Writer writes them. Describe the consequence in your own turn instead, or leave a note the Writer will read.',
        };
      }
      let existed = true;
      // §7.7's last row: a validator that throws MUST NOT kill the write path —
      // "校验器把写入全拒了" is worse than missing one bad command.
      try {
        existed = (await store.statKind(file)) !== 'missing';
        const previous = existed ? await store.readFile(file) : '';
        const proposed = proposedFileText(previous, event.toolName as 'write' | 'edit', input);
        if (proposed === undefined) return { block: true, reason: commandEditUnmergeable() };
        const result = parseWorldCommand(target.id, proposed);
        if (!result.ok) return { block: true, reason: commandRejection(target.id, result.errors) };
      } catch (err) {
        console.warn(`[world-context] command validation failed open for ${file}:`, err);
      }
      writes.set(event.toolCallId, { file, existed, kind: 'command', id: target.id });
      return;
    }

    // §3.3 step 5 — the entity branch.
    const registered = (await store.getManifest()).characters.map((character) => character.id);
    try {
      // 5a — the nook permission gate (unchanged).
      assertNookMutationAllowed(actor, agentScope, file, event.toolName === 'write' ? 'write' : 'edit', registered);
    } catch (err) {
      const reason = err instanceof Error ? err.message : String(err);
      return { block: true, reason };
    }
    const existed = (await store.statKind(file)) !== 'missing';
    const previous = existed ? await store.readFile(file) : '';
    // 5b — the entity branch keeps the legacy helpers (§4.1, see their @deprecated).
    const proposed = event.toolName === 'write' ? inputText(input) : mergedEditText(previous, input);
    // 5c — the photo gate (unchanged) plus the `.html` short-circuit (the design notes
    // §6.7): a page card is never a `component: photo`, and `FM_BLOCK` matches
    // from byte 0, so an `.html` that *starts* with `---\ncomponent: photo\n---`
    // would otherwise be rejected with a reason pointing at a nonexistent action.
    if (
      !isHtmlPath(file) &&
      ((proposed !== undefined && isPhotoContent(proposed)) ||
        (event.toolName === 'edit' && proposed === undefined && isPhotoContent(previous)))
    ) {
      return { block: true, reason: 'invalid_argument: native write/edit cannot create or edit component: photo; use a supported photo action.' };
    }
    try {
      // 5d + 5e — `on` shape, cross-field `from`, its length ceiling, and `run`
      // existence + parseability. Contract §10.8: `on` is NOT protected by the
      // command files' strict schema, so this is the only gate it has.
      // Validated only when this call's end state is predictable; an `edit`
      // whose merge we cannot model falls back to §3.4's post-write re-check.
      // `.html` has no frontmatter by construction: a `null`
      // fm makes `onBindingRejection` return early, but "it happens to be null"
      // is luck, not a contract. Skip it by name so the intent is readable — and
      // so a future `.html` starting with `---` cannot break it.
      if (proposed !== undefined) {
        const reason = isHtmlPath(file)
          ? null
          : await onBindingRejection(file, parseFrontmatter(proposed).frontmatter, store);
        if (reason !== null) return { block: true, reason };
      }
    } catch (err) {
      console.warn(`[world-context] binding validation failed open for ${file}:`, err);
    }
    try {
      // NPC cards: the writer may create one during
      // play, held to the same schema `check:worlds` holds templates to.
      if (proposed !== undefined && !isHtmlPath(file)) {
        const reason = await npcWriteRejection(file, parseFrontmatter(proposed).frontmatter, store);
        if (reason !== null) return { block: true, reason };
      }
    } catch (err) {
      console.warn(`[world-context] NPC validation failed open for ${file}:`, err);
    }
    // One place classifies; the receipt side consumes it. `target.kind` is
    // `'entity' | 'html'` here ('rejected' returned above, 'command' above that),
    // so this narrows without a cast.
    writes.set(event.toolCallId, { file, existed, kind: target.kind });
  });

  pi.on('tool_result', async (event, ctx) => {
    // §3.4 step 6 — the tracked-write lookup (unchanged).
    const tracked = writes.get(event.toolCallId);
    writes.delete(event.toolCallId);
    if (!tracked || event.isError) return;
    const store = worldStore(ctx);

    if (tracked.kind === 'command') {
      // §3.5 step 7 — command receipt. §5.2 [C-2] = A (frozen): NO `appendEvent`
      // (`entity_created` would toast "the object is now in the current scene"
      // at the player, and a command is a rule, not an object).
      const raw = await store.readFile(tracked.file);
      const result = parseWorldCommand(tracked.id, raw);
      if (!result.ok) {
        // 7c — unreachable in principle; the file is on disk either way.
        return { content: [{ type: 'text' as const, text: commandRejection(tracked.id, result.errors) }], isError: true };
      }
      const bytes = Buffer.byteLength(raw, 'utf8');
      return { content: [{ type: 'text' as const, text: writeReceipt(tracked.id, result.command, bytes) }] };
    }

    const { frontmatter: fm } = parseFrontmatter(await store.readFile(tracked.file));
    // §3.4 T2 — re-validate what actually landed. `edit`'s prediction is not the
    // fact (pi-rp normalises and fuzzy-matches), so `on` is checked once more
    // against the disk rather than trusted from `tool_call`.
    // `.html` is skipped by tracked kind, not by re-running `isHtmlPath`: the
    // `tool_call` side already classified, and the receipt must consume that
    // result rather than implement the same check twice (contract §11 V4).
    if (tracked.kind !== 'html' && fm?.['on'] !== undefined) {
      try {
        const reason = await onBindingRejection(tracked.file, fm, store);
        if (reason !== null) return { content: [{ type: 'text' as const, text: reason }], isError: true };
      } catch (err) {
        console.warn(`[world-context] post-write binding check failed open for ${tracked.file}:`, err);
      }
    }
    const name = String(fm?.title ?? fm?.name ?? path.basename(tracked.file, '.md'));
    const layer = await store.resolveLayer(tracked.file);
    const actor = agentActor();
    const turn = currentTurnAnchor(ctx);
    if (!tracked.existed && tracked.file.endsWith('/README.md')) {
      // During `airp-init` the command owns `layer_initialized` and records it
      // from the on-disk outcome; the subagent's native write
      // must not also land one, or the layer gets two rows (the design notes
      // requires the two entry points be mutually exclusive). The flag is set
      // across the spawn by init-command.ts; jiti gives each extension its own
      // module instance, so `process.env` is the only channel between files.
      if (process.env.AIRP_INIT_IN_FLIGHT === '1') return;
      await store.appendEvent({ type: 'layer_initialized', actor, turn, layer: layer ?? undefined,
        subject: layer ?? tracked.file, detail: { layer: layer ?? tracked.file.replace('/README.md', ''), name, by: 'writer', files: [tracked.file] } });
      return;
    }
    const kind = fm?.type === 'chalk' ? 'chalk' : fm?.type === 'letter' ? 'letter' : fm?.type === 'note' ? 'note' : 'other';
    await store.appendEvent({ type: tracked.existed ? 'entity_edited' : 'entity_created', actor, turn,
      layer: layer ?? undefined, subject: tracked.file, detail: { path: tracked.file, name, kind } });
  });
}
