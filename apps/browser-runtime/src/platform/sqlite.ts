// node:sqlite `DatabaseSync` over the official SQLite WASM build.
//
// The database FILE lives in the VFS like any other file (so export / sync /
// bundles see the same bytes a Node server would). An open database is an
// in-memory SQLite image deserialized from that file; writes are flushed back
// to the file when a statement leaves autocommit. Every DatabaseSync opened on
// the same path shares ONE connection — all programs run on one thread, so
// the cross-process locking a real file needs is not needed here.
import sqlite3InitModule from '@sqlite.org/sqlite-wasm';

let sqlite3: any = null;

export async function initSqlite(): Promise<any> {
  // The VFS owns persistence (persist.ts); keep sqlite-wasm from probing OPFS
  // (it spins up an async-proxy Worker that 404s and logs errors).
  (globalThis as any).sqlite3ApiConfig = { ...(globalThis as any).sqlite3ApiConfig, disable: { vfs: { opfs: true, 'opfs-vfs': true, 'opfs-wl': true, 'opfs-sahpool': true } } };
  if (!sqlite3) sqlite3 = await (sqlite3InitModule as any)({ print: () => {}, printErr: () => {} });
  return sqlite3;
}

function fs(): any {
  return (globalThis as any).__airpNode.fs;
}

interface Conn { db: any; path: string; refs: number; timer: any; dirty: boolean }
const conns = new Map<string, Conn>();
const FLUSH_MS = 30;

/** WAL-flagged images (header bytes 18/19 == 2) cannot be deserialized; journal_mode=DELETE is 1/1. */
export function walToRollback(bytes: Uint8Array): boolean {
  if (bytes.length >= 20 && (bytes[18] === 2 || bytes[19] === 2)) {
    bytes[18] = 1;
    bytes[19] = 1;
    return true;
  }
  return false;
}

function openConn(path: string): Conn {
  const key = path === '' ? ':memory:' : path;
  const existing = key === ':memory:' ? undefined : conns.get(key);
  if (existing) { existing.refs++; return existing; }
  if (!sqlite3) throw new Error('SQLite WASM is not initialised (call initSqlite first)');
  const db = new sqlite3.oo1.DB(':memory:', 'c');
  const c: Conn = { db, path: key, refs: 1, timer: null, dirty: false };
  if (key !== ':memory:') {
    let bytes: Uint8Array | null = null;
    try { bytes = new Uint8Array(fs().readFileSync(key)); } catch { bytes = null; }
    if (bytes && bytes.length > 0) {
      walToRollback(bytes);
      const p = sqlite3.wasm.allocFromTypedArray(bytes);
      const { capi } = sqlite3;
      const rc = capi.sqlite3_deserialize(db.pointer, 'main', p, bytes.length, bytes.length,
        capi.SQLITE_DESERIALIZE_FREEONCLOSE | capi.SQLITE_DESERIALIZE_RESIZEABLE);
      if (rc) { db.close(); throw new Error(`sqlite3_deserialize(${key}) failed: rc=${rc}`); }
    } else {
      // Node creates the file on open; so do we (parent dir must exist, as in Node).
      try { fs().writeFileSync(key, new Uint8Array(0), { flag: 'a' }); } catch (e: any) {
        db.close();
        const err: any = new Error(`unable to open database file: ${key}`);
        err.code = 'ERR_SQLITE_ERROR';
        throw err;
      }
    }
    conns.set(key, c);
  }
  return c;
}

function flushNow(c: Conn) {
  if (c.timer) { clearTimeout(c.timer); c.timer = null; }
  if (!c.dirty || c.path === ':memory:' || !c.db.pointer) return;
  if (!sqlite3.capi.sqlite3_get_autocommit(c.db.pointer)) return; // never persist a half transaction
  c.dirty = false;
  const bytes = sqlite3.capi.sqlite3_js_db_export(c.db.pointer);
  fs().writeFileSync(c.path, bytes);
}

