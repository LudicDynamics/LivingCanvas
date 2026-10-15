/**
 * Which world templates this copy of the repository carries.
 *
 * The open-source copy ships only some of the worlds (the rest are listed
 * `export-ignore` in the private repository's .gitattributes). A test that
 * reads one particular world asks here first and is skipped, with the reason,
 * when that world is not in this copy; in the full repository every world is
 * present and every such test runs.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const TEMPLATES_DIR = fileURLToPath(new URL('../templates/', import.meta.url));

/** Is `templates/<id>` (with its world.json) in this copy? */
export const templateShipped = (id, root = TEMPLATES_DIR) => fs.existsSync(path.join(root, id, 'world.json'));

/**
 * For `test(name, { skip }, …)`: false when every one of `ids` is here,
 * else the reason the test is skipped.
 */
export function skipUnlessShipped(...ids) {
  const missing = ids.flat().filter((id) => !templateShipped(id));
  return missing.length ? `templates/${missing.join(', templates/')} not in this copy (the open-source release carries only some worlds)` : false;
}

/** Keep only the ids whose template is in this copy. */
export const shippedOnly = (ids) => ids.filter((id) => templateShipped(id));

/**
 * A whole test file built on one world as its fixture: `const test = testsNeeding(nodeTest, 'seven-days-inn-zh')`
 * returns node:test's `test` unchanged where the world is here, else one that skips every test with the reason.
 */
export function testsNeeding(test, ...ids) {
  const skip = skipUnlessShipped(...ids);
  if (!skip) return test;
  return (name, ...rest) => {
    const fn = rest.pop();
    return test(name, { ...(rest[0] ?? {}), skip }, fn);
  };
}
