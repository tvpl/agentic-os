import type Database from "better-sqlite3";

/**
 * Versioned migrations. Never edit an existing entry after release — append a new one.
 * The runner backs up the database file before applying anything.
 *
 * A migration is either plain SQL (`sql`) or a function (`up`) for changes
 * that need to inspect the schema first (SQLite has no `ADD COLUMN IF NOT EXISTS`).
 */
export interface Migration {
  version: number;
  name: string;
  sql?: string;
  up?: (db: Database.Database) => void;
}

/** True when `table` already has a column named `column`. */
export function hasColumn(db: Database.Database, table: string, column: string): boolean {
  const cols = db.pragma(`table_info(${table})`) as Array<{ name: string }>;
  return cols.some((c) => c.name === column);
}

export const MIGRATIONS: ReadonlyArray<Migration> = [
  {
    version: 1,
    name: "initial-schema",
    sql: `
CREATE TABLE runs (
  id TEXT PRIMARY KEY,
  created_at INTEGER NOT NULL,
  started_at INTEGER,
  finished_at INTEGER,
  origin TEXT NOT NULL,               -- manual | skill | routine | api
  provider TEXT NOT NULL,
  model TEXT,
  effort TEXT,
  status TEXT NOT NULL,               -- queued | running | waiting_approval | done | failed | cancelled | interrupted
  exit_code INTEGER,
  duration_ms INTEGER,
  cwd TEXT,
  prompt_summary TEXT,
  skill_slug TEXT,
  routine_id TEXT,
  error TEXT,
  artifacts_json TEXT NOT NULL DEFAULT '[]',
  files_changed_json TEXT NOT NULL DEFAULT '[]',
  attempts INTEGER NOT NULL DEFAULT 1,
  timeout_ms INTEGER,
  permission_profile TEXT,
  pid INTEGER
);
CREATE INDEX idx_runs_created ON runs(created_at DESC);
CREATE INDEX idx_runs_status ON runs(status);
CREATE INDEX idx_runs_routine ON runs(routine_id);

CREATE TABLE run_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  run_id TEXT NOT NULL,
  ts INTEGER NOT NULL,
  type TEXT NOT NULL,
  data TEXT NOT NULL DEFAULT '{}'
);
CREATE INDEX idx_run_events_run ON run_events(run_id, id);

CREATE TABLE files (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  root TEXT NOT NULL,
  path TEXT NOT NULL UNIQUE,          -- absolute path
  rel TEXT NOT NULL,                  -- path relative to root
  name TEXT NOT NULL,
  ext TEXT NOT NULL DEFAULT '',
  dir TEXT NOT NULL,
  area TEXT,
  size INTEGER NOT NULL,
  mtime INTEGER NOT NULL,
  indexed_at INTEGER NOT NULL,
  title TEXT,
  tags TEXT NOT NULL DEFAULT '[]'
);
CREATE INDEX idx_files_root ON files(root);
CREATE INDEX idx_files_dir ON files(dir);
CREATE INDEX idx_files_area ON files(area);

CREATE VIRTUAL TABLE files_fts USING fts5(
  name, rel, content, tokenize='porter unicode61'
);

CREATE TABLE file_links (
  src_id INTEGER NOT NULL,
  dst_id INTEGER NOT NULL,
  kind TEXT NOT NULL,                 -- markdown-link | same-dir | same-area
  PRIMARY KEY (src_id, dst_id, kind)
);

CREATE TABLE routine_history (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  routine_id TEXT NOT NULL,
  run_id TEXT,
  scheduled_for INTEGER,
  fired_at INTEGER NOT NULL,
  status TEXT NOT NULL,               -- fired | skipped | caught_up | failed_to_fire
  note TEXT
);
CREATE INDEX idx_routine_history ON routine_history(routine_id, fired_at DESC);

CREATE TABLE approvals (
  id TEXT PRIMARY KEY,
  created_at INTEGER NOT NULL,
  kind TEXT NOT NULL,
  description TEXT NOT NULL,
  payload TEXT NOT NULL DEFAULT '{}',
  status TEXT NOT NULL DEFAULT 'pending',  -- pending | approved | denied | expired
  resolved_at INTEGER
);

CREATE TABLE meta (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
`,
  },
  {
    version: 2,
    name: "run-lineage-and-pid",
    // Retries create a new run per attempt linked to the first one through
    // parent_run_id. `pid` already exists in v1 but is guarded here too so a
    // database created by hand or partially migrated still ends up consistent.
    // Status gains `timed_out` (no DDL: status is free text).
    up(db) {
      if (!hasColumn(db, "runs", "parent_run_id")) {
        db.exec("ALTER TABLE runs ADD COLUMN parent_run_id TEXT");
      }
      if (!hasColumn(db, "runs", "pid")) {
        db.exec("ALTER TABLE runs ADD COLUMN pid INTEGER");
      }
      db.exec("CREATE INDEX IF NOT EXISTS idx_runs_parent ON runs(parent_run_id)");
      db.exec("CREATE INDEX IF NOT EXISTS idx_run_events_ts ON run_events(ts)");
    },
  },
  {
    version: 3,
    name: "memory-facts-and-inline-fields",
    // Bi-temporal facts (Graphiti-style: contradictions invalidate, never
    // delete) and Dataview-style `key:: value` inline fields parsed from
    // markdown at index time (JSON object on the files row).
    up(db) {
      db.exec(`
CREATE TABLE IF NOT EXISTS facts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  subject TEXT NOT NULL,
  predicate TEXT NOT NULL,
  object TEXT NOT NULL,
  valid_from INTEGER NOT NULL,
  valid_to INTEGER,
  source_run_id TEXT,
  source_path TEXT,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_facts_subject ON facts(subject, predicate);
CREATE INDEX IF NOT EXISTS idx_facts_valid ON facts(valid_from, valid_to);
`);
      if (!hasColumn(db, "files", "fields")) {
        db.exec("ALTER TABLE files ADD COLUMN fields TEXT NOT NULL DEFAULT '{}'");
      }
    },
  },
  {
    version: 4,
    name: "run-usage-and-cost",
    // Token usage and provider-reported cost per run (F-RUNS). `usage_model`
    // is the model the provider actually billed, which may differ from the
    // requested `model` (aliases such as "sonnet"). All nullable: older runs
    // and providers without usage reporting simply leave them empty.
    up(db) {
      const columns: Array<[string, string]> = [
        ["input_tokens", "INTEGER"],
        ["output_tokens", "INTEGER"],
        ["cache_read_tokens", "INTEGER"],
        ["cache_write_tokens", "INTEGER"],
        ["cost_usd", "REAL"],
        ["usage_model", "TEXT"],
      ];
      for (const [name, type] of columns) {
        if (!hasColumn(db, "runs", name)) db.exec(`ALTER TABLE runs ADD COLUMN ${name} ${type}`);
      }
      db.exec("CREATE INDEX IF NOT EXISTS idx_runs_finished ON runs(finished_at)");
    },
  },
];
