/**
 * Write-path classification and the write gate's model-facing copy —
 * `the design notes` §2.1 / §2.3 / §2.4 / §3.7.
 *
 * Why this lives in `packages/shared` and not in `extensions/` (§8.1): it is
 * covered by plain `node --test` (extensions load through jiti, a different
 * test surface), the equivalence assertion against `01`'s `commandIdOfPath`
 * needs one module that can import both, and a future action-layer caller has
 * no access to the agent-process-only `extensions/` side.
 *
 * Pure, synchronous, no I/O — see §2.1. Nothing here reads the disk, so a
 * rejection costs one function call and the tool never runs (`07` §4.2:
 * "拒绝一次写入 = 世界零改动").
 */

import { COMMAND_ID_RE, MAX_COMMAND_ID_LENGTH } from './limits.js';
// Zero-dependency pure scanner: `rules/ → commands/` edges
// already exist for other rules, and `html-head` itself imports nothing, so no
// cycle is created. This module owns no extension test of its own (contract
// §4.2: `isHtmlPath` is the repository's single `.html` predicate).
import { isHtmlPath } from '../rules/html-head.js';

/* ────────────────────────────────────────────────────────────────────────────
 * 1. The classifier (`07` §2.1, frozen)
 * ──────────────────────────────────────────────────────────────────────────── */

/** A world-root-relative, POSIX-separated, already-normalised path. */
export type WorldWriteTarget =
  | { kind: 'entity' } // world/** | player/** | characters/**, and exactly .md
  | { kind: 'html' } // the same three roots, and exactly .html (case-insensitive)
  | { kind: 'command'; id: string } // command/<id>.yaml, and <id> legal
  | { kind: 'rejected'; code: WorldWriteRejection };

export type WorldWriteRejection =
  | 'not_a_writable_root'
  | 'entity_must_be_md'
  | 'command_must_be_yaml'
  | 'command_must_be_flat'
  | 'command_id_invalid';

/** The three CONTENT roots. Each admits `.md`, plus `.html`. */
const CONTENT_ROOTS = ['world/', 'player/', 'characters/'] as const;
const COMMAND_ROOT = 'command';
const COMMAND_EXT = '.yaml';

/**
 * Classify a world-root-relative path for the write gate.
 *
 * The caller MUST have normalised first (`07` §3.1 step 2): `path.relative`
 * against the world root, then `/` separators. A non-normalised path is not
 * repaired here — a lenient matcher would let `world/command/x.yaml` look like
 * a command.
 *
 * **Equivalence with `01`'s `commandIdOfPath` (§2.1 rule 3, pinned by test).**
 * For every `file`:
 *
 *     classifyWorldWritePath(file).kind === 'command'
 *       ⟺  commandIdOfPath(file) !== null
 *
 * and the two ids are byte-identical. The branches below mirror that function
 * exactly — two segments, dir `command`, suffix `.yaml`, id matching
 * `COMMAND_ID_RE` — and the five rejection codes split the single `null` into
 * actionable cases. `COMMAND_ID_RE` is imported, never re-declared: `01 §2.1`
 * owns the regex.
 *
 * The `.html` branch is ORTHOGONAL to the `command/`
 * branch: it lives in the content-root loop, which is only reached when
 * `root !== 'command'`. The equivalence above therefore stays TOTAL — verified
 * by running this file's N5 corpus (11 + 32 inputs) with the new branch in
 * place: zero divergences.
 */
export function classifyWorldWritePath(file: string): WorldWriteTarget {
  if (typeof file !== 'string' || file.length === 0) {
    return { kind: 'rejected', code: 'not_a_writable_root' };
  }

  const slash = file.indexOf('/');
  const root = slash === -1 ? file : file.slice(0, slash);

  if (root === COMMAND_ROOT) {
    // `command/` dispatches on extension (contract §6.2): exactly `.yaml`, flat.
    // The id comes from the FILENAME, so nesting is refused (`01 §2.1`) — a
    // path-derived id would change the meaning of `<id>`.
    const parts = file.split('/');
    if (parts.length > 2) return { kind: 'rejected', code: 'command_must_be_flat' };
    const name = parts[1] ?? '';
    if (!name.endsWith(COMMAND_EXT) || name.length === COMMAND_EXT.length) {
      return { kind: 'rejected', code: 'command_must_be_yaml' };
    }
    const id = name.slice(0, -COMMAND_EXT.length);
    return COMMAND_ID_RE.test(id) ? { kind: 'command', id } : { kind: 'rejected', code: 'command_id_invalid' };
  }

  for (const prefix of CONTENT_ROOTS) {
    if (file.startsWith(prefix)) {
      // `.md` first: the order is load-bearing (`world/x.html.md` is an entity).
      if (file.endsWith('.md')) return { kind: 'entity' };
      if (isHtmlPath(file)) return { kind: 'html' };
      return { kind: 'rejected', code: 'entity_must_be_md' };
    }
  }
  return { kind: 'rejected', code: 'not_a_writable_root' };
}

