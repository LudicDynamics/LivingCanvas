// Bundles browser mode into dist/:
//   worker.js  — the platform (VFS, SQLite, node:* registry, program runner)
//   server.js  — apps/server/dist/index.js, unmodified, as a program
//   pi.js      — vendor/pi-rp coding-agent dist/cli.js, unmodified, as a program
// A program bundle is wrapped in `export default async function(process)` so each
// spawn re-evaluates it with its own process object; its node:* imports resolve
// to the Worker's shared registry (globalThis.__airpNode).
import * as esbuild from 'esbuild';
import { builtinModules } from 'node:module';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { findVFlagRegExps, lowerVFlagRegExps } from './regex-v.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, '../..');
const OUT = path.join(HERE, 'dist');
// Minified by default (whitespace + syntax only: names stay readable in stack traces); MINIFY=0 for a readable bundle.
const MINIFY = process.env.MINIFY !== '0';
const P = (f) => path.join(HERE, 'src/platform', f);
// The oldest engines the tab runtime supports (README「浏览器要求」): Safari / iOS 16.4 (regex lookbehind in the
// bundled server — a parse error below that), Chrome / Edge 98, Firefox 125 (module-level Intl.Segmenter). esbuild
// lowers syntax for these; RegExp `v` it cannot lower, so regex-v.mjs rewrites it after the build and the finished
// bundles are scanned (a `v` regex left = the build fails: it would not even start on Safari < 17).
const TARGET = ['es2022', 'safari16.4', 'chrome98', 'firefox125'];
fs.mkdirSync(OUT, { recursive: true });

const BUILTINS = [...new Set(builtinModules.filter((m) => !m.startsWith('_')).concat(['sqlite', 'test']))];
const PER_PROGRAM = { path: P('path.ts'), 'path/posix': P('path.ts'), jiti: P('jiti.ts'), 'jiti/static': P('jiti.ts'), undici: P('undici.ts') };
const esc = (s) => s.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&');
const BUILTIN_RE = new RegExp(`^(node:)?(${BUILTINS.map(esc).join('|')})$`);

const PI_AGENT_DIR = path.join(REPO, 'vendor/pi-rp/packages/coding-agent');
const programPlugin = {
  name: 'airp-node',
  setup(b) {
    // Extensions import pi-rp by package name (jiti aliases / virtualModules at runtime).
    b.onResolve({ filter: /^(@(earendil-works|mariozechner)\/pi-|typebox|@sinclair\/typebox)/ }, (a) => {
      if (a.resolveDir.startsWith(path.join(REPO, 'vendor'))) return undefined;
      let id = a.path.replace('@mariozechner/', '@earendil-works/');
      if (id === '@earendil-works/pi-ai') id = '@earendil-works/pi-ai/compat'; // what loader.ts VIRTUAL_MODULES hands extensions
      return b.resolve(id, { resolveDir: PI_AGENT_DIR, kind: a.kind });
    });
    b.onResolve({ filter: /^(jiti|jiti\/static|undici|ws)$/ }, (a) => (a.path === 'ws' ? { path: 'ws', namespace: 'airp-node' } : { path: PER_PROGRAM[a.path] }));
    b.onResolve({ filter: BUILTIN_RE }, (a) => {
      const name = a.path.replace(/^node:/, '');
      if (PER_PROGRAM[name]) return { path: PER_PROGRAM[name] };
      return { path: name, namespace: name === 'process' ? 'airp-process' : 'airp-node' };
    });
    // CommonJS on purpose: `require('stream')` must return the module object
    // itself (util.inherits(X, Stream)), and ESM named imports become property
    // reads at use time, so `this` and late-filled registry entries just work.
    b.onLoad({ filter: /.*/, namespace: 'airp-node' }, (a) => ({
      contents: `module.exports = globalThis.__airpNode[${JSON.stringify(a.path)}] ?? globalThis.__airpMissing(${JSON.stringify(a.path)});`,
      loader: 'js',
    }));
    b.onLoad({ filter: /.*/, namespace: 'airp-process' }, () => ({ contents: 'module.exports = process;', loader: 'js' }));
  },
};

