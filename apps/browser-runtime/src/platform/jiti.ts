// `jiti` in browser mode: there is no runtime TypeScript loader. Extensions are
// pre-bundled at build time and registered by absolute VFS path; jiti.import()
// just looks them up.
//
// The table is PER PROGRAM RUN, never global. This file is bundled into the pi
// program (build.mjs `PER_PROGRAM`), and the program bundle is re-evaluated for
// every spawn with that spawn's own `process` — so each pi-rp instance gets its
// own copy of every extension module, whose `process.env.AIRP_AGENT_ROLE` is
// that agent's identity. The table used to live on `globalThis`: every spawn
// overwrote it, and an agent that loaded its extensions after a later spawn
// (two characters, or a character and the writer, starting together) ran with
// the OTHER agent's extension instances — the other character's identity,
// world-state block and tool face, inside its own session.
// The program's `__airpImport` reads the same per-run table through
// `process.__airpModules` (build.mjs wrapProgram, registry.ts).
const modules = new Map<string, unknown>();
try {
  (process as any).__airpModules = modules;
} catch {
  /* a frozen process object: jiti lookups still work, runtime import() does not see extensions */
}

export function registerModule(path: string, mod: unknown) {
  modules.set(path, mod);
}

function lookup(id: string, opts?: { default?: boolean }) {
  const mod: any = modules.get(id);
  if (!mod) {
    throw Object.assign(new Error(`Cannot load "${id}" in browser mode: only pre-bundled extensions are available`), { code: 'MODULE_NOT_FOUND' });
  }
  return opts?.default && mod && 'default' in mod ? mod.default : mod;
}

export function createJiti(_from: string, _opts?: unknown) {
  const jiti: any = (id: string) => lookup(id);
  jiti.import = async (id: string, opts?: { default?: boolean }) => lookup(id, opts);
  jiti.esmResolve = (id: string) => id;
  jiti.resolve = (id: string) => id;
  return jiti;
}
export default createJiti;
