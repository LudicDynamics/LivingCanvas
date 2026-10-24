#!/usr/bin/env node
/**
 * One-stop workflow for the `vendor/pi-rp` submodule: status / init / build / update / commit.
 *
 *   pnpm pi status                          Both repos at a glance (drift shows up here first)
 *   pnpm pi init                            First-time vendoring (submodule add + track main)
 *   pnpm pi build                           Rebuild dist only (HEAD unchanged, runtime stale)
 *   pnpm pi update [--no-build] [--no-push] Pull pi-rp origin/main -> build -> bump our pointer
 *   pnpm pi commit <msg> [--no-build] [--no-push]
 *                                           build (red line) -> submodule commit+push -> pointer commit+push
 *   pnpm pi snapshot                        Keep the current (compiling) model data as tools/pi-model-data
 *
 * Two invariants this tool exists to enforce (both have already bitten us):
 *
 *  1. **dist is a local artifact.** `vendor/pi-rp/packages/*\/dist/` is gitignored, so it does
 *     NOT travel with the submodule pointer. The server and the probe run `dist/cli.js`; when
 *     HEAD moves and dist does not, the runtime keeps executing the old build with no warning
 *     at all. Every path that moves HEAD therefore rebuilds.
 *  2. **The pointer must equal the submodule HEAD.** Committing a pointer while HEAD has
 *     drifted (stale local main, a leftover manual checkout) launders the drift into what looks
 *     like a deliberate bump. `verifyPointerAligned` refuses instead.
 *
 * Ported from an earlier Worldlines project `tools/pi-rp.mjs` (same submodule, same two traps).
 */

import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { matchesSnapshot, replaceData, SNAPSHOT_DIR, snapshotDate } from './pi-model-snapshot.mjs';

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const SUB = path.join(ROOT, 'vendor', 'pi-rp');
const SUB_PATH = 'vendor/pi-rp';
const SUB_URL = 'https://github.com/2722550596/pi-rp.git';
/** Fixed so the pointer bumps stay greppable in the log. */
const PTR_MSG = 'chore: update pi-rp submodule ref';
/** pi-rp's gitignored model data (generated from models.dev); tools/pi-model-snapshot.mjs keeps a compiling copy. */
const MODEL_DATA = path.join(SUB, 'packages', 'ai', 'src', 'providers', 'data');

// --- helpers ---------------------------------------------------------------

function run(cmd, args, opts = {}) {
  const r = spawnSync(cmd, args, { cwd: opts.cwd ?? ROOT, stdio: 'inherit', env: process.env });
  if (r.error) die(`${cmd} ${args.join(' ')} failed to start: ${r.error.message}`);
  if (r.status !== 0) {
    if (opts.hint) console.error(`  ${opts.hint}`);
    die(`${cmd} ${args.join(' ')} exited with ${r.status}`);
  }
  return r;
}

function capture(cmd, args, opts = {}) {
  const r = spawnSync(cmd, args, { cwd: opts.cwd ?? ROOT, encoding: 'utf8' });
  return r.status === 0 && !r.error ? r.stdout.trim() : '';
}

function die(msg) {
  console.error(`x ${msg}`);
  process.exit(1);
}

function ensureSub() {
  if (!existsSync(SUB)) die(`${SUB_PATH} is missing - run: pnpm pi init`);
}

function subDirty() {
  return capture('git', ['status', '--porcelain'], { cwd: SUB }) !== '';
}

function subBranch() {
  return capture('git', ['rev-parse', '--abbrev-ref', 'HEAD'], { cwd: SUB });
}

function ensureOnMain() {
  if (subBranch() !== 'main') {
    console.log(`- ${SUB_PATH} is on a detached HEAD, switching back to main`);
    run('git', ['checkout', 'main'], { cwd: SUB });
  }
}

/**
 * The build red line. `build:offline` lives in the vendor ROOT package.json (the pi-rp
 * monorepo), not inside the coding-agent package, and it fails at `check:model-data`
 * unless the gitignored model data is in place. That data used to be fetched from
 * models.dev LIVE, so a new upstream model could break the type check of an unchanged
 * submodule (2026-10-19: opencode-go gained a google-generative-ai model → TS2322, the
 * canvas release and every fresh worktree's build blocked) — and `check:model-data`
 * still calls such data valid. So the build uses the known-good snapshot
 * (tools/pi-model-data, tools/pi-model-snapshot.mjs) and never fetches by itself:
 *
 *   - default: install the snapshot (if the data differs or is missing), build. Only
 *     when the snapshot no longer fits this pi-rp (a submodule bump changed the
 *     provider structure: `check:model-data` fails) is models.dev fetched.
 *   - AIRP_PI_HYDRATE=1: fetch models.dev, build; when that data does not compile, put
 *     the snapshot back and build with it. Keep good new data with `pnpm pi snapshot`.
 */
function modelDataValid() {
  return spawnSync('npm', ['--prefix', 'packages/ai', 'run', '--silent', 'check:model-data'], { cwd: SUB, stdio: 'ignore' }).status === 0;
}

function buildOffline() {
  return spawnSync('npm', ['run', 'build:offline'], { cwd: SUB, stdio: 'inherit', env: process.env }).status === 0;
}

