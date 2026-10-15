#!/usr/bin/env node
/**
 * `tools/migrate-dice-outcomes.mjs` — route D's WRITE step for the six live
 * worlds (`the design notes` §3 steps 0–2, §4.1, §12).
 *
 * What it does: for every `templates/<world>/world/**\/04-investigation-dice.md`
 * it APPENDS an `on:` block (the 12 lines of §4.1, one binding per
 * `dice_outcomes` band, each carrying the band's `grade`) and writes the one
 * shared `templates/<world>/command/investigation-outcome.yaml`. Nothing is
 * deleted, `dice_outcomes` is never touched (§4.2: 0 lines removed).
 *
 * ── Usage ────────────────────────────────────────────────────────────────────
 *   node tools/migrate-dice-outcomes.mjs                     # dry run (default)
 *   node tools/migrate-dice-outcomes.mjs --apply             # write
 *   node tools/migrate-dice-outcomes.mjs --worlds whitechapel,whitechapel-jp
 *   node tools/migrate-dice-outcomes.mjs --snapshot          # step 0 only
 *
 * Default is a DRY RUN. The migration changes 24 tracked world files and its
 * contract requires coordinating with the in-flight bilingual authors (§3.3), so
 * the safe mode is the one you get by accident.
 *
 * ── What it refuses, and why (§3.5 / §3.6, M-4) ──────────────────────────────
 * ANY path under `archive/` or `worlds/` exits non-zero. The archive holds the
 * pre-bilingual templates whose content hashes are recorded in
 * `archive-manifest.json` AND which are fixtures for the probes and asset tests
 * — editing them breaks hashes and test baselines at once, and the archived
 * `whitechapel-playtest` is a 2d10 world while the live one is 1d100, so a
 * sweep would silently merge two different rules. `worlds/` holds PLAYER SAVES,
 * which are untracked: no script can reach them, and any script that tries is
 * one keystroke from unrecoverable damage. Both are covered by route C's
 * read-time expansion instead (`legacy-dice-outcomes.ts`).
 *
 * ── Idempotence (§12, M-8) ───────────────────────────────────────────────────
 * A card that already declares `on.roll_resolved`, or a command file whose bytes
 * already match, is SKIPPED. Running twice prints `0 files changed` the second
 * time and leaves every byte alone.
 */
import fs from 'node:fs/promises';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

import { parseFrontmatter, stringifyFrontmatter } from '../packages/shared/dist/index.js';
import { parseOnBindings } from '../packages/shared/dist/commands/bindings.js';
import {
  expandDiceOutcomes,
  INVESTIGATION_OUTCOME_COMMAND_YAML,
} from '../packages/shared/dist/commands/legacy-dice-outcomes.js';

const REPO = fileURLToPath(new URL('../', import.meta.url));
const COMMAND_ID = 'investigation-outcome';
const ARTIFACTS = path.join(REPO, '.artifacts');

/** Paths no invocation may touch, whatever the caller passes (`08` §3.5/§3.6). */
const FORBIDDEN_ROOTS = ['archive', 'worlds'];

/* ────────────────────────────────────────────────────────────────────────────
 * Argument parsing + the path gate
 * ──────────────────────────────────────────────────────────────────────────── */
function parseArgs(argv) {
  const options = { apply: false, snapshotOnly: false, worlds: null, paths: [], root: REPO };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--apply') options.apply = true;
    else if (arg === '--dry-run') options.apply = false;
    else if (arg === '--snapshot') options.snapshotOnly = true;
    else if (arg === '--worlds') options.worlds = (argv[++i] ?? '').split(',').filter(Boolean);
    // `--root` exists so a caller can dry-run (or apply) against a COPY of the
    // templates tree — the only way to prove idempotence (M-8) without writing
    // to the real world files. It changes where files are read/written, never
    // what the forbidden-path gate protects.
    else if (arg === '--root') options.root = path.resolve(argv[++i] ?? '');
    else if (arg === '--help' || arg === '-h') return { help: true };
    else if (arg.startsWith('--')) return { error: `unknown option "${arg}"` };
    else options.paths.push(arg);
  }
  return { options };
}
/**
 * The M-4 gate. Returns the offending path, or `null` when every path is legal.
 *
 * Normalises before comparing so the gate is not defeated by `./archive/x`,
 * `archive/../archive/x`, an absolute path into the repo's archive, or a
 * backslash — a check that only matched the literal prefix `archive/` would pass
 * all four while the write went to the forbidden tree.
 */
