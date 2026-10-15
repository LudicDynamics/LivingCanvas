/**
 * Creation-mode art in a world directory: every
 * README / card that declares `art:` must match the strict schema. A world
 * that declares no `art` has nothing to check — the block is optional, and the
 * runtime reads it leniently (`artOf`); only a template that CHOSE to declare
 * it is held to the shape here. The pictures themselves may not exist yet: a
 * prompt is written before its picture is painted.
 *
 * Used by `check:worlds` for every template, experimental ones included.
 */
import fs from 'node:fs/promises';
import path from 'node:path';
import { artErrors, parseFrontmatter } from '../packages/shared/dist/index.js';

async function walk(root, dir) {
  const out = [];
  let entries = [];
  try { entries = await fs.readdir(path.join(root, dir), { withFileTypes: true }); } catch { return out; }
  for (const entry of entries) {
    const rel = `${dir}/${entry.name}`;
    if (entry.isDirectory()) out.push(...await walk(root, rel));
    else if (entry.name.endsWith('.md')) out.push(rel);
  }
  return out;
}

/** Every `art:` problem under world/, characters/ and endings/, as `file: message` lines. */
export async function artProblems(root) {
  const problems = [];
  for (const file of [...await walk(root, 'world'), ...await walk(root, 'characters'), ...await walk(root, 'endings')]) {
    let fm = null;
    try { fm = parseFrontmatter(await fs.readFile(path.join(root, file), 'utf8')).frontmatter; } catch { continue; }
    for (const message of artErrors(fm)) problems.push(`${file}: ${message}`);
  }
  return problems;
}
