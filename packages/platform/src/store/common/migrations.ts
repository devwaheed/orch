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

const v3 = `
ALTER TABLE run_link ADD COLUMN auto_resume INTEGER NOT NULL DEFAULT 1;
ALTER TABLE run_link ADD COLUMN resume_fire_at TEXT;
`;

const v4 = `
CREATE TABLE session (
  id TEXT PRIMARY KEY NOT NULL,
  job_id TEXT NOT NULL REFERENCES job(id) ON DELETE CASCADE,
  run_id TEXT,
  title TEXT NOT NULL,
  agent TEXT NOT NULL,
  account_id TEXT NOT NULL,
  cli_session_id TEXT NOT NULL,
  status TEXT NOT NULL,
  worktree TEXT,
  started_at TEXT NOT NULL,
  last_activity_at TEXT NOT NULL,
  tokens INTEGER NOT NULL DEFAULT 0,
  position TEXT NOT NULL,
  handed_off_to TEXT,
  handed_off_from TEXT,
  engine_handle TEXT,
  cwd TEXT
);
CREATE INDEX session_engine_handle ON session (engine_handle);
`;

const v5 = `
CREATE TABLE quota_limit (
  account_id TEXT PRIMARY KEY NOT NULL REFERENCES account(id) ON DELETE CASCADE,
  resets_at TEXT
);

CREATE TABLE quota_estimate (
  account_id TEXT PRIMARY KEY NOT NULL REFERENCES account(id) ON DELETE CASCADE,
  window TEXT,
  requests_since_reset INTEGER NOT NULL DEFAULT 0,
  learned_limit INTEGER,
  resets_at TEXT
);
`;

const v6 = `
CREATE TABLE review_repo_scoped (
  repo_path TEXT NOT NULL,
  worktree TEXT NOT NULL,
  job_id TEXT NOT NULL REFERENCES job(id) ON DELETE CASCADE,
  run_id TEXT,
  session_id TEXT,
  title TEXT NOT NULL,
  state TEXT NOT NULL,
  verdict TEXT NOT NULL,
  checks TEXT NOT NULL,
  files TEXT NOT NULL,
  evidence_ref TEXT,
  note TEXT,
  PRIMARY KEY (repo_path, worktree)
);

INSERT INTO review_repo_scoped (repo_path, worktree, job_id, run_id, session_id, title, state, verdict, checks, files, evidence_ref, note)
SELECT json_extract(job.spec, '$.repoPath'), review.worktree, review.job_id, review.run_id, review.session_id,
       review.title, review.state, review.verdict, review.checks, review.files, review.evidence_ref, review.note
FROM review JOIN job ON job.id = review.job_id
WHERE json_extract(job.spec, '$.repoPath') IS NOT NULL;

CREATE TABLE correction_repo_scoped (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  repo_path TEXT NOT NULL,
  worktree TEXT NOT NULL,
  what_went_wrong TEXT NOT NULL,
  layer TEXT NOT NULL,
  action TEXT NOT NULL,
  follow_up_job_id TEXT REFERENCES job(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL,
  FOREIGN KEY (repo_path, worktree) REFERENCES review_repo_scoped(repo_path, worktree) ON DELETE CASCADE
);

INSERT INTO correction_repo_scoped (id, repo_path, worktree, what_went_wrong, layer, action, follow_up_job_id, created_at)
SELECT correction.id, review.repo_path, correction.worktree, correction.what_went_wrong, correction.layer,
       correction.action, correction.follow_up_job_id, correction.created_at
FROM correction JOIN review_repo_scoped AS review ON review.worktree = correction.worktree;

DROP TABLE correction;
DROP TABLE review;
ALTER TABLE review_repo_scoped RENAME TO review;
ALTER TABLE correction_repo_scoped RENAME TO correction;
CREATE INDEX correction_worktree ON correction (repo_path, worktree);
`;

export const MIGRATIONS: readonly Migration[] = [
  { version: 1, name: 'initial schema', sql: v1 },
  { version: 2, name: 'indexes for job, run and correction lookups', sql: v2 },
  { version: 3, name: 'run auto-resume flag and scheduled resume time', sql: v3 },
  { version: 4, name: 'session records', sql: v4 },
  { version: 5, name: 'quota limits and request estimates', sql: v5 },
  { version: 6, name: 'repo-scoped review rows', sql: v6 },
];