export function forbiddenReason(target, root = REPO) {
  const rel = path.relative(root, path.resolve(root, target)).split(path.sep).join('/');
  for (const forbidden of FORBIDDEN_ROOTS) {
    if (rel === forbidden || rel.startsWith(`${forbidden}/`)) return forbidden;
  }
  return null;
}

/* ────────────────────────────────────────────────────────────────────────────
 * Step 0 — freeze the baseline (§3.1)
 * ──────────────────────────────────────────────────────────────────────────── */

/**
 * `git rev-parse HEAD` plus the before-inventory, into `.artifacts/`.
 *
 * §3.1 is explicit about the cost of skipping this: after the migration there is
 * no way to prove WHICH files changed and which were deliberately left alone,
 * and `origin/the team`'s merge lost 8 i18n keys and 21 `voice:` fields that were
 * only found by hand-counting later.
 *
 * `git ls-files` is used rather than a `grep` so the inventory is the set of
 * TRACKED cards: an untracked scratch copy in `templates/` would otherwise enter
 * the baseline and look like a silently dropped file afterwards.
 */
async function freezeBaseline(root = REPO) {
  // `git ls-files` against the real checkout is the honest inventory; against a
  // `--root` copy it is meaningless (the copy is untracked), so the copy is
  // walked instead. Either way the list is CANDIDATE cards only — an untracked
  // scratch card in the real tree must not enter the baseline and later look
  // like a silently dropped file.
  const tracked =
    root === REPO
      ? execFileSync('git', ['ls-files', 'templates'], { cwd: REPO })
          .toString()
          .split('\n')
          .filter((f) => f.endsWith('/04-investigation-dice.md'))
          .sort()
      : (await candidateCards(null, root))
          .map((card) => path.relative(root, card.path).split(path.sep).join('/'))
          .filter((f) => f.endsWith('/04-investigation-dice.md'))
          .sort();

  const head = root === REPO ? execFileSync('git', ['rev-parse', 'HEAD'], { cwd: REPO }).toString().trim() : '(unversioned copy)';
  // Scoped to the root: §3.1 wants the baseline beside the world it describes, and
  // a sandbox run must not overwrite the real tree's registration.
  const artifacts = path.join(root, '.artifacts');
  await fs.mkdir(artifacts, { recursive: true });
  const before = [];
  for (const file of tracked) {
    const parsed = parseFrontmatter(await fs.readFile(path.join(root, file), 'utf8'));
    before.push({
      path: file,
      bands: Array.isArray(parsed.frontmatter?.dice_outcomes) ? parsed.frontmatter.dice_outcomes.length : 0,
      hasOn: parsed.frontmatter?.on !== undefined,
    });
  }

  await fs.writeFile(
    path.join(artifacts, 'dice-migration-before.json'),
    `${JSON.stringify({ head, at: new Date().toISOString(), files: before }, null, 2)}\n`
  );
  await fs.writeFile(path.join(artifacts, 'dice-inventory-before.txt'), `${before.map((f) => f.path).join('\n')}\n`);
  console.log(`Step 0: froze baseline at ${head} — ${before.length} candidate cards in .artifacts/`);
  return before;
}

/* ────────────────────────────────────────────────────────────────────────────
 * Step 2 — append `on` per card, write the shared command per world
 * ──────────────────────────────────────────────────────────────────────────── */

