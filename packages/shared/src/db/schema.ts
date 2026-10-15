import { DatabaseSync } from 'node:sqlite';

export function initCanvasDatabase(db: DatabaseSync): void {
  db.exec(`
    PRAGMA journal_mode = WAL;
    PRAGMA busy_timeout = 5000;

    CREATE TABLE IF NOT EXISTS cards (
      id TEXT PRIMARY KEY,
      layer TEXT NOT NULL,
      x REAL NOT NULL DEFAULT 0,
      y REAL NOT NULL DEFAULT 0,
      width REAL NOT NULL DEFAULT 280,
      height REAL NOT NULL DEFAULT 180,
      z_index INTEGER NOT NULL DEFAULT 1,
      metadata TEXT
    );
  `);

  db.exec(`
    CREATE TABLE IF NOT EXISTS canvas_meta (
      layer TEXT PRIMARY KEY,
      position_version INTEGER NOT NULL DEFAULT 0
    );
  `);


  // Presence is one row per character: "where is he right now" must have ONE
  // answer, or the canvas paints two Watsons (05 §3.4). That is what the
  // `character_id UNIQUE` constraint buys, and it is also what makes the
  // `ON CONFLICT(character_id)` upsert in `upsertPresence` idempotent.
  // Same shape-probing discipline as `events` / `links` (REVIEW B-4): this runs
  // on EVERY store construction, so an unguarded DROP would erase the world's
  // standing characters each boot. The old table (no UNIQUE) is rebuilt only
  // when the unique constraint is actually missing.
  db.exec(`
    CREATE TABLE IF NOT EXISTS presence (
      id           TEXT PRIMARY KEY,
      character_id TEXT NOT NULL UNIQUE,
      layer        TEXT NOT NULL,
      x            REAL NOT NULL DEFAULT 0,
      y            REAL NOT NULL DEFAULT 0,
      following    INTEGER NOT NULL DEFAULT 0,
      updated_at   TEXT NOT NULL
    );
  `);
  const presenceUnique = (
    db.prepare('PRAGMA index_list(presence)').all() as { origin?: string; unique?: number }[]
  ).some((idx) => idx.origin === 'u' && Number(idx.unique) === 1);
  if (!presenceUnique) {
    // Every shipped world's presence table is empty (holmes-world: []), so the
    // rebuild loses no state; the table had no writer before 05.
    db.exec(`
      DROP TABLE IF EXISTS presence;
      CREATE TABLE presence (
        id           TEXT PRIMARY KEY,
        character_id TEXT NOT NULL UNIQUE,
        layer        TEXT NOT NULL,
        x            REAL NOT NULL DEFAULT 0,
        y            REAL NOT NULL DEFAULT 0,
        following    INTEGER NOT NULL DEFAULT 0,
        updated_at   TEXT NOT NULL
      );
    `);
  }
  db.exec('CREATE INDEX IF NOT EXISTS idx_presence_layer ON presence(layer);');

  // Links grew from six columns to ten (doc-09 §2.4: color / directed /
  // z_index / created_at, and `style` narrowed to the six render primitives).
  // Shape-probing migration for the same reason as `events` (REVIEW B-4):
  // initCanvasDatabase runs on EVERY store construction, so an unguarded DROP
  // would erase the world's lines on each server restart or /api/worlds/load.
  const linkCols = new Set<string>(
    (db.prepare('PRAGMA table_info(links)').all() as { name: string }[]).map((c) => c.name)
  );
  if (!(linkCols.has('directed') && linkCols.has('z_index'))) {
    db.exec(`
      DROP TABLE IF EXISTS links;
      CREATE TABLE links (
        id         TEXT PRIMARY KEY,
        layer      TEXT NOT NULL,
        from_id    TEXT NOT NULL,
        to_id      TEXT NOT NULL,
        style      TEXT NOT NULL DEFAULT 'ink',
        color      TEXT,
        directed   INTEGER NOT NULL DEFAULT 0,
        z_index    INTEGER NOT NULL DEFAULT 0,
        label      TEXT,
        created_at TEXT NOT NULL
      );
    `);
  }

  db.exec('CREATE INDEX IF NOT EXISTS idx_links_layer ON links(layer, z_index, id);');

  // The player's viewpoint (00 §5.1 / 05 §2.2). NOT part of the world: one
  // singleton row, never snapshotted, never rolled back, dead after 10 minutes
  // (the TTL lives in `readViewpoint`, not here). A single-player world
  // (doc-05 §6) is why one row suffices. New table + `IF NOT EXISTS` — no
  // shape-probing rebuild here (there is no history to reconcile).
  db.exec(`
    CREATE TABLE IF NOT EXISTS viewpoint (
      id         TEXT PRIMARY KEY DEFAULT 'singleton',
      layer      TEXT NOT NULL DEFAULT '',
      focus      TEXT NOT NULL DEFAULT '',
      focus_x    INTEGER NOT NULL DEFAULT 0,
      focus_y    INTEGER NOT NULL DEFAULT 0,
      focus_w    INTEGER NOT NULL DEFAULT 0,
      focus_h    INTEGER NOT NULL DEFAULT 0,
      selected   TEXT NOT NULL DEFAULT '[]',
      bag_count  INTEGER NOT NULL DEFAULT 0,
      at         TEXT NOT NULL
    );
  `);
}

export function initHistoryDatabase(db: DatabaseSync): void {
  db.exec(`
    PRAGMA journal_mode = WAL;
    PRAGMA busy_timeout = 5000;

    CREATE TABLE IF NOT EXISTS entries (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL,
      session_id TEXT NOT NULL,
      type TEXT NOT NULL,
      content TEXT NOT NULL,
      timestamp TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_entries_proj ON entries(project_id);
    CREATE INDEX IF NOT EXISTS idx_entries_sess ON entries(session_id);
  `);

  // Shape-probing migration (REVIEW B-4). `initHistoryDatabase` runs on EVERY
  // store construction (server restart, /api/worlds/load); an unconditional
  // DROP would wipe the world's history each boot. Only the old five-column
  // shape (id/project_id/type/payload/created_at) is rebuilt.
  const eventCols = new Set<string>(
    (db.prepare('PRAGMA table_info(events)').all() as { name: string }[]).map((c) => c.name)
  );
  if (!(eventCols.has('seq') && eventCols.has('actor_type'))) {
    db.exec(`
      DROP TABLE IF EXISTS events;
      CREATE TABLE events (
        seq        INTEGER PRIMARY KEY AUTOINCREMENT,
        id         TEXT NOT NULL UNIQUE,
        project_id TEXT NOT NULL,
        type       TEXT NOT NULL,
        actor_type TEXT NOT NULL,
        actor_id   TEXT,
        layer      TEXT,
        subject    TEXT,
        turn       TEXT,
        detail     TEXT NOT NULL,
        created_at TEXT NOT NULL
      );
      CREATE INDEX idx_events_seq   ON events(project_id, seq);
      CREATE INDEX idx_events_layer ON events(project_id, layer, seq);
    `);
  }

  db.exec(`
    CREATE TABLE IF NOT EXISTS read_cursors (
      reader     TEXT PRIMARY KEY,
      seq        INTEGER NOT NULL,
      updated_at TEXT NOT NULL
    );
  `);
}
