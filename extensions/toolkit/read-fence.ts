/**
 * read-fence.ts — keep the story agents' eyes inside their world.
 *
 * The security audit of 2026-09-25
 * found that pi-rp's native `read`, `grep`,
 * `find` and `ls` resolve ANY path. An agent runs with the world directory as
 * its cwd, and the repository's `.local.env` — every provider key the player
 * entered — is two directories up. One line of world text or player input
 * telling the agent to read it was enough.
 *
 * So those four tools may only look inside:
 *   - the world directory (the agent's cwd), and
 *   - the repository's `skills/`, because pi-rp tells the model to open skill
 *     files by absolute path and they live outside every world.
 *
 * Everything else is refused with a reason the agent can act on. Symlinks are
 * followed before the check, so a link inside the world cannot point out of
 * it. A path starting with `~` is refused rather than guessed at: pi-rp would
 * expand it to the home directory, which is never inside a world.
 *
 * It also refuses `bash` outright, for every agent that loads this tool face.
 * The presets deny it too, but a character's own `preset.json` shadows the
 * repository's (96 of them across templates, plus a copy inside every save),
 * so a preset edit could never reach them all; a refusal in code does. Nothing
 * in AIRP needs a shell — move, delete and chalk each have an engine tool, and
 * the instructions already call bash a bypass (instructions.ts, toolkit/*).
 *
 * Characters see less than the writer. The
 * rule — which files a character may read, and which frontmatter keys it sees
 * in them — lives in packages/shared/src/rules/character-view.ts; this fence
 * applies it to a character process's file tools:
 *   - `read` / `grep` / `find` / `ls` of a withheld path (command/, endings/,
 *     variants/, engine data, another character's private files) is refused;
 *   - `read` and `grep` results are recomputed over the projected files
 *     (`tool_result`), so `intent`, NPC briefs, hidden states and outcomes are
 *     simply not in what the character reads or searches. The writer's
 *     results are never touched.
 *
 * Subagents: a subagent runs in its parent's process with no extensions of its
 * own, but pi-rp forwards the parent's `tool_call` / `tool_result` handlers to
 * it (vendor/pi-rp/.../subagent/run.ts, `attachSyntheticExtension`), and the
 * role comes from the process environment. So a subagent a character spawns
 * inherits this whole fence — same refusals, same projected reads — and
 * characters keep `subagent`. tools/read-fence.test.mjs pins that forwarding.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  createGrepToolDefinition,
  createReadToolDefinition,
  type ExtensionAPI,
  type GrepOperations,
  type ReadOperations,
} from '@earendil-works/pi-coding-agent';
import { characterViewOf, characterViewText, type Actor } from '../../packages/shared/dist/index.js';
import { agentActor } from './actor.js';

/** The tools this fence watches, and where each keeps its path argument. */
export const FENCED_TOOLS = ['read', 'grep', 'find', 'ls'] as const;

/** The repository's shared skills directory, found from this file's own location. */
export function repoSkillsDir(): string {
  return path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', 'skills');
}

/** Real path of `target`, or of its nearest existing ancestor with the rest re-appended. */
function realish(target: string): string {
  let current = target;
  const tail: string[] = [];
  for (;;) {
    try {
      return path.join(fs.realpathSync(current), ...tail.reverse());
    } catch {
      const parent = path.dirname(current);
      if (parent === current) return target;
      tail.push(path.basename(current));
      current = parent;
    }
  }
}

function inside(child: string, root: string): boolean {
  const relative = path.relative(root, child);
  return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative));
}

/**
 * The paths a call asks to look at, as the model wrote them. `read` takes one
 * path or an array; the other three take an optional `path`, and no path
 * means the cwd — which is inside by definition.
 */
export function requestedPaths(toolName: string, input: Record<string, unknown>): string[] {
  const value = input.path;
  if (typeof value === 'string') return [value];
  if (toolName === 'read' && Array.isArray(value)) return value.filter((entry): entry is string => typeof entry === 'string');
  return [];
}

/**
 * Pure: the first requested path that falls outside every allowed root, or
 * null when all of them are inside. `roots` should already be real paths.
 */
