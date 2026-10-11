import { describe, expect, it } from 'vitest';
import { AccountsFile } from '@orch/contracts';
import { fieldPath, sameConfig } from './config.js';

describe('fieldPath', () => {
  it('joins path segments with dots, and is empty for the whole file', () => {
    expect(fieldPath(['limits', 'near_limit_at'])).toBe('limits.near_limit_at');
    expect(fieldPath(['accounts', 'claude', 'team'])).toBe('accounts.claude.team');
    expect(fieldPath([])).toBe('');
  });
});

describe('sameConfig', () => {
  const base = AccountsFile.parse({ routing: 'most-headroom', accounts: { codex: { work: { primary: true } } } });

  it('ignores key order', () => {
    const reordered = AccountsFile.parse({ accounts: { codex: { work: { primary: true } } }, routing: 'most-headroom' });
    expect(sameConfig(base, reordered)).toBe(true);
  });

  it('sees a changed value, an added account and a changed default', () => {
    expect(sameConfig(base, AccountsFile.parse({ ...base, routing: 'primary-first' }))).toBe(false);
    expect(
      sameConfig(base, AccountsFile.parse({ ...base, accounts: { codex: { work: { primary: true }, home: {} } } })),
    ).toBe(false);
    expect(sameConfig(base, AccountsFile.parse({ ...base, limits: { max_runs_per_account: 4 } }))).toBe(false);
  });
});
