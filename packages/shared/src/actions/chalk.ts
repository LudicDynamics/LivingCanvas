/**
 * doc 02 `chalk` — the only action that writes narration body text.
 *
 * It absorbs five responsibilities so the model does not have to: naming
 * (`<layerDir>/NN-<slug>.md`), the `type: chalk` frontmatter skeleton,
 * appending, landing exactly one world event, and (optionally) drawing a
 * relation line through `linkCards`.
 *
 * Placement note: doc 02 §8.1 puts `yamlScalar` / `stringifyEntityFrontmatter` /
 * `stringifyChalkFile` in `schemas/frontmatter.ts`, but this batch assigns that
 * file to doc 06. They live here instead (doc 02 §10.1 imports them from
 * `actions/chalk.js`), and the package barrel re-exports them.
 */
import type { WorldEvent } from '../schemas/events.js';
import {
  entityName,
  parseFrontmatter,
  type Choice,
  type ParsedFrontmatter,
  type RollDice,
  type Status,
} from '../schemas/frontmatter.js';
import { ActionError, fail } from './errors.js';
import { validateAppearanceInput } from '../schemas/appearance.js';
import { assertNookMutationAllowed } from './actor.js';
import type { AgentScope } from './actor.js';
import { dirname } from './refs.js';
import { registerAction } from './service.js';
import type { LinkStyle } from '../schemas/canvas.js';
import { linkCards } from './canvas.js';
import { commandDetail } from './types.js';
import type { ActionContext, ActionResult } from './types.js';

const SLUG_MAX = 32;
const SUMMARY_MAX = 120;
/** doc 02 §7.4: the discipline threshold; a hint only, never a refusal. */
const LONG_THRESHOLD = 200;
/** Write whitelist (doc 02 §4.1 / 00 §2.2). */
const WRITE_ROOTS = new Set(['world', 'player', 'characters']);
/** The frozen frontmatter key order (doc 02 §4.2): type, title, <extra>, roll_dice, choice, status. */
const INTERACTIVE_KEYS = ['roll_dice', 'choice', 'status'] as const;
const INTERACTIVE_KEY_SET = new Set<string>(INTERACTIVE_KEYS);

/* ────────────────────────────────────────────────────────────────────────────
 * 1. Input / output shapes (doc 02 §2.2 / §6.2)
 * ──────────────────────────────────────────────────────────────────────────── */

/**
 * Interactive fields + rendering variants, written into frontmatter verbatim.
 * The three key shapes are owned by doc 06; this is only the container (§2.7).
 */
export interface ChalkFrontmatterInput {
  /** 06's `StatusSchema`. */
  status?: Status;
  /** 06's `ChoiceSchema`. */
  choice?: Choice;
  /** 06's `RollDiceSchema`; `result` / `passed` only on an explicit engine writeback. */
  roll_dice?: RollDice;
  /** Rendering variants the tool does not interpret: `anchor` / `font` / `big` / `color` / `card`. */
  extra?: Record<string, unknown>;
}

export interface WriteChalkInput {
  /** Body markdown, frontmatter already stripped by the caller. REQUIRED. */
  body: string;
  /**
   * Title. Drives both the frontmatter `title` and the default filename slug.
   * REQUIRED at this layer (01 §5): the TOOL shell derives it from the body's
   * first non-empty line when the model omits it (doc 02 §2.5) — normalization
   * belongs to the transport edge, not to the action.
   */
  title: string;
  /** Explicit target. Omitted => `<layer>/NN-<slug>.md` (§2.4). Exclusive with `appendTo`. */
  path?: string;
  /** Layer directory for the default naming, world-relative (`world/baker-street`). */
  layer?: string;
  /** Interactive fields + rendering variants (§2.7). */
  frontmatter?: ChalkFrontmatterInput;
  /** Append to this existing path instead of creating a new file (§2.3 case C). */
  appendTo?: string;
  /** Create one canvas link from the new chalk to this endpoint (§2.3 case D). */
  linkTo?: string;
  /** Opaque correlation id echoed back in `details` (god-mode optimistic UI). */
  clientRef?: string;
}