export function firstOutside(requested: readonly string[], cwd: string, roots: readonly string[]): string | null {
  for (const raw of requested) {
    // pi-rp strips a leading `@` (utils/paths.ts); mirror it so `@../x` is judged as `../x`.
    const cleaned = raw.trim().replace(/^@/, '');
    if (cleaned.startsWith('~')) return raw;
    const target = realish(path.resolve(cwd, cleaned));
    if (!roots.some(root => inside(target, root))) return raw;
  }
  return null;
}

/** World-relative POSIX path of `requested` (as the model wrote it), or null when it is outside `cwd`. */
export function worldRelative(requested: string, cwd: string): string | null {
  const cleaned = requested.trim().replace(/^@/, '');
  if (cleaned.startsWith('~')) return null;
  const relative = path.relative(realish(cwd), realish(path.resolve(cwd, cleaned)));
  if (relative.startsWith('..') || path.isAbsolute(relative)) return null;
  return relative.split(path.sep).join('/');
}

/** The first requested path a character may not read, with the reason; null when all are readable. */
export function firstWithheld(
  requested: readonly string[],
  cwd: string,
  characterId: string,
): { path: string; reason: string } | null {
  for (const raw of requested) {
    const relative = worldRelative(raw, cwd);
    if (relative === null) continue; // outside: the directory fence answers that
    const view = characterViewOf(relative, characterId);
    if (view.kind === 'withheld') return { path: raw, reason: view.reason ?? 'it is not part of what you can see' };
  }
  return null;
}

const IMAGE_MIME: Readonly<Record<string, string>> = {
  '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif', '.webp': 'image/webp', '.bmp': 'image/bmp',
};

/** The text of one file as `characterId` reads it; null when withheld. Absolute path in. */
function characterText(cwd: string, characterId: string, absolutePath: string, raw: string): string | null {
  const relative = worldRelative(absolutePath, cwd);
  if (relative === null) return raw;
  return characterViewText(relative, raw, characterId);
}

/** pi-rp read operations that serve every file through the character view. */
export function characterReadOperations(cwd: string, characterId: string): ReadOperations {
  return {
    readFile: async (absolutePath) => {
      const bytes = await fs.promises.readFile(absolutePath);
      if (IMAGE_MIME[path.extname(absolutePath).toLowerCase()]) return bytes;
      const text = characterText(cwd, characterId, absolutePath, bytes.toString('utf8'));
      if (text === null) throw new Error(`${path.basename(absolutePath)} is not something you can read`);
      return Buffer.from(text, 'utf8');
    },
    access: (absolutePath) => fs.promises.access(absolutePath, fs.constants.R_OK),
    detectImageMimeType: async (absolutePath) => IMAGE_MIME[path.extname(absolutePath).toLowerCase()] ?? null,
    stat: (absolutePath) => fs.promises.stat(absolutePath),
    listDirectory: async (absolutePath) =>
      (await fs.promises.readdir(absolutePath, { withFileTypes: true })).map((entry) => ({
        name: entry.name,
        isDirectory: entry.isDirectory(),
      })),
  };
}

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * pi-rp grep operations that search the character view instead of the raw
 * files: withheld files are skipped and projected files are searched (and
 * quoted) as projected, so a match inside `intent` does not exist. Hidden
 * directories are skipped like everything under `.airpworld/`.
 */
