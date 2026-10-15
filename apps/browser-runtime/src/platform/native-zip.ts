// `zip` / `unzip` for browser mode, over the VFS with fflate. World snapshots
// and rollback (packages/shared actions/world.ts) execFile exactly these forms:
//   zip -r -q <archive> . -x '<dir>/*'
//   unzip -Z1 <archive>
//   unzip -o -q <archive> [entries…] -d <dest>
import { zipSync, unzipSync, type Zippable } from 'fflate';
import { fs } from './fs';

type Io = { args: string[]; cwd: string; out: (s: string) => void; err: (s: string) => void };
const STORED = /\.(webp|webm|png|jpe?g|gif|mp3|mp4|ogg|wav|zip|gz|woff2?)$/i;
const abs = (cwd: string, p: string) => (p.startsWith('/') ? p : `${cwd.replace(/\/$/, '')}/${p}`).replace(/\/\.(?=\/|$)/g, '');

/** zip wildcards: `*` and `?` match across '/' (no -W). */
const wild = (p: string) => new RegExp(`^${p.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*').replace(/\?/g, '.')}$`);

export function runZip({ args, cwd, out, err }: Io): number {
  let recurse = false, quiet = false, i = 0;
  const inputs: string[] = [], excludes: RegExp[] = [];
  let archive = '';
  for (; i < args.length; i++) {
    const a = args[i];
    if (a === '-x') { excludes.push(...args.slice(i + 1).map(wild)); break; }
    if (a.startsWith('-') && a.length > 1) { recurse ||= a.includes('r'); quiet ||= a.includes('q'); continue; }
    if (!archive) archive = a; else inputs.push(a);
  }
  if (!archive || !inputs.length) { err('zip error: Nothing to do!\n'); return 12; }
  const target = abs(cwd, archive.endsWith('.zip') ? archive : `${archive}.zip`);
  const entries: Zippable = {};
  let n = 0;
  const add = (rel: string) => {
    const name = rel.replace(/^\.\//, '');
    if (!name || excludes.some((x) => x.test(name))) return;
    const p = abs(cwd, rel);
    if (p === target) return;
    const st = fs.statSync(p);
    if (st.isDirectory()) {
      if (name !== '.' && excludes.some((x) => x.test(`${name}/`))) return; // `-x dir/*` also drops the dir entry
      if (name !== '.') entries[`${name}/`] = [new Uint8Array(0), { mtime: st.mtime }];
      if (!recurse) return;
      for (const e of fs.readdirSync(p) as string[]) add(name === '.' ? e : `${name}/${e}`);
    } else if (st.isFile()) {
      entries[name] = [new Uint8Array(fs.readFileSync(p)), { mtime: st.mtime, level: STORED.test(name) ? 0 : 6 }];
      n++;
    }
  };
  for (const input of inputs) {
    if (!fs.existsSync(abs(cwd, input))) { err(`zip warning: name not matched: ${input}\n`); continue; }
    add(input === '.' ? '.' : input);
  }
  if (!n && !Object.keys(entries).length) { err('zip error: Nothing to do!\n'); return 12; }
  fs.writeFileSync(target, zipSync(entries));
  if (!quiet) out(`  adding: ${n} files\n`);
  return 0;
}

export function runUnzip({ args, cwd, out, err }: Io): number {
  let list = false, dest = cwd, archive = '';
  const wanted: string[] = [];
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === '-Z1') list = true;
    else if (a === '-d') dest = abs(cwd, args[++i]);
    else if (a.startsWith('-') && a.length > 1) continue; // -o, -q
    else if (!archive) archive = a;
    else wanted.push(a);
  }
  let files: Record<string, Uint8Array>;
  try { files = unzipSync(new Uint8Array(fs.readFileSync(abs(cwd, archive)))); } catch (e: any) {
    err(`unzip:  cannot find or open ${archive}: ${e?.message ?? e}\n`);
    return 9;
  }
  if (list) { out(Object.keys(files).map((k) => `${k}\n`).join('')); return 0; }
  const pick = wanted.length ? wanted.map(wild) : null;
  let missing = pick ? new Set(wanted) : null;
  for (const [name, bytes] of Object.entries(files)) {
    const hit = pick ? wanted.filter((w, j) => pick[j].test(name)) : [];
    if (pick && !hit.length) continue;
    hit.forEach((w) => missing!.delete(w));
    if (name.split('/').includes('..')) { err(`unzip: skipping ${name}\n`); continue; }
    const p = `${dest.replace(/\/$/, '')}/${name}`;
    if (name.endsWith('/')) { fs.mkdirSync(p, { recursive: true }); continue; }
    fs.mkdirSync(p.slice(0, p.lastIndexOf('/')), { recursive: true });
    fs.writeFileSync(p, bytes);
  }
  if (missing?.size) { err(`caution: filename not matched:  ${[...missing][0]}\n`); return 11; }
  return 0;
}