/* ────────────────────────────────────────────────────────────────────────────
 * 2. Limits (`07` §2.4)
 * ──────────────────────────────────────────────────────────────────────────── */

/**
 * Diagnostics per `block.reason` (§2.3 R3). A 46-error reason is 5-8 KB — a
 * quarter of one turn's context — and 46 errors almost always means "rewrite
 * from the template" is faster than patching.
 */
export const MAX_REASON_DIAGNOSTICS = 8;

/**
 * Backstop truncation (§2.4). Not redundant with the count limit: this one
 * catches ONE diagnostic that is itself 2 KB (`unknown_action` prints the whole
 * effect list, ~200 chars; 8 of those approach the cap). Whichever hits first.
 */
export const MAX_REASON_CHARS = 2400;

/**
 * NOT a gate (§2.4). A command file past this size still writes; the receipt
 * gains one hint. A command growing past 4 000 bytes is turning into a script,
 * which usually means it should be split into `run` chain entries.
 */
export const COMMAND_FILE_SOFT_HINT_CHARS = 4000;

/* ────────────────────────────────────────────────────────────────────────────
 * 3. `writeGateReason` (`07` §3.7 + §2.3's R1 / R4)
 * ──────────────────────────────────────────────────────────────────────────── */

/**
 * The model-facing reason for a rejected write path (`07` §3.7's table, verbatim
 * sentence per code).
 *
 * `file` is optional so the frozen one-argument signature (`07` §8.1) still
 * works; the hook passes it so the model sees WHICH path it sent. The framing
 * around the table sentence is `07` §2.3's grammar, which §7.5 hard-constraint 4
 * says the ASSEMBLER adds because neither `01`'s nor `02`'s tables carry it:
 *
 *   R1 — line 1 asserts nothing was written (the block runs before the tool, so
 *        the model must not go `read` the path to check — §4.2);
 *   R4 — a final imperative naming the next action.
 */
export function writeGateReason(code: WorldWriteRejection, file = ''): string {
  const got = file.length === 0 ? '' : ` Got "${file}".`;
  const notWritten =
    file.length === 0
      ? 'Nothing was written. Nothing was changed on disk.'
      : `${file} was NOT written. Nothing was changed on disk.`;

  const hasExt = file.lastIndexOf('.') > file.lastIndexOf('/');
  const stem = hasExt ? file.slice(0, file.lastIndexOf('.')) : file;
  const base = file.slice(file.lastIndexOf('/') + 1);
  const id = base.endsWith(COMMAND_EXT) ? base.slice(0, -COMMAND_EXT.length) : base;

  switch (code) {
    case 'not_a_writable_root':
      return [
        notWritten,
        '',
        'Writes must target world/**, player/**, characters/** (scene, prop, or character Markdown) or command/<id>.yaml (a world command).' +
          got,
        '',
        'Rewrite the path and call write again under one of those four roots.',
      ].join('\n');
    case 'entity_must_be_md':
      return [
        notWritten,
        '',
        `Scene, prop, and character files must be a .md entity or a self-contained .html page: "${file}".${file.length === 0 ? '' : ` Did you mean "${stem}.md"?`}`,
        '',
        file.length === 0
          ? 'Add the ".md" extension and call write again.'
          : `Call write again at "${stem}.md".`,
      ].join('\n');
    case 'command_must_be_yaml':
      return [
        notWritten,
        '',
        `A world command must be command/<id>.yaml - exactly ".yaml", no subdirectories.${got}`,
        '',
        'Write the command to command/<id>.yaml and call write again.',
      ].join('\n');
    case 'command_must_be_flat':
      return [
        notWritten,
        '',
        `A command's id comes from its filename, so commands live directly in command/.${got}${base.length === 0 ? '' : ` Did you mean "command/${base}.yaml"?`}`,
        '',
        base.length === 0
          ? 'Move it to the top of command/ and call write again.'
          : `Call write again at "command/${base}.yaml".`,
      ].join('\n');
    case 'command_id_invalid':
      return [
        notWritten,
        '',
        `"${id}" is not a valid command id (ASCII lowercase kebab-case, 1-${MAX_COMMAND_ID_LENGTH} chars, must not start with a hyphen).${got}`,
        '',
        'Rename it to ASCII lowercase kebab-case (e.g. "investigate-clue") and call write again.',
      ].join('\n');
  }
}