export function characterGrepOperations(cwd: string, characterId: string): GrepOperations {
  const textOf = (absolutePath: string): string | null => {
    let raw: string;
    try {
      raw = fs.readFileSync(absolutePath, 'utf8');
    } catch {
      return null;
    }
    if (raw.includes('\0')) return null; // binary
    return characterText(cwd, characterId, absolutePath, raw);
  };
  return {
    isDirectory: (absolutePath) => fs.statSync(absolutePath).isDirectory(),
    readFile: (absolutePath) => textOf(absolutePath) ?? '',
    search: async ({ pattern, path: searchPath, glob, ignoreCase, literal, limit, signal }) => {
      const matcher = new RegExp(literal ? escapeRegExp(pattern) : pattern, ignoreCase ? 'i' : '');
      const matches: Array<{ filePath: string; lineNumber: number }> = [];
      const globMatches = (file: string): boolean => {
        if (!glob) return true;
        const relative = path.relative(searchPath, file).split(path.sep).join('/');
        return path.matchesGlob(relative, glob) || (!glob.includes('/') && path.matchesGlob(path.basename(file), glob));
      };
      const visit = (file: string): boolean => {
        if (signal?.aborted || !globMatches(file)) return false;
        const text = textOf(file);
        if (text === null) return false;
        const lines = text.replace(/\r\n/g, '\n').replace(/\r/g, '\n').split('\n');
        for (let index = 0; index < lines.length; index++) {
          if (!matcher.test(lines[index])) continue;
          matches.push({ filePath: file, lineNumber: index + 1 });
          if (matches.length >= limit) return true;
        }
        return false;
      };
      const walk = (dir: string): boolean => {
        let entries: fs.Dirent[];
        try {
          entries = fs.readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name));
        } catch {
          return false;
        }
        for (const entry of entries) {
          if (entry.name.startsWith('.') || entry.name === 'node_modules') continue;
          const full = path.join(dir, entry.name);
          if (entry.isDirectory()) {
            if (walk(full)) return true;
          } else if (entry.isFile() && visit(full)) return true;
        }
        return false;
      };
      if (fs.statSync(searchPath).isDirectory()) walk(searchPath);
      else visit(searchPath);
      return matches;
    },
  };
}

export interface ReadFenceOptions {
  /** Test seam: the agent identity (default: this process's, toolkit/actor.ts). */
  actor?: Actor;
}

export function registerReadFence(pi: ExtensionAPI, options: ReadFenceOptions = {}): void {
  const skills = realish(repoSkillsDir());
  const actor = (): Actor => options.actor ?? agentActor();
  pi.on('tool_call', async (event, ctx) => {
    if (event.toolName === 'bash') {
      return {
        block: true,
        reason:
          'bash is not available in a world. Use the engine tools instead: chalk to write, move to take or place, ' +
          'delete to remove, look_at or read (inside the world) to look.',
      };
    }
    if (!(FENCED_TOOLS as readonly string[]).includes(event.toolName)) return;
    const cwd = ctx.cwd;
    const outside = firstOutside(
      requestedPaths(event.toolName, event.input as Record<string, unknown>),
      cwd,
      [realish(cwd), skills],
    );
    if (outside !== null) {
      return {
        block: true,
        reason:
          `"${outside}" is outside this world. ${event.toolName} may only look inside the world directory ` +
          `and the shared skills. Use look_at or a relative path inside the world instead.`,
      };
    }
    const who = actor();
    if (who.type !== 'character') return;
    const withheld = firstWithheld(
      requestedPaths(event.toolName, event.input as Record<string, unknown>),
      cwd,
      who.id ?? '',
    );
    if (withheld === null) return;
    return {
      block: true,
      reason:
        `"${withheld.path}" is not something you can see: ${withheld.reason}. ` +
        'You know what you have seen and been told; look_at the scene to see what is in front of you.',
    };
  });

  // A character's read / grep results are recomputed over its view of the
  // world (rules/character-view.ts). The writer's results pass untouched.
  pi.on('tool_result', async (event, ctx) => {
    if (event.isError) return;
    const who = actor();
    if (who.type !== 'character') return;
    const characterId = who.id ?? '';
    const cwd = ctx.cwd;
    if (event.toolName === 'read') {
      const requested = requestedPaths('read', event.input as Record<string, unknown>);
      const projected = requested.some((raw) => {
        const relative = worldRelative(raw, cwd);
        return relative !== null && characterViewOf(relative, characterId).kind !== 'full';
      });
      if (!projected) return;
      const read = createReadToolDefinition(cwd, { operations: characterReadOperations(cwd, characterId) });
      const result = await read.execute(event.toolCallId, event.input as never, undefined, undefined, ctx);
      return { content: result.content, details: result.details };
    }
    if (event.toolName === 'grep') {
      const grep = createGrepToolDefinition(cwd, { operations: characterGrepOperations(cwd, characterId) });
      const result = await grep.execute(event.toolCallId, event.input as never, undefined, undefined, ctx);
      return { content: result.content, details: result.details };
    }
    return;
  });
}
