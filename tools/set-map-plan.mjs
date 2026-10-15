#!/usr/bin/env node
// Write a layer's planned map (`map.plan`, the design notes) into every edition of a
// world family at once, so the English, Chinese and Japanese READMEs never
// drift (check:worlds compares them).
//
//   node tools/set-map-plan.mjs <spec.json>
//
// spec.json:
//   { "family": "wuwu",
//     "layers": { "world/harbor-chart": { "picture": "assets/maps/harbor-chart.webp",
//                                         "pins": { "old-lighthouse": [0.18, 0.22] } } } }
//
// Editions are templates/<family>, templates/<family>-zh, templates/<family>-jp
// (whichever exist). Any existing `plan:` under `map:` is replaced; `map.pins`
// (the scene picture's pins) is left alone. The frontmatter is edited as text
// so every other line keeps its exact form.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repo = fileURLToPath(new URL('../', import.meta.url));
const spec = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));
const editions = [spec.family, `${spec.family}-zh`, `${spec.family}-jp`]
  .map(id => path.join(repo, 'templates', id))
  .filter(dir => fs.existsSync(path.join(dir, 'world.json')));
if (editions.length === 0) throw new Error(`no editions for ${spec.family}`);

const num = n => {
  if (typeof n !== 'number' || !(n >= 0 && n <= 1)) throw new Error(`pin coordinate out of 0..1: ${n}`);
  return String(Math.round(n * 1000) / 1000);
};

function planBlock({ picture, pins }) {
  if (!/^assets\/[\w./-]+\.(webp|png|jpe?g)$/i.test(picture)) throw new Error(`bad picture path ${picture}`);
  const lines = ['  plan:', `    picture: ${picture}`, '    pins:'];
  for (const [key, [x, y]] of Object.entries(pins)) lines.push(`      ${key}: [${num(x)}, ${num(y)}]`);
  return lines;
}

function apply(text, plan) {
  const m = text.match(/^---\n([\s\S]*?)\n---\n/);
  if (!m) throw new Error('no frontmatter');
  let lines = m[1].split('\n');
  const mapAt = lines.findIndex(line => line === 'map:');
  const block = planBlock(plan);
  if (mapAt === -1) {
    lines.push('map:', ...block);
  } else {
    // The map block runs until the next top-level key.
    let end = mapAt + 1;
    while (end < lines.length && (lines[end].startsWith(' ') || lines[end] === '')) end++;
    const body = lines.slice(mapAt + 1, end);
    // Drop an existing plan (its lines are indented deeper than two spaces).
    const kept = [];
    for (let i = 0; i < body.length; i++) {
      if (body[i] === '  plan:') { i++; while (i < body.length && body[i].startsWith('    ')) i++; i--; continue; }
      kept.push(body[i]);
    }
    lines = [...lines.slice(0, mapAt + 1), ...kept, ...block, ...lines.slice(end)];
  }
  return `---\n${lines.join('\n')}\n---\n${text.slice(m[0].length)}`;
}

for (const dir of editions) {
  for (const [layer, plan] of Object.entries(spec.layers)) {
    const file = path.join(dir, layer, 'README.md');
    fs.writeFileSync(file, apply(fs.readFileSync(file, 'utf8'), plan));
  }
  console.log(`${path.basename(dir)}: ${Object.keys(spec.layers).length} layers`);
}
