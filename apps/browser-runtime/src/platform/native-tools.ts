// `fd` and `rg` for browser mode: pi-rp's find / grep tools spawn these
// binaries (utils/tools-manager.ts finds them on PATH via `spawnSync(x,
// ['--version'])`). Here they are in-process programs over the VFS that accept
// exactly the flags those tools pass and print the same output shapes, so no
// pi-rp source changes. Not full fd / rg: .gitignore is approximated by
// skipping .git and node_modules.
import { fs } from './fs';
import { runZip, runUnzip } from './native-zip';

const SKIP_DIRS = new Set(['.git', 'node_modules']);
const join = (d: string, n: string) => (d.endsWith('/') ? d + n : `${d}/${n}`);

/** Glob -> RegExp: `**` crosses '/', `*` and `?` do not; {a,b} and [..] classes. */
export function globToRegExp(glob: string): RegExp {
  let re = '';
  for (let i = 0; i < glob.length; i++) {
    const c = glob[i];
    if (c === '*') {
      if (glob[i + 1] === '*') {
        i++;
        if (glob[i + 1] === '/') { i++; re += '(?:.*/)?'; } else re += '.*';
      } else re += '[^/]*';
    } else if (c === '?') re += '[^/]';
    else if (c === '{') {
      const end = glob.indexOf('}', i);
      if (end < 0) { re += '\\{'; continue; }
      re += `(?:${glob.slice(i + 1, end).split(',').map((alt) => globToRegExp(alt).source.slice(1, -1)).join('|')})`;
      i = end;
    } else if (c === '[') {
      const end = glob.indexOf(']', i + 1);
      if (end < 0) { re += '\\['; continue; }
      re += `[${glob.slice(i + 1, end).replace(/^!/, '^').replace(/\\/g, '\\\\')}]`;
      i = end;
    } else re += /[.+^$()|\\/]/.test(c) ? `\\${c}` : c;
  }
  return new RegExp(`^${re}$`);
}

function* walk(root: string, hidden: boolean): Generator<{ path: string; dir: boolean }> {
  let entries: any[];
  try { entries = fs.readdirSync(root, { withFileTypes: true }); } catch { return; }
  for (const e of entries) {
    if (!hidden && e.name.startsWith('.')) continue;
    if (SKIP_DIRS.has(e.name)) continue;
    const p = join(root, e.name);
    const dir = e.isDirectory();
    yield { path: p, dir };
    if (dir) yield* walk(p, hidden);
  }
}

type Io = { args: string[]; cwd: string; out: (s: string) => void; err: (s: string) => void };

/** fd --glob [--hidden] [--full-path] [--max-results N] [--type f|d] -- <pattern> [<path>...] */
export function runFd({ args, cwd, out, err }: Io): number {
  let hidden = false, fullPath = false, max = Infinity, type = '';
  const pos: string[] = [];
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === '--') { pos.push(...args.slice(i + 1)); break; }
    if (a === '--hidden' || a === '-H') hidden = true;
    else if (a === '--full-path' || a === '-p') fullPath = true;
    else if (a === '--max-results') max = Number(args[++i]);
    else if (a === '--type' || a === '-t') type = args[++i];
    else if (a.startsWith('-')) continue; // --glob, --color=never, --no-require-git, --no-ignore...
    else pos.push(a);
  }
  const [pattern = '*', ...roots] = pos;
  const re = globToRegExp(pattern);
  let n = 0;
  for (const r of roots.length ? roots : ['.']) {
    const abs = r.startsWith('/') ? r : join(cwd, r);
    if (!fs.existsSync(abs)) { err(`[fd error]: Search path '${r}' is not a directory.\n`); return 1; }
    for (const e of walk(abs, hidden)) {
      if (type === 'f' && e.dir) continue;
      if (type === 'd' && !e.dir) continue;
      const subject = fullPath ? e.path : e.path.slice(e.path.lastIndexOf('/') + 1);
      if (!re.test(subject)) continue;
      out(`${r.startsWith('/') ? e.path : e.path.slice(cwd.length + 1)}${e.dir ? '/' : ''}\n`);
      if (++n >= max) return 0;
    }
  }
  return 0;
}

/** rg --json [--ignore-case] [--fixed-strings] [--glob G] -- <pattern> <path> */
export function runRg({ args, cwd, out, err }: Io): number {
  let ci = false, fixed = false, hidden = false;
  const globs: RegExp[] = [];
  const pos: string[] = [];
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === '--') { pos.push(...args.slice(i + 1)); break; }
    if (a === '--ignore-case' || a === '-i') ci = true;
    else if (a === '--fixed-strings' || a === '-F') fixed = true;
    else if (a === '--hidden') hidden = true;
    else if (a === '--glob' || a === '-g') globs.push(globToRegExp(args[++i].includes('/') ? args[i] : `**/${args[i]}`));
    else if (a.startsWith('-')) continue; // --json, --line-number, --color=never
    else pos.push(a);
  }
  const [pattern, target = '.'] = pos;
  if (pattern === undefined) { err('rg: no pattern given\n'); return 2; }
  let re: RegExp;
  try { re = new RegExp(fixed ? pattern.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') : pattern, ci ? 'i' : ''); } catch (e: any) { err(`rg: regex parse error: ${e.message}\n`); return 2; }
  const abs = target.startsWith('/') ? target : join(cwd, target);
  let st: any;
  try { st = fs.statSync(abs); } catch { err(`rg: ${target}: No such file or directory (os error 2)\n`); return 2; }
  const files = st.isDirectory() ? [...walk(abs, hidden)].filter((e) => !e.dir).map((e) => e.path) : [abs];
  let matched = false;
  for (const f of files) {
    if (globs.length && !globs.some((g) => g.test(f.slice(abs.length + 1)) || g.test(f.slice(f.lastIndexOf('/') + 1)))) continue;
    const buf: Uint8Array = fs.readFileSync(f);
    if (buf.subarray(0, 8000).includes(0)) continue; // binary
    const lines = new TextDecoder().decode(buf).split('\n');
    lines.forEach((text, i) => {
      if (!re.test(text)) return;
      matched = true;
      out(`${JSON.stringify({ type: 'match', data: { path: { text: f }, lines: { text: `${text}\n` }, line_number: i + 1, absolute_offset: 0, submatches: [] } })}\n`);
    });
  }
  return matched ? 0 : 1;
}

export const NATIVE_TOOLS: Record<string, (io: Io) => number> = { fd: runFd, rg: runRg, zip: runZip, unzip: runUnzip };