export interface WriteChalkDetails {
  /** Final world-relative path (stable id). */
  path: string;
  /** true = created, false = appended. */
  created: boolean;
  /** Complement of `created`; the redundancy is deliberate (doc 02 §6.2). */
  appended: boolean;
  /** == the frontmatter title, i.e. the event's `detail.name`. */
  name: string;
  /** `resolveLayer(path)`; null for player / character nooks. */
  layer: string | null;
  /** Echoed from `WriteChalkInput.clientRef`. */
  clientRef?: string;
  /** Present only when a link was requested AND it succeeded. */
  link?: { from: string; to: string };
  /** Present only when a link was requested but `linkCards` threw (§7.3). Never both. */
  linkFailure?: { to: string; code: string; message: string };
  /** true = the resulting body exceeds the §7.4 discipline length. A hint only. */
  long?: boolean;
}

/* ────────────────────────────────────────────────────────────────────────────
 * 2. Pure helpers (doc 02 §10.1 — exported for the unit tests)
 * ──────────────────────────────────────────────────────────────────────────── */

/**
 * Title → filename slug: lower-case, each run of non `[a-z0-9]` becomes one `-`,
 * trimmed, truncated to 32; empty degenerates to `chalk` (§2.4). Non-ASCII
 * titles therefore land on `<NN>-chalk.md` — never transliterated.
 */