/**
 * Every candidate card, in a stable order.
 *
 * The shape `templates/<world>/world/**\/04-investigation-dice.md` is enforced by
 * the suffix test AND the path-root check, so a card someone moves to
 * `templates/<world>/04-investigation-dice.md` (outside `world/`) is not silently
 * picked up with a different relative path.
 */
async function candidateCards(worldFilter, root = REPO) {
  const templates = path.join(root, 'templates');
  const worlds = (await fs.readdir(templates, { withFileTypes: true }))
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .filter((name) => worldFilter === null || worldFilter.includes(name))
    .sort();

  const cards = [];
  for (const world of worlds) {
    const base = path.join(templates, world);
    for (const file of await walk(base)) {
      if (!file.endsWith('/04-investigation-dice.md')) continue;
      if (!file.includes(`${path.sep}world${path.sep}`)) continue;
      cards.push({ world, path: file });
    }
  }
  return cards;
}

async function walk(dir) {
  const out = [];
  for (const entry of (await fs.readdir(dir, { withFileTypes: true })).sort((a, b) => a.name.localeCompare(b.name))) {
    if (entry.name === '.DS_Store') continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...(await walk(full)));
    else if (entry.isFile()) out.push(full);
  }
  return out;
}

/**
 * The `on:` block for one card, as YAML text appended to its frontmatter.
 *
 * Only the `roll_resolved` key is emitted. The bands come from the SHARED
 * expansion (`legacy-dice-outcomes.ts`), so the migration's `on` and route C's
 * read-time synthesis are the same tree by construction — the M-1 property,
 * guaranteed rather than tested into existence.
 */
function onBlockText(on) {
  const lines = ['on:', '  roll_resolved:'];
  for (const binding of on.roll_resolved) {
    lines.push(`    - when: "${binding.when}"`);
    lines.push(`      run: ${binding.run}`);
    lines.push(`      from: ${binding.from}`);
    lines.push('      with:');
    for (const [name, value] of Object.entries(binding.with)) {
      lines.push(`        ${name}: ${typeof value === 'number' ? value : `"${value}"`}`);
    }
  }
  return `${lines.join('\n')}\n`;
}

/**
 * Migrate one card. Returns the new content, or `null` when the file is already
 * migrated (idempotence — the file's own `on.roll_resolved` is the marker).
 */
function migrateCard(raw, relPath) {
  const parsed = parseFrontmatter(raw);
  if (parsed.frontmatter === null) return { error: `${relPath}: no frontmatter block to extend.` };

  const existing = parseOnBindings(parsed.frontmatter, null);
  if (parsed.frontmatter.on !== undefined) {
    // Already carries `on`: either a previous run of this script or an author's
    // own block. Either way, appending would duplicate the hook and the card
    // would run its consequence twice — never do it.
    if (existing.errors.length > 0) {
      return {
        error: `${relPath}: already declares "on", but it does not parse: ${existing.errors.map((e) => e.message).join(' ')}`,
      };
    }
    return { skipped: `${relPath}: already declares "on" — left untouched.` };
  }

  const expanded = expandDiceOutcomes(parsed.frontmatter, relPath);
  if ('errors' in expanded) return { error: expanded.errors.map((e) => e.message).join(' ') };

  // Round-trip through the frontmatter serializer so the block lands in the same
  // canonical shape the rest of the pipeline emits, then the body is appended
  // verbatim — the file's prose is never rewritten.
  const frontmatterText = stringifyFrontmatter(parsed.frontmatter, parsed.body);
  const close = frontmatterText.indexOf('\n---\n', 3);
  if (!frontmatterText.startsWith('---\n') || close === -1) {
    return { error: `${relPath}: could not locate the frontmatter delimiter after serializing.` };
  }
  const withOn = `${frontmatterText.slice(0, close)}\n${onBlockText(expanded.on)}${frontmatterText.slice(close)}`;
  return { content: withOn };
}

