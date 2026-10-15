// pi-rp 36330ab folds extension tools behind `tool_search` once tool
// definitions pass 10% of the context window (tools default to deferrable).
// The play loop the writer must reach for unprompted — above all `search` and
// `trigger_keyword` — must never fold; the rest may, keeping the lean list.
// (Source-level, like tools/read-fence.test.mjs: loading every tool module
// needs the full pi runtime.)
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFile } from 'node:fs/promises';

const src = await readFile(new URL('../../../extensions/tools.ts', import.meta.url), 'utf8');
const eager = new Set([...src.match(/AIRP_EAGER_TOOLS[^=]*= new Set\(\[([\s\S]*?)\]\)/)[1].matchAll(/'([a-z_]+)'/g)].map((m) => m[1]));
const all = new Set([...src.match(/const AIRP_TOOLS[\s\S]*?\n\];/)[0].matchAll(/name: '([a-z_]+)'/g)].map((m) => m[1]));

test('core play tools are registered non-deferrable; housekeeping tools stay foldable', () => {
  for (const name of ['search', 'trigger_keyword', 'chalk', 'roll_dice', 'choose', 'move', 'look_at']) assert.ok(eager.has(name), `${name} must stay visible`);
  for (const name of ['generate_image', 'delete', 'arrange_canvas', 'screenshot_canvas']) assert.ok(!eager.has(name), `${name} may fold`);
  for (const name of eager) assert.ok(all.has(name), `${name} is a real registered tool`);
  assert.match(src, /pi\.registerTool\(AIRP_EAGER_TOOLS\.has\(name\) \? \{ \.\.\.definition, deferrable: false \} : definition\);/);
});
