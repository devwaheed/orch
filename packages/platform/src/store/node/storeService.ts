import { existsSync } from 'node:fs';
import { copyFile, mkdir, readdir, rename, rm, stat } from 'node:fs/promises';
import path from 'node:path';
import type { OrchError, Result } from '@orchagents/contracts';
import { err, ok } from '@orchagents/base';
import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { MIGRATIONS } from '../common/migrations.js';
import {
  BACKUP_KEEP_COUNT,
  type IStoreService,
  type StoreBackup,
  type StoreDb,
  type StoreOpenOptions,
  type StoreOpened,
  STORE_ERRORS,
  backupFileName,
  parseBackupFileName,
} from '../common/store.js';
import { storeSchema } from '../common/schema.js';
import { NewerSchemaError, migrate } from './migrator.js';

type Attempt =
  | { kind: 'opened'; raw: Database.Database }
  | { kind: 'corrupt' }
  | { kind: 'error'; error: OrchError };

/** SQLite error codes that mean the file itself is damaged (not merely busy or unreadable). */
const CORRUPT_CODES = new Set(['SQLITE_NOTADB', 'SQLITE_CORRUPT']);

function isCorruptError(e: unknown): boolean {
  return typeof e === 'object' && e !== null && 'code' in e && CORRUPT_CODES.has(String((e as { code: unknown }).code));
}

/**
 * Opens a database file, enables WAL and foreign keys, checks integrity and
 * migrates. Never modifies the file when it reports a non-corruption error.
 */
function attemptOpen(file: string, now: () => string): Attempt {
  let raw: Database.Database | null = null;
  try {
    raw = new Database(file);
    raw.pragma('journal_mode = WAL');
    raw.pragma('foreign_keys = ON');
    if (raw.pragma('integrity_check', { simple: true }) !== 'ok') {
      raw.close();
      return { kind: 'corrupt' };
    }
    migrate(raw, MIGRATIONS, now);
    return { kind: 'opened', raw };
  } catch (e) {
    raw?.close();
    if (e instanceof NewerSchemaError) return { kind: 'error', error: STORE_ERRORS.newerSchema };
    if (isCorruptError(e)) return { kind: 'corrupt' };
    return { kind: 'error', error: STORE_ERRORS.openFailed(file) };
  }
}

/** Read-only check of a backup file. Never migrates or changes it. */
function isGoodBackup(file: string): boolean {
  let raw: Database.Database | null = null;
  try {
    raw = new Database(file, { readonly: true, fileMustExist: true });
    return raw.pragma('integrity_check', { simple: true }) === 'ok';
  } catch {
    return false;
  } finally {
    raw?.close();
  }
}

/** Backup file names in `dir`, newest first. */
async function listBackups(dir: string): Promise<string[]> {
  const names = (await readdir(dir)).filter((n) => parseBackupFileName(n) !== null);
  return names.sort().reverse();
}

export class StoreService implements IStoreService {
  private raw: Database.Database | null = null;
  private drizzleDb: StoreDb | null = null;
  private dbPath: string | null = null;
  private backupDir: string | null = null;

  async open(options: StoreOpenOptions): Promise<Result<StoreOpened>> {
    this.close();
    const { dbPath, backupDir } = options;
    const now = () => new Date().toISOString();
    try {
      await mkdir(path.dirname(dbPath), { recursive: true });
      await mkdir(backupDir, { recursive: true });
    } catch {
      return err(STORE_ERRORS.openFailed(dbPath));
    }

    const first = attemptOpen(dbPath, now);
    if (first.kind === 'error') return err(first.error);
    if (first.kind === 'opened') {
      this.use(first.raw, dbPath, backupDir);
      return ok({ recovery: null });
    }
    return this.recover(dbPath, backupDir, now);
  }

  /**
   * The file is damaged: keep it aside (with any WAL and SHM files, so a stale
   * WAL cannot be replayed onto the backup), copy the newest good backup into
   * place and open that.
   */
  private async recover(dbPath: string, backupDir: string, now: () => string): Promise<Result<StoreOpened>> {
    let names: string[];
    try {
      names = await listBackups(backupDir);
    } catch {
      return err(STORE_ERRORS.damagedNoBackup(dbPath));
    }
    const chosen = names.find((n) => isGoodBackup(path.join(backupDir, n)));
    if (!chosen) return err(STORE_ERRORS.damagedNoBackup(dbPath));

    const dir = path.dirname(dbPath);
    const damagedName = `${path.basename(dbPath)}.damaged-${now().replace(/[:.]/g, '-')}`;
    try {
      await rename(dbPath, path.join(dir, damagedName));
      for (const suffix of ['-wal', '-shm']) {
        if (existsSync(dbPath + suffix)) await rename(dbPath + suffix, path.join(dir, damagedName + suffix));
      }
      await copyFile(path.join(backupDir, chosen), dbPath);
    } catch {
      return err(STORE_ERRORS.openFailed(dbPath));
    }

    const second = attemptOpen(dbPath, now);
    if (second.kind !== 'opened') {
      return err(second.kind === 'error' ? second.error : STORE_ERRORS.openFailed(dbPath));
    }
    this.use(second.raw, dbPath, backupDir);
    const createdAt = parseBackupFileName(chosen) ?? chosen;
    return ok({ recovery: STORE_ERRORS.restoredFromBackup(createdAt, damagedName) });
  }

  private use(raw: Database.Database, dbPath: string, backupDir: string): void {
    this.raw = raw;
    this.drizzleDb = drizzle(raw, { schema: storeSchema });
    this.dbPath = dbPath;
    this.backupDir = backupDir;
  }

  close(): void {
    this.raw?.close();
    this.raw = null;
    this.drizzleDb = null;
  }

  get db(): StoreDb {
    if (!this.drizzleDb) throw new Error(STORE_ERRORS.notOpen.message);
    return this.drizzleDb;
  }

  async backup(): Promise<Result<StoreBackup>> {
    if (!this.raw || !this.backupDir) return err(STORE_ERRORS.notOpen);
    const dir = this.backupDir;
    let tmp: string | null = null;
    try {
      let at = new Date();
      while (existsSync(path.join(dir, backupFileName(at)))) at = new Date(at.getTime() + 1);
      const name = backupFileName(at);
      const finalPath = path.join(dir, name);
      tmp = `${finalPath}.tmp`;
      await this.raw.backup(tmp);
      await rename(tmp, finalPath);
      tmp = null;
      await this.prune(dir);
      return ok({ path: finalPath, createdAt: at.toISOString() });
    } catch {
      if (tmp) await rm(tmp, { force: true }).catch(() => undefined);
      return err(STORE_ERRORS.backupFailed);
    }
  }

  /** Keeps the newest BACKUP_KEEP_COUNT backups. Only files with backup names are touched. */
  private async prune(dir: string): Promise<void> {
    const names = await listBackups(dir);
    for (const old of names.slice(BACKUP_KEEP_COUNT)) {
      await rm(path.join(dir, old), { force: true });
    }
  }
}

/** Used by tests to check the file exists without importing `stat` at call sites. */
export async function fileExists(file: string): Promise<boolean> {
  try {
    await stat(file);
    return true;
  } catch {
    return false;
  }
}