export function slugify(title: string): string {
  const slug = String(title ?? '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, SLUG_MAX)
    .replace(/-+$/g, '');
  return slug === '' ? 'chalk' : slug;
}

/**
 * Two-digit zero-padded next ordinal for a directory (§2.4): max existing
 * `NN-` prefix + 1, starting at `01`. Holes are never filled (a hole means a
 * deleted file, and reusing it decouples order from time). Three digits once
 * the max reaches 99. Unnumbered legacy files (`evening.md`) do not count.
 */
export function nextOrdinal(filenames: string[]): string {
  let max = 0;
  for (const name of filenames) {
    // `\d+` (a superset of §2.4's `\d\d-`) so a three-digit run does not fall
    // back to `01`: `100-x.md` unread would collide with a fresh generation.
    const m = /^(\d+)-/.exec(String(name));
    if (m) max = Math.max(max, Number(m[1]));
  }
  return String(max + 1).padStart(2, '0');
}

const NUMERIC = /^[-+]?(\d+\.?\d*|\.\d+)([eE][-+]?\d+)?$/;
const HEX_OCT = /^[-+]?0[xX][0-9a-fA-F]+$|^[-+]?0[oO][0-7]+$/;
const BOOLISH = /^(true|false|yes|no|on|off|y|n)$/i;
const NULLISH = /^(null|~)$/i;

/**
 * A YAML scalar quoted ONLY when the bare form would stop round-tripping
 * (doc 02 §4.3): empty / padded / numeric-looking / boolean-looking / null-ish
 * / contains `: `, ` #`, a newline, or starts with a YAML indicator. The
 * parser reads quoted => string and bare numeric => number, so this is what
 * keeps `status.data` types intact.
 */
export function yamlScalar(value: unknown): string {
  if (value === null || value === undefined) return 'null';
  if (typeof value === 'number') {
    return Number.isFinite(value) ? String(value) : `"${String(value)}"`;
  }
  if (typeof value === 'bigint' || typeof value === 'boolean') return String(value);
  const s = String(value);
  const needsQuote =
    s === '' ||
    s !== s.trim() ||
    /^[-?:,[\]{}#&*!|>'"%@`]/.test(s) ||
    s.includes(': ') ||
    s.endsWith(':') ||
    s.includes(' #') ||
    /[\n\r\t]/.test(s) ||
    // A bare numeric/boolean/null string would be read back as that other
    // type, so only these need quotes to round-trip as strings (§4.3).
    NUMERIC.test(s) ||
    HEX_OCT.test(s) ||
    BOOLISH.test(s) ||
    NULLISH.test(s);
  return needsQuote ? `"${s.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"` : s;
}

function isPlainObject(value: unknown): value is Record<string, any> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/* ────────────────────────────────────────────────────────────────────────────
 * 3. Frontmatter writing (doc 02 §4.2 / §4.3)
 * ──────────────────────────────────────────────────────────────────────────── */

function yamlLines(key: string, value: unknown, pad: string): string[] {
  if (Array.isArray(value)) {
    const lines = [`${pad}${key}:`];
    for (const item of value) {
      if (isPlainObject(item)) {
        const entries = Object.entries(item);
        if (entries.length === 0) {
          lines.push(`${pad}  - {}`);
          continue;
        }
        lines.push(`${pad}  - ${entries[0][0]}: ${yamlScalar(entries[0][1])}`);
        for (const [k, v] of entries.slice(1)) {
          lines.push(...yamlLines(k, v, `${pad}    `));
        }
      } else {
        lines.push(`${pad}  - ${yamlScalar(item)}`);
      }
    }
    return lines;
  }
  if (isPlainObject(value)) {
    return [`${pad}${key}:`, ...Object.entries(value).flatMap(([k, v]) => yamlLines(k, v, `${pad}  `))];
  }
  return [`${pad}${key}: ${yamlScalar(value)}`];
}

/**
 * Serialize a frontmatter mapping and the interactive block into the
 * `---…---` fence (no trailing blank line). Key order FOLLOWS insertion order
 * — the tool builds it in the frozen order of §4.2 and this never sorts or
 * drops unknown keys. Interactive keys are appended in their frozen order
 * (`roll_dice`, `choice`, `status`); nested blocks indent by 2 spaces
 * everywhere, unlike the legacy `stringifyChalk` (which used 4 for `roll_dice`).
 */
export function stringifyEntityFrontmatter(
  frontmatter: Record<string, any>,
  interactive: Record<string, any> = {}
): string {
  const lines: string[] = ['---'];
  for (const [k, v] of Object.entries(frontmatter)) {
    lines.push(...yamlLines(k, v, ''));
  }
  for (const k of INTERACTIVE_KEYS) {
    if (interactive[k] !== undefined && interactive[k] !== null) {
      lines.push(...yamlLines(k, interactive[k], ''));
    }
  }
  lines.push('---');
  return lines.join('\n');
}

/**
 * A whole chalk file: fence + blank line + body + trailing newline (§4.3).
 * `fm` is serialized in its own insertion order — `buildFrontmatter` already
 * emits the frozen §4.2 order, so nothing is re-sorted here. Idempotent by
 * construction: `stringifyChalkFile(fm, parseFrontmatter(f).body)` reproduces
 * `f`, which is the writer/parser round-trip the Phase ① → Phase ② hand-off
 * depends on (§10.1). The blank line after the fence is a convention, not data,
 * so both edges of the body are trimmed of blank lines first (§3.1).
 */
export function stringifyChalkFile(fm: Record<string, any>, body: string): string {
  return `${stringifyEntityFrontmatter(fm)}\n\n${String(body ?? '').replace(/^\n+/, '').replace(/\n+$/, '')}\n`;
}

/**
 * The frozen key order of §4.2: `type`, `title`, `feature.line-from` extras,
 * then the three interactive keys. `extra` may not carry `type` / `title` —
 * those two are the tool's own (§2.7).
 */
export function buildFrontmatter(
  input: { title: string; frontmatter?: ChalkFrontmatterInput },
  existing?: Record<string, any> | null
): Record<string, any> {
  const extra = { ...(input.frontmatter?.extra ?? {}) };
  if ('type' in extra || 'title' in extra) {
    fail('invalid_argument', "frontmatter.extra must not override 'type' or 'title'");
  }
  if (extra.component === 'photo' || Object.prototype.hasOwnProperty.call(extra, 'image')) {
    fail('invalid_argument', "writeChalk cannot create component: photo entities or photo image fields");
  }
  // `linkStyle` is a LINE parameter wearing an `extra` hat (§2.6): the action
  // consumes it to style the link and drops it, so the chalk file never grows a
  // key that is not in the §4.2 field set.
  delete extra.linkStyle;
  // Append keeps the existing title (§3.1): one chalk has exactly one title,
  // and it is the card name / filename source.
  const title =
    existing && typeof existing.title === 'string' && existing.title !== ''
      ? existing.title
      : input.title;
  const fm: Record<string, any> = { type: 'chalk', title };

  // Unknown existing keys (anchor / font / …) survive an append, then this
  // call's extras overlay them.
  if (existing) {
    for (const [k, v] of Object.entries(existing)) {
      if (k === 'type' || k === 'title' || INTERACTIVE_KEY_SET.has(k)) continue;
      fm[k] = v;
    }
  }
  Object.assign(fm, extra);

  const given = input.frontmatter;
  const rollDice = given?.roll_dice ?? (existing?.roll_dice as RollDice | undefined);
  const choice = given?.choice ?? (existing?.choice as Choice | undefined);
  if (rollDice !== undefined && rollDice !== null) fm.roll_dice = rollDice;
  if (choice !== undefined && choice !== null) fm.choice = choice;

  const existingStatus = isPlainObject(existing?.status) ? (existing.status as Status) : undefined;
  const givenStatus = given?.status;
  // status is a snapshot of the entity; an append that reports two keys must
  // not erase the ones it did not restate (§3.1).
  if (givenStatus?.data) {
    fm.status = { ...existingStatus, ...givenStatus, data: { ...(existingStatus?.data ?? {}), ...givenStatus.data } };
  } else if (givenStatus ?? existingStatus) {
    fm.status = givenStatus ?? existingStatus;
  }
  return fm;
}

/**
 * The `append_to` body join (§3.1): one blank line, never a `---` rule (it
 * would be read as a frontmatter fence mid-file), and no accumulating tail
 * whitespace across repeated appends.
 */
export function renderAppend(existingBody: string, newBody: string): string {
  return `${String(existingBody ?? '').replace(/\s+$/, '')}\n\n${String(newBody ?? '').replace(/\s+$/, '')}`;
}

/* ────────────────────────────────────────────────────────────────────────────
 * 4. Path discipline (doc 02 §2.4 / 00 §2.1 / §2.5)
 * ──────────────────────────────────────────────────────────────────────────── */

/**
 * The §2.4 validation steps 1–2, applied to every path this module accepts:
 * world-relative POSIX, no `.` / `..` / hidden segment, first segment in the
 * write whitelist. The `.md` / README rules are target-specific and live below.
 */
function assertPathShape(path: string): void {
  const relativeMsg = `path '${path}' must be world-relative POSIX without '.', '..' or a leading '/'`;
  if (path.includes('\\') || path.startsWith('/') || /^[A-Za-z]:/.test(path)) {
    throw new ActionError({ code: 'invalid_path', message: relativeMsg });
  }
  const segs = path.split('/').filter((s) => s !== '');
  if (segs.includes('..') || segs.includes('.') || segs.some((s) => s.startsWith('.'))) {
    throw new ActionError({ code: 'invalid_path', message: relativeMsg });
  }
  if (!WRITE_ROOTS.has(segs[0])) {
    throw new ActionError({
      code: 'invalid_path',
      message: `chalk can only write under world/, player/ or characters/ (got '${path}')`,
    });
  }
}

/**
 * Steps 1–3 of §2.4's ordered validation: the shared shape rules, then the
 * README refusal. README precedes existence on purpose (§7.2): a README almost
 * always exists, and "a layer's identity is not a target" is the truer reason.
 * The `.md` suffix rule is step 5 and is applied after the existence check.
 */
function assertChalkTarget(path: string): void {
  assertPathShape(path);
  if (path.endsWith('/README.md') || path === 'README.md') {
    throw new ActionError({
      code: 'not_movable',
      message: `README.md is a layer's identity, not a chalk target`,
    });
  }
}

/* ────────────────────────────────────────────────────────────────────────────
 * 5. The action itself
 * ──────────────────────────────────────────────────────────────────────────── */

/** Shape resolved from the optional-argument combination (§2.3). */
type ChalkShape =
  | { kind: 'create'; path?: string; layerDir: string }
  | { kind: 'append'; appendTo: string; layerDir: string };

/**
 * Resolve the A/B/C shape and the directory the chalk belongs to. `path` and
 * `appendTo` are opposite intents and are never guessed between (§2.3).
 */
function resolveShape(input: WriteChalkInput): ChalkShape {
  if (input.path !== undefined && input.appendTo !== undefined) {
    fail('invalid_argument', 'chalk accepts either path (create) or append_to (append), not both');
  }
  if (input.appendTo !== undefined) {
    assertChalkTarget(input.appendTo);
    return { kind: 'append', appendTo: input.appendTo, layerDir: dirname(input.appendTo) };
  }
  if (input.path !== undefined) {
    assertChalkTarget(input.path);
    const dir = dirname(input.path);
    if (input.layer !== undefined && input.layer !== dir) {
      fail('invalid_argument', `path '${input.path}' is not inside layer '${input.layer}'`);
    }
    return { kind: 'create', path: input.path, layerDir: dir };
  }
  if (!input.layer) {
    fail('invalid_argument', "chalk needs either 'path' or a layer directory to name the file");
  }
  assertPathShape(input.layer);
  return { kind: 'create', layerDir: input.layer };
}

export async function writeChalk(
  ctx: ActionContext,
  input: WriteChalkInput
): Promise<ActionResult<WriteChalkDetails>> {
  const { store, actor } = ctx;

  // ---- 1. parse / normalize ----
  const rawBody = input?.body;
  if (typeof rawBody !== 'string' || rawBody.trim() === '') {
    fail('invalid_argument', "chalk needs a non-empty 'content'");
  }
  if (typeof input.title !== 'string' || input.title.trim() === '') {
    fail('invalid_argument', "chalk needs a 'title' (the action layer receives the derived one)");
  }

  // ---- 2–3. shape + target ----
  const shape = resolveShape(input);
  let targetPath: string;
  let parsed: ParsedFrontmatter | null = null;

  if (shape.kind === 'append') {
    // §2.4 step 5: a chalk is always a `.md`, append included.
    if (!shape.appendTo.endsWith('.md')) {
      fail('invalid_path', `path '${shape.appendTo}' must end with '.md'`);
    }
    parsed = parseFrontmatter(await store.readFile(shape.appendTo));
    const type = parsed.frontmatter?.type;
    if (type !== 'chalk') {
      fail(
        'malformed_entity',
        `append_to target '${shape.appendTo}' is type '${String(type)}', not 'chalk'`
      );
    }
    // Append is "the same article gains a paragraph", never a cross-layer
    // archive move (§3.1).
    if (input.layer !== undefined && input.layer !== shape.layerDir) {
      fail(
        'invalid_argument',
        `append_to must stay in the same layer as the new chalk (got '${shape.layerDir}' vs '${input.layer}')`
      );
    }
    targetPath = shape.appendTo;
  } else {
    if (shape.path !== undefined) {
      targetPath = shape.path;
    } else {
      if ((await store.statKind(shape.layerDir)) !== 'dir') {
        fail('not_found', `layer directory '${shape.layerDir}' does not exist`);
      }
      const files = await store.listFiles(shape.layerDir);
      const ordinal = nextOrdinal(files.map((f) => f.slice(f.lastIndexOf('/') + 1)));
      targetPath = `${shape.layerDir}/${ordinal}-${slugify(input.title)}.md`;
    }
    // ---- 4–5. existence, then the `.md` suffix (§2.4 ordered steps) ----
    if ((await store.statKind(targetPath)) !== 'missing') {
      fail(
        'already_exists',
        `'${targetPath}' already exists; use append_to to continue it, or edit to change it`
      );
    }
    if (!targetPath.endsWith('.md')) {
      fail('invalid_path', `path '${targetPath}' must end with '.md'`);
    }
  }

  // `link_to` endpoints are validated before any write (§3 step 4). A directory
  // path is accepted and resolves to that layer's README door (§2.6).
  let resolvedLink: string | undefined;
  if (input.linkTo !== undefined) {
    assertPathShape(input.linkTo);
    let endpoint = input.linkTo;
    if ((await store.statKind(endpoint)) === 'dir') {
      const door = `${endpoint.replace(/\/+$/, '')}/README.md`;
      if ((await store.statKind(door)) === 'missing') {
        fail('not_found', `link_to endpoint '${input.linkTo}' does not exist`);
      }
      endpoint = door;
    } else if ((await store.statKind(endpoint)) === 'missing') {
      fail('not_found', `link_to endpoint '${input.linkTo}' does not exist`);
    }
    const endpointLayer = await store.resolveLayer(endpoint);
    const ownLayer = await store.resolveLayer(targetPath);
    if (endpointLayer === null || ownLayer === null || endpointLayer !== ownLayer) {
      fail(
        'invalid_argument',
        `link_to endpoint '${input.linkTo}' is not on the same layer as '${targetPath}'; cross-layer lines are never rendered`
      );
    }
    resolvedLink = endpoint;
  }
  // The layer directory must exist for an explicit path too.
  if (shape.kind === 'create' && (await store.statKind(shape.layerDir)) !== 'dir') {
    fail('not_found', `layer directory '${shape.layerDir}' does not exist`);
  }
  if (!(actor.type === 'player' && ctx.nookNote === true)) {
    const agentScope: AgentScope =
      ctx.agentScope ??
      (actor.type === 'character' ? 'character' : actor.type === 'player' ? 'player' : 'writer-top-level');
    const manifest = await store.getManifest();
    assertNookMutationAllowed(
      actor,
      agentScope,
      targetPath,
      'write',
      manifest.characters.map((character) => character.id),
    );
  }
  const fm = buildFrontmatter(input, parsed?.frontmatter ?? null);
  const body = shape.kind === 'append' ? renderAppend(parsed!.body, rawBody) : rawBody.trim();
  if (Object.prototype.hasOwnProperty.call(fm, 'appearance')) {
    const appearance = validateAppearanceInput(fm.appearance, 'chalk');
    if (!appearance.ok) {
      const issue = appearance.issues[0];
      throw new ActionError({
        code: 'invalid_argument',
        message: issue?.message ?? 'Invalid appearance for component kind "chalk".',
        details: { issues: appearance.issues },
      });
    }
  }
  const text = stringifyChalkFile(fm, body);

  // ---- 7. write (atomic whenever an existing file is rewritten) ----
  try {
    if (shape.kind === 'append') await store.writeFileAtomic(targetPath, text);
    else await store.writeFile(targetPath, text);
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err);
    fail(
      'write_failed',
      shape.kind === 'append'
        ? `Failed to write '${targetPath}' atomically: ${detail}`
        : `Failed to write '${targetPath}': ${detail}`
    );
  }

  // ---- 8. exactly one event ----
  const name = typeof fm.title === 'string' ? fm.title : input.title;
  // The summary is at most one line and never the body (doc 21 §3.3): the
  // first non-empty trimmed line, capped at 120 chars.
  const summary = (body.split('\n').map((l) => l.trim()).find((l) => l !== '') ?? '').slice(0, SUMMARY_MAX);
  const layer = await store.resolveLayer(targetPath);
  let event: WorldEvent;
  try {
    event =
      shape.kind === 'append'
        ? await store.appendEvent({
            type: 'entity_edited',
            actor,
            detail: { path: targetPath, name: entityName(parsed?.frontmatter ?? null, targetPath), kind: 'chalk', ...commandDetail(ctx) },
            subject: targetPath,
            layer: layer ?? undefined,
            turn: ctx.turn,
          })
        : await store.appendEvent({
            type: 'entity_created',
            actor,
            detail: { path: targetPath, name, kind: 'chalk', summary, ...commandDetail(ctx) },
            subject: targetPath,
            layer: layer ?? undefined,
            turn: ctx.turn,
          });
  } catch (err) {
    throw new ActionError({
      code: 'event_failed',
      message: 'File was written but the world event could not be recorded',
      details: { path: targetPath, cause: err instanceof Error ? err.message : String(err) },
    });
  }
  // ---- 9. link (post-event; a failure here is partial success, §7.3) ----
  let link: { from: string; to: string } | undefined;
  let linkFailure: { to: string; code: string; message: string } | undefined;
  if (resolvedLink !== undefined) {
    // `frontmatter.extra.linkStyle` is pure pass-through; the style enum is 09's.
    const style = input.frontmatter?.extra?.linkStyle as LinkStyle | undefined;
    try {
      await linkCards(ctx, { op: 'create', from: targetPath, to: resolvedLink, style });
      link = { from: targetPath, to: resolvedLink };
    } catch (err) {
      linkFailure = {
        to: resolvedLink,
        code: err instanceof ActionError ? err.code : 'internal',
        message: err instanceof Error ? err.message : String(err),
      };
    }
  }

  // ---- 10. return ----
  const created = shape.kind !== 'append';
  const chars = body.length;
  const long = chars > LONG_THRESHOLD;
  const verb = created ? 'Wrote' : 'Appended to';
  const parts = [`${verb} ${targetPath} (chalk, ${chars} characters)`];
  if (link) parts.push(`linked to ${link.to}`);
  let text2 = `${parts.join(', ')}.`;
  if (linkFailure) {
    text2 += `\nNote: could not link it to '${linkFailure.to}' (${linkFailure.message}). The chalk itself is saved.`;
  }
  if (long) {
    text2 += `\nNote: this chalk is ${chars} characters; the discipline says keep a single chalk short (<=200) and continue it with append_to.`;
  }

  return {
    text: text2,
    details: {
      path: targetPath,
      created,
      appended: !created,
      name,
      layer,
      ...(input.clientRef !== undefined ? { clientRef: input.clientRef } : {}),
      ...(link ? { link } : {}),
      ...(linkFailure ? { linkFailure } : {}),
      long,
      event,
    },
  };
}

registerAction('writeChalk', (ctx, input) => writeChalk(ctx, input as unknown as WriteChalkInput));