function touched(c: Conn) {
  c.dirty = true;
  if (c.path === ':memory:') return;
  if (!sqlite3.capi.sqlite3_get_autocommit(c.db.pointer)) return;
  if (!c.timer) c.timer = setTimeout(() => { c.timer = null; flushNow(c); }, FLUSH_MS);
}

/** Persist every open database now (used before export / page unload). */
export function flushAllDatabases() {
  for (const c of conns.values()) flushNow(c);
}

function sqlErr(e: any): Error {
  const err: any = e instanceof Error ? e : new Error(String(e));
  err.code ??= 'ERR_SQLITE_ERROR';
  return err;
}

function isNamed(v: unknown): v is Record<string, unknown> {
  return v !== null && typeof v === 'object' && !Array.isArray(v) && !(v instanceof Uint8Array) && !ArrayBuffer.isView(v);
}

function toSql(v: unknown): unknown {
  if (v === undefined) throw Object.assign(new TypeError('Provided value cannot be bound to SQLite parameter'), { code: 'ERR_INVALID_ARG_TYPE' });
  if (typeof v === 'boolean') return v ? 1 : 0;
  if (v instanceof Uint8Array) return v;
  if (ArrayBuffer.isView(v)) return new Uint8Array((v as any).buffer, (v as any).byteOffset, (v as any).byteLength);
  return v;
}

export class StatementSync {
  #conn: Conn;
  #sql: string;
  #readBigInts = false;
  #returnArrays = false;
  constructor(conn: Conn, sql: string) {
    this.#conn = conn;
    this.#sql = sql;
    // Compile once eagerly so syntax errors surface at prepare() like Node.
    const st = conn.db.prepare(sql);
    st.finalize();
  }
  get sourceSQL() { return this.#sql; }
  get expandedSQL() { return this.#sql; }
  setReadBigInts(v: boolean) { this.#readBigInts = !!v; return this; }
  setReturnArrays(v: boolean) { this.#returnArrays = !!v; return this; }
  setAllowBareNamedParameters() { return this; }
  setAllowUnknownNamedParameters() { return this; }
  columns() {
    const st = this.#conn.db.prepare(this.#sql);
    try { return st.getColumnNames().map((name: string) => ({ name, column: null, database: null, table: null, type: null })); }
    finally { st.finalize(); }
  }

  #withStmt<T>(params: unknown[], fn: (st: any) => T): T {
    const { capi } = sqlite3;
    let st: any;
    try {
      st = this.#conn.db.prepare(this.#sql);
      const named = params.length > 0 && isNamed(params[0]) ? (params[0] as Record<string, unknown>) : null;
      const anon = named ? params.slice(1) : params;
      const n = st.parameterCount;
      let ai = 0;
      for (let i = 1; i <= n; i++) {
        const name: string | null = capi.sqlite3_bind_parameter_name(st.pointer, i);
        if (name && !/^\?\d*$/.test(name)) {
          if (!named) throw new Error(`Missing named parameter "${name}"`);
          const bare = name.slice(1);
          const v = name in named ? named[name] : named[bare];
          if (v === undefined && !(name in named) && !(bare in named)) throw new Error(`Missing named parameter "${bare}"`);
          st.bind(i, toSql(v));
        } else if (ai < anon.length) {
          st.bind(i, toSql(anon[ai++]));
        }
      }
      return fn(st);
    } catch (e) {
      throw sqlErr(e);
    } finally {
      try { st?.finalize(); } catch { /* already finalized */ }
    }
  }

  #row(st: any): any {
    if (this.#returnArrays) {
      const arr = st.get([]);
      return this.#readBigInts ? arr.map((v: unknown) => (typeof v === 'number' && Number.isInteger(v) ? BigInt(v) : v)) : arr;
    }
    const obj = st.get({});
    const row = Object.create(null);
    for (const k of Object.keys(obj)) {
      const v = obj[k];
      row[k] = this.#readBigInts && typeof v === 'number' && Number.isInteger(v) ? BigInt(v) : v;
    }
    return row;
  }

  run(...params: unknown[]) {
    const c = this.#conn;
    const out = this.#withStmt(params, (st) => {
      while (st.step()) { /* drain RETURNING rows */ }
      const { capi } = sqlite3;
      const changes = Number(capi.sqlite3_changes(c.db.pointer));
      const rowid = capi.sqlite3_last_insert_rowid(c.db.pointer);
      return {
        changes: this.#readBigInts ? BigInt(changes) : changes,
        lastInsertRowid: this.#readBigInts ? BigInt(rowid) : Number(rowid),
      };
    });
    touched(c);
    return out;
  }

