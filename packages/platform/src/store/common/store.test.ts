import { describe, expect, it } from 'vitest';
import { MIGRATIONS } from './migrations.js';
import { backupFileName, parseBackupFileName } from './store.js';

describe('backupFileName', () => {
  it('uses a UTC, zero-padded, colon-free name that sorts by time', () => {
    const at = new Date(Date.UTC(2026, 9, 11, 9, 5, 7, 4));
    expect(backupFileName(at)).toBe('orch-20261011-090507-004.db');
    const earlier = backupFileName(new Date(Date.UTC(2026, 0, 2, 0, 0, 0, 0)));
    const later = backupFileName(new Date(Date.UTC(2026, 0, 10, 0, 0, 0, 0)));
    expect([later, earlier].sort()).toEqual([earlier, later]);
  });

  it('parses its own names back to an ISO timestamp', () => {
    const at = new Date(Date.UTC(2026, 9, 11, 9, 5, 7, 4));
    expect(parseBackupFileName(backupFileName(at))).toBe('2026-10-11T09:05:07.004Z');
    expect(parseBackupFileName('orch.db')).toBeNull();
    expect(parseBackupFileName('orch-20261011-090507-004.db.tmp')).toBeNull();
  });
});

describe('MIGRATIONS', () => {
  it('has unique, consecutive versions starting at 1', () => {
    expect(MIGRATIONS.map((m) => m.version)).toEqual(MIGRATIONS.map((_, i) => i + 1));
  });
});
