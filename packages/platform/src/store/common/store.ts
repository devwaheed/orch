/**
 * The store service: orch's SQLite database (SEC-04). Plain TypeScript; the
 * driver lives in `node/`. Other platform services get the drizzle handle from
 * here and never open the file themselves.
 */
import { createServiceId } from '@orchagents/base';
import type { OrchError, Result } from '@orchagents/contracts';
import type { BaseSQLiteDatabase } from 'drizzle-orm/sqlite-core';
import type { storeSchema } from './schema.js';

/** SEC-04: 5 rolling backups. Fixed, not a setting. */
export const BACKUP_KEEP_COUNT = 5;

export type StoreDb = BaseSQLiteDatabase<'sync', unknown, typeof storeSchema>;

export interface StoreOpenOptions {
  /** Absolute path of the database file, e.g. `~/.orch/orch.db`. The caller decides. */
  readonly dbPath: string;
  /** Absolute path of the backup folder, e.g. `~/.orch/backups/`. The caller decides. */
  readonly backupDir: string;
}

export interface StoreOpened {
  /** Set when the database was damaged and restored from a backup. Show it to the user. */
  readonly recovery: OrchError | null;
}

export interface StoreBackup {
  readonly path: string;
  /** Time the backup was taken, ISO-8601 UTC. */
  readonly createdAt: string;
}

export interface IStoreService {
  /** Checks integrity, migrates, and restores from the latest good backup if the file is damaged. */
  open(options: StoreOpenOptions): Promise<Result<StoreOpened>>;
  close(): void;
  /** The drizzle handle. Only valid between a successful `open` and `close`. */
  readonly db: StoreDb;
  /** Writes a consistent copy into the backup folder and keeps the newest BACKUP_KEEP_COUNT. */
  backup(): Promise<Result<StoreBackup>>;
}

export const IStoreService = createServiceId<IStoreService>('store');

const BACKUP_PATTERN = /^orch-(\d{4})(\d{2})(\d{2})-(\d{2})(\d{2})(\d{2})-(\d{3})\.db$/;

/**
 * File name for a backup taken at `at`, e.g. `orch-20261011-093000-123.db`.
 * UTC, zero-padded, so names sort oldest to newest as plain strings. No colons,
 * so the name is valid on Windows.
 */
export function backupFileName(at: Date): string {
  const p = (n: number, width = 2) => String(n).padStart(width, '0');
  return `orch-${at.getUTCFullYear()}${p(at.getUTCMonth() + 1)}${p(at.getUTCDate())}-${p(at.getUTCHours())}${p(at.getUTCMinutes())}${p(at.getUTCSeconds())}-${p(at.getUTCMilliseconds(), 3)}.db`;
}

/** The time a backup file name was taken, or null if the name is not a backup name. */
export function parseBackupFileName(name: string): string | null {
  const m = BACKUP_PATTERN.exec(name);
  if (!m) return null;
  const [, y, mo, d, h, mi, s, ms] = m;
  return `${y}-${mo}-${d}T${h}:${mi}:${s}.${ms}Z`;
}

/**
 * User-facing store errors. `fix` says what to do. Proposed copy, not yet in
 * LOCKED.md or a spec; flagged for approval.
 */
export const STORE_ERRORS = {
  restoredFromBackup: (backupCreatedAt: string, damagedName: string) => ({
    code: 'internal' as const,
    message: `orch's database was damaged, so it was restored from the backup made ${backupCreatedAt}.`,
    fix: `The damaged file was kept as ${damagedName} in the orch folder. Work done after that backup is not in orch.`,
  }),
  damagedNoBackup: (dbPath: string) => ({
    code: 'internal' as const,
    message: "orch's database is damaged and there is no good backup to restore.",
    fix: `Move ${dbPath} out of the way and start orch again. orch will create a new, empty database.`,
  }),
  openFailed: (dbPath: string) => ({
    code: 'internal' as const,
    message: "orch could not open its database.",
    fix: `Check that ${dbPath} is readable and not locked by another program, then start orch again.`,
  }),
  newerSchema: {
    code: 'internal' as const,
    message: "orch's database was made by a newer version of orch.",
    fix: 'Update orch to the newest version, then start it again.',
  },
  backupFailed: {
    code: 'internal' as const,
    message: 'orch could not save a backup of its database.',
    fix: 'Check that the backup folder is writable and that the disk has free space, then try again.',
  },
  notOpen: {
    code: 'internal' as const,
    message: "orch's database is not open.",
    fix: 'Restart orch. If this keeps happening, report it with the log file.',
  },
};