// Stubs for what a play turn never touches (TUI rendering natives, clipboard, image codecs).
const stubPlugin = {
  name: 'airp-stubs',
  setup(b) {
    const STUB = /^(koffi|@mariozechner\/clipboard.*|@earendil-works\/clipboard.*|@img\/.*|sharp|fsevents|bufferutil|utf-8-validate|canvas|playwright|playwright-core|chromium-bidi.*)$/;
    b.onResolve({ filter: STUB }, (a) => ({ path: a.path, namespace: 'airp-stub' }));
    b.onLoad({ filter: /.*/, namespace: 'airp-stub' }, (a) => ({
      contents: `const e = () => { throw new Error(${JSON.stringify(`${a.path} is not available in browser mode`)}); };\nexport default new Proxy(e, { get: (t, k) => k === '__esModule' ? false : e });`,
      loader: 'js',
    }));
  },
};

// depd (express / body-parser deprecation notices) reads call sites through V8's
// Error.prepareStackTrace / CallSite API; Safari / WebKit has no such API and its
// callSiteLocation() throws at require time — the whole in-tab server died on
// iPhone (2026-10-04: lobby empty, every /api/* 500). Deprecation warnings are
// irrelevant in the tab: a no-op depd with the same surface.
const depdPlugin = {
  name: 'airp-depd',
  setup(b) {
    b.onResolve({ filter: /^depd$/ }, () => ({ path: 'depd', namespace: 'airp-depd' }));
    b.onLoad({ filter: /.*/, namespace: 'airp-depd' }, () => ({
      contents: 'module.exports = function depd() { const deprecate = function () {}; deprecate._file = undefined; deprecate._ignored = true; deprecate._namespace = "airp"; deprecate._traced = false; deprecate._warned = Object.create(null); deprecate.function = (fn) => fn; deprecate.property = () => {}; return deprecate; };',
      loader: 'js',
    }));
  },
};

// RegExp `v` → `u` (regex-v.mjs), then prove none is left in this bundle.
function lowerRegExpFlags(file) {
  const { code, changed } = lowerVFlagRegExps(fs.readFileSync(file, 'utf8'));
  const left = findVFlagRegExps(code);
  if (left.length) throw new Error(`${path.basename(file)}: RegExp v flag left after lowering:\n${left.join('\n')}`);
  if (changed.length) fs.writeFileSync(file, code);
}