async function migrate(options) {
  const root = options.root;
  const cards = await candidateCards(options.worlds, root);
  const changed = [];
  const skipped = [];
  const failed = [];

  for (const card of cards) {
    const rel = path.relative(root, card.path).split(path.sep).join('/');
    const refusal = forbiddenReason(rel, root);
    if (refusal !== null) {
      failed.push(`${rel}: under "${refusal}/", which this script MUST NOT touch (§3.5/§3.6).`);
      continue;
    }
    const raw = await fs.readFile(card.path, 'utf8');
    const result = migrateCard(raw, rel);
    if (result.error !== undefined) failed.push(result.error);
    else if (result.skipped !== undefined) skipped.push(result.skipped);
    else if (result.content === raw) skipped.push(`${rel}: already identical.`);
    else {
      changed.push(rel);
      if (options.apply) await fs.writeFile(card.path, result.content);
    }
  }

  // The shared command, one per world that has cards (`08 §4.2`).
  const worldsWithCards = [...new Set(cards.map((card) => card.world))].sort();
  for (const world of worldsWithCards) {
    const rel = `templates/${world}/command/${COMMAND_ID}.yaml`;
    const target = path.join(root, rel);
    const refusal = forbiddenReason(rel, root);
    if (refusal !== null) {
      failed.push(`${rel}: under "${refusal}/", which this script MUST NOT touch.`);
      continue;
    }
    let current = null;
    try {
      current = await fs.readFile(target, 'utf8');
    } catch {
      current = null;
    }
    if (current === INVESTIGATION_OUTCOME_COMMAND_YAML) skipped.push(`${rel}: already identical.`);
    else {
      changed.push(rel);
      if (options.apply) {
        await fs.mkdir(path.dirname(target), { recursive: true });
        await fs.writeFile(target, INVESTIGATION_OUTCOME_COMMAND_YAML);
      }
    }
  }

  for (const line of skipped) console.log(`skip  ${line}`);
  for (const line of failed) console.error(`FAIL  ${line}`);
  console.log(
    `${options.apply ? 'Applied' : 'Dry run'}: ${changed.length} files changed, ` +
      `${skipped.length} unchanged, ${failed.length} refused (of ${cards.length} cards).`
  );
  if (!options.apply && changed.length > 0) console.log('(no file was written — pass --apply to write)');
  return { changed, skipped, failed };
}

/* ────────────────────────────────────────────────────────────────────────────
 * Entry
 * ──────────────────────────────────────────────────────────────────────────── */

export async function main(argv) {
  const parsed = parseArgs(argv);
  if (parsed.help) {
    console.log(
      'Usage: node tools/migrate-dice-outcomes.mjs [--apply] [--snapshot] [--worlds a,b] [--root DIR]'
    );
    return 0;
  }
  if (parsed.error !== undefined) {
    console.error(`migrate-dice-outcomes: ${parsed.error}`);
    return 2;
  }
  const { options } = parsed;

  // The path gate runs BEFORE any I/O: a caller naming a forbidden path must get
  // a non-zero exit AND no partial write (M-4). Explicit arguments and world
  // names are both checked; a world that does not exist simply yields no cards.
  for (const candidate of [...options.paths, ...(options.worlds ?? [])]) {
    const refusal = forbiddenReason(candidate, options.root);
    if (refusal !== null) {
      console.error(
        `migrate-dice-outcomes: refusing "${candidate}" — it is under "${refusal}/". ` +
          `Archived worlds and player saves are covered by the read-time expansion ` +
          `(packages/shared/src/commands/legacy-dice-outcomes.ts), never by a rewrite.`
      );
      return 1;
    }
  }

  await freezeBaseline(options.root);
  if (options.snapshotOnly) return 0;

  const { failed } = await migrate(options);
  return failed.length > 0 ? 1 : 0;
}

const invokedDirectly = process.argv[1] !== undefined && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (invokedDirectly) {
  try {
    process.exitCode = await main(process.argv.slice(2));
  } catch (err) {
    console.error(`migrate-dice-outcomes: ${err.stack ?? err.message}`);
    process.exitCode = 1;
  }
}
