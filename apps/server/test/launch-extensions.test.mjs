// Launch-spec regression.
//
// The canvas-arranger used to be a separate pi-rp process with an isolated
// extension (extensions/canvas-arranger.ts) registering `view_canvas` /
// `screenshot_canvas` / `arrange_canvas`. Since the 2026-09-18 de-agenting
// ruling the arrangement runs in-process (canvas-arranger-lifecycle.ts) and
// that extension is deleted: `extensionArgs` discovers every `.ts` under
// `extensions/` for the Writer and Character launches, so a reintroduced
// tool-defining file that also exists in `tools.ts` would still make pi-rp
// throw `Tool … conflicts with …` and fail EVERY agent launch.
//
// These assertions defend the observable contract: no launch's extension set
// registers the same tool name twice, and `arrange_canvas` stays a
// server-internal action that no agent tool surface exposes.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const VENDOR_CLI = path.join(REPO_ROOT, 'vendor', 'pi-rp', 'packages', 'coding-agent', 'dist', 'cli.js');
const rel = (abs) => path.relative(REPO_ROOT, abs).split(path.sep).join('/');

const { extensionArgs } = await import(
  path.join(REPO_ROOT, 'apps/server/dist/engine/presets.js')
);
const { characterLaunch, writerLaunch } = await import(
  path.join(REPO_ROOT, 'apps/server/dist/engine/launch.js')
);

/** `--extension` targets of one launch spec, repo-relative and sorted. */
function extensionTargets(spec) {
  const out = [];
  for (let i = 0; i < spec.args.length; i += 1) {
    if (spec.args[i] === '--extension') out.push(rel(spec.args[i + 1]));
  }
  return out.sort();
}

/** Tools a tool definition registers are its `name`; read them off the source. */
function registeredToolNames(file) {
  const src = fs.readFileSync(path.join(REPO_ROOT, file), 'utf-8');
  return [...src.matchAll(/\{\s*name:\s*'([a-z_]+)',\s*tool:/g)].map((m) => m[1]);
}

test('no two extensions loaded by one agent define the same tool name', () => {
  const world = path.join(REPO_ROOT, 'templates', 'wuwu');
  const specs = {
    writer: writerLaunch(REPO_ROOT, world, VENDOR_CLI),
    character: characterLaunch(REPO_ROOT, world, VENDOR_CLI, 'vera'),
  };
  for (const [label, spec] of Object.entries(specs)) {
    const owners = new Map();
    for (const target of extensionTargets(spec)) {
      assert.ok(
        fs.statSync(path.join(REPO_ROOT, target), { throwIfNoEntry: false })?.isFile(),
        `${label}: extension target ${target} does not exist`
      );
      for (const tool of registeredToolNames(target)) {
        const previous = owners.get(tool);
        assert.ok(
          !previous || previous === target,
          `${label}: tool "${tool}" is registered by both ${previous} and ${target} — pi-rp throws on the duplicate and the agent cannot boot`
        );
        owners.set(tool, target);
      }
    }
  }
});

test('arrange_canvas is intent-only: no fence or coordinate parameters may return', () => {
  const generic = extensionArgs(REPO_ROOT).map((p, i, arr) => (arr[i - 1] === '--extension' ? rel(p) : null)).filter(Boolean);
  const owners = new Set();
  for (const target of generic) {
    for (const tool of registeredToolNames(target)) owners.add(tool);
  }
  assert.ok(
    owners.has('arrange_canvas'),
    'arrange_canvas must stay on the agent tool surface: writer/character agents initiate arrangement (2026-09-18 third ruling); only the dedicated arranger agent process was removed'
  );
  // The tool states intent — the server owns fences and coordinates. If any of
  // these names return to the schema, the fence-courier anti-pattern is back.
  const FORBIDDEN = ['expectedRevision', 'expectedCanvasVersion', 'snapshotId', 'operationId', 'policy', 'allowMoveStableCards'];
  const schemaText = fs.readFileSync(path.join(REPO_ROOT, 'extensions', 'toolkit', 'arrange-canvas.ts'), 'utf8');
  for (const name of FORBIDDEN) {
    assert.ok(
      !schemaText.includes(`'${name}'`) && !new RegExp(`\\b${name}:\\s*Type\\.`).test(schemaText),
      `arrange_canvas schema must not expose "${name}" — the server mints fences and coordinates itself`
    );
  }
  assert.ok(
    !fs.existsSync(path.join(REPO_ROOT, 'extensions', 'canvas-arranger.ts')),
    'extensions/canvas-arranger.ts was deleted by the de-agenting ruling; reintroducing it without a generic-scan exclusion will duplicate view_canvas/screenshot_canvas in writer/character processes'
  );
});
