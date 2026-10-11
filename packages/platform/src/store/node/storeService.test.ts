import Database from 'better-sqlite3';
import { mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { MIGRATIONS } from '../common/migrations.js';
import { BACKUP_KEEP_COUNT, STORE_ERRORS, parseBackupFileName } from '../common/store.js';
import { StoreService } from './storeService.js';
import { migrate } from './migrator.js';
import { accountTable } from '../common/schema.js';

let root: string;
let dbPath: string;
let backupDir: string;
const services: StoreService[] = [];

function newService(): StoreService {
  const s = new StoreService();
  services.push(s);
  return s;
}

function accountRow(id: string) {
  return {
    id,
    agent: 'claude' as const,
    name: 'Team',
    isPrimary: true,
    useEnabled: true,
    state: 'available' as const,
    profileDir: `/home/u/.orch/profiles/${id}`,
    skillsShared: true,
    createdAt: '2026-10-11T09:00:00.000Z',
  };
}

function tableNames(raw: Database.Database): string[] {
  return (raw.prepare("SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name").all() as { name: string }[]).map(
    (r) => r.name,
  );
}

beforeEach(async () => {
  root = await mkdtemp(path.join(tmpdir(), 'orch-store-'));
  dbPath = path.join(root, 'orch.db');
  backupDir = path.join(root, 'backups');
});

afterEach(async () => {
  for (const s of services) s.close();
  services.length = 0;
  await rm(root, { recursive: true, force: true });
});

describe('StoreService.open', () => {
  it('migrates up from an empty folder, in WAL mode, and every table accepts drizzle writes', async () => {
    const store = newService();
    const result = await store.open({ dbPath, backupDir });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.recovery).toBeNull();

    await store.db.insert(accountTable).values(accountRow('claude-team'));
    const check = new Database(dbPath, { readonly: true });
    try {
      expect(check.pragma('journal_mode', { simple: true })).toBe('wal');
      expect(check.pragma('integrity_check', { simple: true })).toBe('ok');
      expect(tableNames(check)).toEqual(
        expect.arrayContaining(['account', 'quota_window', 'job', 'run_link', 'review', 'correction', 'trust_level', 'schema_migrations']),
      );
      const versions = (check.prepare('SELECT version FROM schema_migrations ORDER BY version').all() as { version: number }[]).map(
        (r) => r.version,
      );
      expect(versions).toEqual(MIGRATIONS.map((m) => m.version));
    } finally {
      check.close();
    }
  });

  it('migrates up from the previous version (v1 only) and keeps existing rows', async () => {
    const old = new Database(dbPath);
    migrate(old, MIGRATIONS.slice(0, 1), () => '2026-10-10T00:00:00.000Z');
    old.prepare(
      'INSERT INTO account (id, agent, name, is_primary, use_enabled, state, profile_dir, skills_shared, created_at) VALUES (?, ?, ?, 1, 1, ?, ?, 1, ?)',
    ).run('claude-team', 'claude', 'Team', 'available', '/p', '2026-10-10T00:00:00.000Z');
    const indexesBefore = old.prepare("SELECT name FROM sqlite_master WHERE type = 'index' AND name = 'job_status'").all();
    expect(indexesBefore).toHaveLength(0);
    old.close();

    const store = newService();
    const result = await store.open({ dbPath, backupDir });
    expect(result.ok).toBe(true);
    const rows = await store.db.select().from(accountTable);
    expect(rows.map((r) => r.id)).toEqual(['claude-team']);

    const check = new Database(dbPath, { readonly: true });
    try {
      const versions = (check.prepare('SELECT version FROM schema_migrations ORDER BY version').all() as { version: number }[]).map(
        (r) => r.version,
      );
      expect(versions).toEqual([1, 2, 3]);
      expect(check.prepare("SELECT name FROM sqlite_master WHERE type = 'index' AND name = 'job_status'").all()).toHaveLength(1);
    } finally {
      check.close();
    }
  });

  it('refuses a database made by a newer orch, without changing it', async () => {
    const newer = new Database(dbPath);
    migrate(newer, MIGRATIONS, () => '2026-10-10T00:00:00.000Z');
    newer.prepare('INSERT INTO schema_migrations (version, name, applied_at) VALUES (99, ?, ?)').run('future', '2026-10-10T00:00:00.000Z');
    newer.close();

    const store = newService();
    const result = await store.open({ dbPath, backupDir });
    expect(result).toEqual({ ok: false, error: STORE_ERRORS.newerSchema });
  });

  it('restores a damaged file from the latest good backup and reports a clear error', async () => {
    const first = newService();
    await first.open({ dbPath, backupDir });
    await first.db.insert(accountTable).values(accountRow('claude-team'));
    const backup = await first.backup();
    expect(backup.ok).toBe(true);
    first.close();

    await writeFile(dbPath, 'this is not a database, just garbage bytes '.repeat(200));
    await rm(`${dbPath}-wal`, { force: true });
    await rm(`${dbPath}-shm`, { force: true });

    const store = newService();
    const result = await store.open({ dbPath, backupDir });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const recovery = result.value.recovery;
    expect(recovery).not.toBeNull();
    expect(recovery?.code).toBe('internal');
    expect(recovery?.message).toMatch(/restored from the backup made/);
    expect(recovery?.fix).toMatch(/orch\.db\.damaged-/);

    const rows = await store.db.select().from(accountTable);
    expect(rows.map((r) => r.id)).toEqual(['claude-team']);

    const damaged = (await readdir(root)).filter((n) => n.startsWith('orch.db.damaged-'));
    expect(damaged).toHaveLength(1);
    expect((await readFile(path.join(root, damaged[0] as string))).toString()).toContain('this is not a database');
  });

  it('skips a broken newest backup and restores the next good one', async () => {
    const first = newService();
    await first.open({ dbPath, backupDir });
    await first.db.insert(accountTable).values(accountRow('claude-team'));
    await first.backup();
    first.close();
    const goodName = (await readdir(backupDir))[0] as string;

    await new Promise((r) => setTimeout(r, 5));
    const newerName = 'orch-29991231-235959-999.db';
    await writeFile(path.join(backupDir, newerName), 'garbage');
    await writeFile(dbPath, 'garbage');

    const store = newService();
    const result = await store.open({ dbPath, backupDir });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.recovery?.message).toContain(parseBackupFileName(goodName) ?? 'unparsed');
    expect((await store.db.select().from(accountTable)).map((r) => r.id)).toEqual(['claude-team']);
  });

  it('returns an error and leaves the damaged file alone when there is no backup', async () => {
    await writeFile(dbPath, 'garbage bytes '.repeat(100));
    const store = newService();
    const result = await store.open({ dbPath, backupDir });
    expect(result).toEqual({ ok: false, error: STORE_ERRORS.damagedNoBackup(dbPath) });
    expect(await readFile(dbPath, 'utf8')).toContain('garbage bytes');
  });
});

describe('StoreService.backup', () => {
  it('keeps the newest five backups and deletes older ones', async () => {
    const store = newService();
    await store.open({ dbPath, backupDir });
    const made: string[] = [];
    for (let i = 0; i < BACKUP_KEEP_COUNT + 2; i++) {
      const result = await store.backup();
      expect(result.ok).toBe(true);
      if (result.ok) made.push(path.basename(result.value.path));
    }
    const kept = (await readdir(backupDir)).sort();
    expect(kept).toHaveLength(BACKUP_KEEP_COUNT);
    expect(kept).toEqual(made.slice(-BACKUP_KEEP_COUNT).sort());
  });

  it('returns a not-open error before open', async () => {
    const store = newService();
    expect(await store.backup()).toEqual({ ok: false, error: STORE_ERRORS.notOpen });
  });

  it('throws from the db handle when the store is not open', () => {
    const store = newService();
    expect(() => store.db).toThrow(STORE_ERRORS.notOpen.message);
  });
});