function useSnapshot() {
  if (matchesSnapshot(MODEL_DATA)) return;
  replaceData(SNAPSHOT_DIR, MODEL_DATA);
  console.log(`- model data: installed the known-good snapshot (tools/pi-model-data, generated ${snapshotDate() || 'unknown'})`);
}

function buildPi(noBuild) {
  if (noBuild) {
    console.log('- --no-build: skipping the rebuild (docs-only changes that cannot affect the runtime)');
    return;
  }
  const tsgo = path.join(SUB, 'node_modules', '.bin', 'tsgo');
  if (!existsSync(tsgo)) {
    die(
      `${SUB_PATH} is missing its root toolchain (tsgo et al) - run: cd ${SUB_PATH} && npm install` +
        '\n  (in the vendor root, and never with --ignore-scripts)'
    );
  }
  let fetched = false;
  if (process.env.AIRP_PI_HYDRATE === '1') {
    console.log('- AIRP_PI_HYDRATE=1: npm run hydrate:model-data (fetches the model list from models.dev)');
    run('npm', ['run', 'hydrate:model-data'], { cwd: SUB });
    fetched = true;
  } else {
    useSnapshot();
    if (!modelDataValid()) {
      console.log('! the snapshot does not fit this pi-rp (check:model-data fails: the submodule moved on) - fetching models.dev');
      run('npm', ['run', 'hydrate:model-data'], { cwd: SUB });
      fetched = true;
    }
  }
  console.log('- npm run build:offline (red line: dist is not committed, but the runtime runs it)');
  if (buildOffline()) {
    if (fetched) console.log('- the fetched model data compiles: `pnpm pi snapshot` keeps it as the new snapshot');
    return;
  }
  if (!fetched) die('npm run build:offline exited with an error (on the known-good snapshot: a source problem, not the model list)');
  console.error('! the model data fetched from models.dev does not compile - going back to the snapshot');
  replaceData(SNAPSHOT_DIR, MODEL_DATA);
  if (!modelDataValid()) {
    die('the snapshot does not fit this pi-rp either: fix the generated data (or pi-rp) by hand, then `pnpm pi snapshot`');
  }
  console.log('- npm run build:offline (on the snapshot)');
  if (!buildOffline()) die('npm run build:offline exited with an error on the snapshot too');
  console.error('! built on the snapshot; the newer models.dev data was NOT used');
}

/**
 * Refuse to record a pointer that does not match the submodule HEAD. A mismatch means the
 * checkout drifted (local main behind, or a manual checkout left over from an experiment);
 * committing it would launder the drift into a normal-looking bump.
 */
function verifyPointerAligned() {
  const headFull = capture('git', ['rev-parse', 'HEAD'], { cwd: SUB });
  const ptrFull = capture('git', ['ls-tree', 'HEAD', SUB_PATH]).split(/\s+/)[2] ?? '';
  if (ptrFull && ptrFull !== headFull) {
    die(
      `submodule HEAD (${headFull.slice(0, 8)}) != recorded pointer (${ptrFull.slice(0, 8)}) - align first:\n` +
        `  git -C ${SUB_PATH} checkout main && git -C ${SUB_PATH} merge --ff-only origin/main   # when main has no local-only commits\n` +
        `  git -C ${SUB_PATH} checkout --detach ${ptrFull}                                       # temporary alignment only\n` +
        `  then rebuild: pnpm pi build`
    );
  }
}

/** Record the new pointer in this repo (skipped when unchanged), self-check, push. */
function commitPointer(noPush) {
  if (capture('git', ['status', '--porcelain', '--', SUB_PATH]) === '') {
    console.log('- submodule pointer unchanged, nothing to commit here');
  } else {
    run('git', ['add', SUB_PATH]);
    run('git', ['commit', '-m', PTR_MSG]);
  }
  verifyPointerAligned();
  if (!noPush) {
    run('git', ['push'], { hint: 'push failed? check that this repo has a remote configured' });
    console.log('- this repo pushed');
  }
}

// --- status ----------------------------------------------------------------

