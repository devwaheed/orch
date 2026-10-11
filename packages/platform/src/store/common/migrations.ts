/**
 * Hand-written SQL migrations, applied in version order by `node/migrator.ts`.
 * Each migration is recorded in `schema_migrations` when it runs. Never edit a
 * migration that has shipped: add a new one. Columns must match `schema.ts`.
 */
export interface Migration {
  readonly version: number;
  readonly name: string;
  readonly sql: string;
}

const v1 = `
CREATE TABLE account (
  id TEXT PRIMARY KEY NOT NULL,
  agent TEXT NOT NULL,
  name TEXT NOT NULL,
  is_primary INTEGER NOT NULL DEFAULT 0,
  use_enabled INTEGER NOT NULL DEFAULT 1,
  state TEXT NOT NULL,
  email_masked TEXT,
  plan TEXT,
  profile_dir TEXT NOT NULL,
  skills_shared INTEGER NOT NULL DEFAULT 1,
  providers TEXT,
  last_isolation_check TEXT,
  created_at TEXT NOT NULL
);

CREATE TABLE quota_window (
  account_id TEXT NOT NULL REFERENCES account(id) ON DELETE CASCADE,
  kind TEXT NOT NULL,
  used_pct REAL NOT NULL,
  resets_at TEXT,
  source TEXT NOT NULL,
  seen_at TEXT NOT NULL,
  PRIMARY KEY (account_id, kind)
);

CREATE TABLE job (
  id TEXT PRIMARY KEY NOT NULL,
  title TEXT NOT NULL,
  mode TEXT NOT NULL,
  spec TEXT NOT NULL,
  status TEXT NOT NULL,
  step TEXT,
  created_at TEXT NOT NULL,
  scheduled_for TEXT
);

CREATE TABLE run_link (
  id TEXT PRIMARY KEY NOT NULL,
  job_id TEXT NOT NULL REFERENCES job(id) ON DELETE CASCADE,
  parent_id TEXT,
  depth INTEGER NOT NULL,
  role TEXT NOT NULL,
  task TEXT NOT NULL,
  agent TEXT NOT NULL,
  account_id TEXT NOT NULL,
  status TEXT NOT NULL,
  worktree TEXT,
  read_only INTEGER NOT NULL,
  session_id TEXT,
  cli_session_id TEXT,
  started_at TEXT,
  resumes_at TEXT
);

CREATE TABLE review (
  worktree TEXT PRIMARY KEY NOT NULL,
  job_id TEXT NOT NULL REFERENCES job(id) ON DELETE CASCADE,
  run_id TEXT,
  session_id TEXT,
  title TEXT NOT NULL,
  state TEXT NOT NULL,
  verdict TEXT NOT NULL,
  checks TEXT NOT NULL,
  files TEXT NOT NULL,
  evidence_ref TEXT,
  note TEXT
);

CREATE TABLE correction (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  worktree TEXT NOT NULL REFERENCES review(worktree) ON DELETE CASCADE,
  what_went_wrong TEXT NOT NULL,
  layer TEXT NOT NULL,
  action TEXT NOT NULL,
  follow_up_job_id TEXT REFERENCES job(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE trust_level (
  agent TEXT PRIMARY KEY NOT NULL,
  level INTEGER NOT NULL CHECK (level IN (1, 2, 3)),
  changed_at TEXT NOT NULL
);
`;

const v2 = `
CREATE INDEX job_status ON job (status);
CREATE INDEX run_link_job ON run_link (job_id);
CREATE INDEX correction_worktree ON correction (worktree);
`;

export const MIGRATIONS: readonly Migration[] = [
  { version: 1, name: 'initial schema', sql: v1 },
  { version: 2, name: 'indexes for job, run and correction lookups', sql: v2 },
];
