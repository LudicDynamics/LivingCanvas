import fs from 'node:fs';
import path from 'node:path';

/**
 * "This save has already had its opening" — one boolean beside the save
 * (`<worldRoot>/.airpworld/opening.json`), mirroring `world-settings.ts`.
 *
 * Why a file and not localStorage: the opening belongs to the
 * SAVE, not to the browser. A player who opens the same save on another device
 * has already met the greeter; a player who starts a new save has not. A
 * storage flag answers "has this browser seen an opening", which is a different
 * question and would replay the greeting on a second device while suppressing
 * it on a fresh save in the first.
 *
 * It is NOT world content and NOT a second source of truth: nothing reads it to
 * decide what is in the world, it lands no event, and deleting it only means
 * the greeting plays again. `.airpworld/` is exactly the drawer for that.
 *
 * User-editable, therefore untrusted: anything malformed reads as "not shown"
 * (fail-soft — replaying a greeting is harmless, wedging a route is not).
 */
export interface OpeningState {
  /** True once the greeting + tutorial have run for this save. */
  shown: boolean;
  /** When it ran, for debugging; never read back as truth. */
  at?: string;
}

const FILE = '.airpworld/opening.json';

export function readOpening(worldRoot: string): OpeningState {
  try {
    const raw: unknown = JSON.parse(fs.readFileSync(path.join(worldRoot, FILE), 'utf8'));
    if (typeof raw !== 'object' || raw === null) return { shown: false };
    const shown = (raw as { shown?: unknown }).shown;
    const at = (raw as { at?: unknown }).at;
    return { shown: shown === true, ...(typeof at === 'string' ? { at } : {}) };
  } catch {
    return { shown: false };
  }
}

/** Atomic like `writeWorldSettings`: a half-written marker must not be readable. */
export function writeOpening(worldRoot: string, shown: boolean): OpeningState {
  const next: OpeningState = shown ? { shown: true, at: new Date().toISOString() } : { shown: false };
  const dir = path.join(worldRoot, '.airpworld');
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, 'opening.json');
  fs.writeFileSync(`${file}.tmp`, JSON.stringify(next, null, 2) + '\n');
  fs.renameSync(`${file}.tmp`, file);
  return next;
}