function wrapProgram(file) {
  let code = fs.readFileSync(file, 'utf8');
  const bad = code.match(/^(import\s[^(].*|export\s.*)$/m);
  if (bad) throw new Error(`${path.basename(file)}: unexpected module statement: ${bad[0].slice(0, 120)}`);
  code = code.replace(/(^|[^\w$.])import\((?!\s*["'`])/g, '$1__airpImport(');
  const head = [
    'export default async function __airpProgram(process) {',
    'const global = globalThis, Buffer = globalThis.__airpNode.buffer.Buffer, setImmediate = globalThis.setImmediate, clearImmediate = globalThis.clearImmediate;',
    'const __dirname = "/", __filename = "/index.js";',
    // This run's own pre-bundled modules (jiti.ts sets process.__airpModules), never another spawn's.
    'const __airpImport = (spec) => globalThis.__airpImport(spec, process.__airpModules);',
    'const { setTimeout, setInterval, clearTimeout, clearInterval } = globalThis.__airpTimers;',
    'await (async () => {',
  ].join('\n');
  fs.writeFileSync(file, `${head}\n${code}\n})();\n}\n`);
}

async function buildProgram(name, entryContents, importMetaUrl) {
  const outfile = path.join(OUT, `${name}.js`);
  const r = await esbuild.build({
    stdin: { contents: entryContents, resolveDir: REPO, sourcefile: `${name}-entry.js`, loader: 'js' },
    // `neutral` + node condition: resolve packages exactly as Node would (no
    // package.json "browser" swaps); built-ins are the shims.
    bundle: true, format: 'esm', platform: 'neutral', target: TARGET, outfile,
    mainFields: ['module', 'main'], conditions: ['node', 'module'],
    define: { 'import.meta.url': JSON.stringify(importMetaUrl), 'import.meta.dirname': JSON.stringify(path.posix.dirname(importMetaUrl.slice(7))), 'import.meta.filename': JSON.stringify(importMetaUrl.slice(7)), 'import.meta.resolve': 'globalThis.__airpMetaResolve' },
    plugins: [programPlugin, stubPlugin, depdPlugin], metafile: true, logLevel: 'error', logLimit: 0, legalComments: 'none',
    minifyWhitespace: MINIFY, minifySyntax: MINIFY,
    resolveExtensions: ['.ts', '.js', '.mjs', '.cjs', '.json'], tsconfig: path.join(HERE, 'tsconfig.bundle.json'),
  });
  lowerRegExpFlags(outfile);
  wrapProgram(outfile);
  fs.writeFileSync(path.join(OUT, `${name}.meta.json`), JSON.stringify(r.metafile));
  return outfile;
}

// Inside the platform itself, bare / node: built-ins map to browser packages.
const WORKER_MAP = { path: 'path-browserify', stream: 'readable-stream', querystring: 'querystring-es3', buffer: 'buffer', events: 'events', util: 'util', url: 'url', string_decoder: 'string_decoder' };
const workerPlugin = {
  name: 'airp-worker-builtins',
  setup(b) {
    b.onResolve({ filter: /^node:/ }, (a) => {
      const n = a.path.slice(5);
      if (!WORKER_MAP[n]) return { errors: [{ text: `platform imports unmapped built-in ${a.path}` }] };
      return b.resolve(WORKER_MAP[n], { resolveDir: HERE, kind: a.kind });
    });
    b.onResolve({ filter: /^(path|stream|querystring)$/ }, (a) => b.resolve(WORKER_MAP[a.path], { resolveDir: HERE, kind: a.kind }));
  },
};

async function buildWorker() {
  const r = await esbuild.build({
    entryPoints: [path.join(HERE, 'src/worker.ts')], bundle: true, format: 'esm', platform: 'browser', target: TARGET,
    outfile: path.join(OUT, 'worker.js'), inject: [P('inject-early.ts')], metafile: true, logLevel: 'error',
    plugins: [workerPlugin],
    minifyWhitespace: MINIFY, minifySyntax: MINIFY,
  });
  lowerRegExpFlags(path.join(OUT, 'worker.js'));
  fs.writeFileSync(path.join(OUT, 'worker.meta.json'), JSON.stringify(r.metafile));
  fs.copyFileSync(path.join(HERE, 'node_modules/@sqlite.org/sqlite-wasm/dist/sqlite3.wasm'), path.join(OUT, 'sqlite3.wasm'));
}

const which = process.argv[2] ?? 'all';
const t = Date.now();
if (which === 'all' || which === 'worker') await buildWorker();
if (which === 'all' || which === 'server') {
  await buildProgram('server', `import './apps/server/dist/index.js';`, 'file:///repo/apps/server/dist/index.js');
}
if (which === 'all' || which === 'pi') {
  const exts = fs.readdirSync(path.join(REPO, 'extensions')).filter((f) => f.endsWith('.ts') && !f.endsWith('.d.ts') && !/\.(test|spec)\.ts$/.test(f));
  const entry = [
    `import { registerModule } from ${JSON.stringify(P('jiti.ts'))};`,
    ...exts.map((f, i) => `import * as ext${i} from './extensions/${f}';\nregisterModule('/repo/extensions/${f}', ext${i});`),
    `import './vendor/pi-rp/packages/coding-agent/dist/cli.js';`,
  ].join('\n');
  await buildProgram('pi', entry, 'file:///repo/vendor/pi-rp/packages/coding-agent/dist/cli.js');
}
for (const f of fs.readdirSync(OUT).filter((f) => /\.(js|wasm)$/.test(f))) console.log(f.padEnd(14), (fs.statSync(path.join(OUT, f)).size / 1024).toFixed(0).padStart(7), 'KiB');
console.log(`built in ${Date.now() - t} ms`);
