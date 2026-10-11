import type Database from 'better-sqlite3';
import type { Migration } from '../common/migrations.js';

export class NewerSchemaError extends Error {
  constructor(readonly version: number) {
    super(`database schema version ${version} is newer than this build`);
    this.name = 'NewerSchemaError';
  }
}

/**
 * Applies every migration whose version is not yet recorded in
 * `schema_migrations`, in version order, each in its own transaction. Throws
 * NewerSchemaError if the database has a version this build does not know.
 */
export function migrate(raw: Database.Database, migrations: readonly Migration[], appliedAt: () => string): void {
  raw.exec(
    'CREATE TABLE IF NOT EXISTS schema_migrations (version INTEGER PRIMARY KEY NOT NULL, name TEXT NOT NULL, applied_at TEXT NOT NULL)',
  );
  const known = new Set(migrations.map((m) => m.version));
  const applied = raw.prepare('SELECT version FROM schema_migrations').all() as { version: number }[];
  for (const row of applied) {
    if (!known.has(row.version)) throw new NewerSchemaError(row.version);
  }
  const appliedVersions = new Set(applied.map((r) => r.version));
  const record = raw.prepare('INSERT INTO schema_migrations (version, name, applied_at) VALUES (?, ?, ?)');
  for (const m of [...migrations].sort((a, b) => a.version - b.version)) {
    if (appliedVersions.has(m.version)) continue;
    raw.transaction(() => {
      raw.exec(m.sql);
      record.run(m.version, m.name, appliedAt());
    })();
  }
}