function cmdStatus() {
  if (!existsSync(SUB)) {
    console.log(`${SUB_PATH} is not vendored yet.`);
    console.log('  initialise with: pnpm pi init');
    return;
  }
  const branch = subBranch();
  const headFull = capture('git', ['rev-parse', 'HEAD'], { cwd: SUB });
  const dirty = subDirty();
  const unpushed = capture('git', ['log', '--oneline', 'origin/main..HEAD'], { cwd: SUB });
  const ptrFull = capture('git', ['ls-tree', 'HEAD', SUB_PATH]).split(/\s+/)[2] ?? '';
  const ptrDirty = capture('git', ['status', '--porcelain', '--', SUB_PATH]);

  console.log(`pi-rp     ${branch} @ ${headFull.slice(0, 8)}${dirty ? '   UNCOMMITTED CHANGES' : ''}`);
  if (unpushed) {
    console.log(`          ${unpushed.split('\n').length} commit(s) not pushed to pi-rp's own origin`);
  }
  if (ptrFull) {
    const aligned = ptrFull === headFull;
    console.log(
      `pointer   ${ptrFull.slice(0, 8)}  ${aligned ? 'matches the submodule' : `!= submodule HEAD (pointer ${ptrDirty ? 'uncommitted' : 'behind'})`}`
    );
    if (!aligned) {
      console.log(`  fix: git -C ${SUB_PATH} checkout --detach ${ptrFull}   (then: pnpm pi build)`);
      if (dirty) console.log('  (commit or stash the submodule changes first)');
    }
  }

  // dist freshness: the trap that cost us a day. Compare the newest source file against
  // the built cli entry; a source newer than dist means the runtime is running old code.
  const distCli = path.join(SUB, 'packages/coding-agent/dist/cli.js');
  if (!existsSync(distCli)) {
    console.log('dist      MISSING - run: pnpm pi build');
  } else {
    const newestSrc = capture('bash', [
      '-lc',
      `find ${SUB}/packages/*/src -name '*.ts' -newer ${distCli} -print -quit`,
    ]);
    console.log(newestSrc ? 'dist      STALE (source is newer) - run: pnpm pi build' : 'dist      up to date');
  }
}

// --- init ------------------------------------------------------------------

function cmdInit() {
  if (existsSync(SUB)) die(`${SUB_PATH} already exists`);
  run('git', ['submodule', 'add', SUB_URL, SUB_PATH]);
  console.log('- setting .gitmodules branch = main so collaborators can follow it');
  run('git', ['config', '-f', '.gitmodules', `submodule.${SUB_PATH}.branch`, 'main']);
  run('git', ['add', '.gitmodules', SUB_PATH]);
  console.log('Done. Commit this repo:');
  console.log('  git commit -m "chore: vendor pi-rp"');
}

// --- build -----------------------------------------------------------------

function cmdBuild() {
  ensureSub();
  buildPi(false);
  console.log('Done. dist now matches the checked-out source.');
}

// --- update ----------------------------------------------------------------

function cmdUpdate(opts) {
  ensureSub();
  if (subDirty()) die(`${SUB_PATH} has uncommitted changes - commit or stash before updating`);
  ensureOnMain();
  console.log('- pulling origin/main');
  run('git', ['pull', '--ff-only', 'origin', 'main'], {
    cwd: SUB,
    hint: 'local main ahead or diverged? commit/push first, or merge by hand',
  });
  buildPi(opts.noBuild);
  commitPointer(opts.noPush);
  console.log('Done. Re-run `pnpm build && pnpm probe` before trusting the new engine.');
}

// --- commit ----------------------------------------------------------------

function cmdCommit(msg, opts) {
  ensureSub();
  if (!msg) die('missing commit message: pnpm pi commit "message"');
  ensureOnMain();
  // Checked before building so a drifted checkout fails fast rather than after a long build.
  verifyPointerAligned();
  if (!subDirty()) die(`${SUB_PATH} has no changes to commit`);
  buildPi(opts.noBuild);
  console.log(`- committing in the submodule: ${msg}`);
  run('git', ['add', '-A'], { cwd: SUB });
  run('git', ['commit', '-m', msg], { cwd: SUB });
  if (!opts.noPush) {
    run('git', ['push', 'origin', 'main'], { cwd: SUB });
    console.log("- pushed to pi-rp's origin/main");
  }
  commitPointer(opts.noPush);
  console.log('Done. Re-run `pnpm build && pnpm probe` before trusting the new engine.');
}

// --- snapshot --------------------------------------------------------------

function cmdSnapshot() {
  ensureSub();
  if (!modelDataValid()) die('the current model data fails check:model-data - not keeping it');
  console.log('- npm --prefix packages/ai run build:offline (the data must compile before it becomes the snapshot)');
  run('npm', ['--prefix', 'packages/ai', 'run', 'build:offline'], { cwd: SUB });
  const n = replaceData(MODEL_DATA, SNAPSHOT_DIR);
  console.log(`Done. tools/pi-model-data now holds ${n} files (generated ${snapshotDate() || 'unknown'}); commit it with the pointer.`);
}

// --- main ------------------------------------------------------------------

function usage() {
  console.log(`Usage:
  pnpm pi status
  pnpm pi init
  pnpm pi build
  pnpm pi update [--no-build] [--no-push]
  pnpm pi commit <msg> [--no-build] [--no-push]
  pnpm pi snapshot`);
}

function main() {
  const opts = { noBuild: false, noPush: false };
  const rest = [];
  for (const a of process.argv.slice(2)) {
    if (a === '--no-build') opts.noBuild = true;
    else if (a === '--no-push') opts.noPush = true;
    else rest.push(a);
  }
  const cmd = rest.shift();
  switch (cmd) {
    case 'status':
      cmdStatus();
      break;
    case 'init':
      cmdInit();
      break;
    case 'build':
      cmdBuild();
      break;
    case 'update':
      cmdUpdate(opts);
      break;
    case 'commit':
      cmdCommit(rest.join(' '), opts);
      break;
    case 'snapshot':
      cmdSnapshot();
      break;
    default:
      usage();
      process.exit(cmd ? 1 : 0);
  }
}

main();
