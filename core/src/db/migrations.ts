/**
 * Versioned migrations. Never edit an existing entry after release — append a new one.
 * The runner backs up the database file before applying anything.
 */
export const MIGRATIONS: ReadonlyArray<{ version: number; name: string; sql: string }> = [
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
];