  get(...params: unknown[]) {
    const r = this.#withStmt(params, (st) => (st.step() ? this.#row(st) : undefined));
    if (!/^\s*select/i.test(this.#sql)) touched(this.#conn);
    return r;
  }

  all(...params: unknown[]) {
    const r = this.#withStmt(params, (st) => {
      const rows: any[] = [];
      while (st.step()) rows.push(this.#row(st));
      return rows;
    });
    if (!/^\s*select/i.test(this.#sql)) touched(this.#conn);
    return r;
  }

  *iterate(...params: unknown[]) {
    yield* this.all(...params);
  }
}

export class DatabaseSync {
  #conn: Conn | null = null;
  #path: string;
  constructor(path: string | URL | Uint8Array = ':memory:', options: { open?: boolean; enableForeignKeyConstraints?: boolean } = {}) {
    this.#path = typeof path === 'string' ? path : path instanceof URL ? decodeURIComponent(path.pathname) : new TextDecoder().decode(path);
    if (options.open !== false) this.open(options);
  }
  open(options: { enableForeignKeyConstraints?: boolean } = {}) {
    if (this.#conn) throw Object.assign(new Error('database is already open'), { code: 'ERR_INVALID_STATE' });
    this.#conn = openConn(this.#path);
    if (options.enableForeignKeyConstraints !== false) {
      try { this.#conn.db.exec('PRAGMA foreign_keys = ON'); } catch { /* inside a shared transaction */ }
    }
  }
  get isOpen() { return !!this.#conn; }
  get isTransaction() { return !!this.#conn && !sqlite3.capi.sqlite3_get_autocommit(this.#conn.db.pointer); }
  location() { return this.#path === ':memory:' ? null : this.#path; }
  #c(): Conn {
    if (!this.#conn) throw Object.assign(new Error('database is not open'), { code: 'ERR_INVALID_STATE' });
    return this.#conn;
  }
  exec(sql: string) {
    const c = this.#c();
    try { c.db.exec(sql); } catch (e) { throw sqlErr(e); }
    if (!/^\s*(select|pragma\s+\w+\s*;?\s*$)/i.test(sql)) touched(c);
  }
  prepare(sql: string) {
    try { return new StatementSync(this.#c(), sql); } catch (e) { throw sqlErr(e); }
  }
  function(name: string, optsOrFn: any, maybeFn?: any) {
    const fn = typeof optsOrFn === 'function' ? optsOrFn : maybeFn;
    this.#c().db.createFunction(name, (_ctx: unknown, ...args: unknown[]) => fn(...args), { arity: fn.length });
  }
  enableLoadExtension() { throw new Error('loadExtension is not supported in browser mode'); }
  loadExtension() { throw new Error('loadExtension is not supported in browser mode'); }
  close() {
    const c = this.#c();
    this.#conn = null;
    c.refs--;
    if (c.refs <= 0) {
      flushNow(c);
      conns.delete(c.path);
      c.db.close();
    }
  }
  [Symbol.dispose]() { if (this.#conn) this.close(); }
}

export const constants = { SQLITE_CHANGESET_OMIT: 0, SQLITE_CHANGESET_REPLACE: 1, SQLITE_CHANGESET_ABORT: 2 };
export function backup() { throw new Error('sqlite.backup is not supported in browser mode'); }
export default { DatabaseSync, StatementSync, constants, backup };
