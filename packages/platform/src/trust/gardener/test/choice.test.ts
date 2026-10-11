import type { Account, AccountId, AgentId, TrustLevel } from '@orch/contracts';
import { describe, expect, it } from 'vitest';
import { chooseGardenerAccount } from '../common/choice.js';

function account(id: string, overrides: Partial<Account> = {}): Account {
  const agent = id.split('-')[0] as AgentId;
  return {
    id: id as AccountId,
    agent,
    name: id,
    primary: true,
    use: true,
    state: 'available',
    profileDir: `/profiles/${id}`,
    skillsShared: false,
    ...overrides,
  };
}

const levels =
  (map: Partial<Record<AgentId, TrustLevel>>) =>
  (agent: AgentId): TrustLevel =>
    map[agent] ?? 1;

describe('chooseGardenerAccount (TRU-04)', () => {
  it('picks the primary account of the highest-level agent', () => {
    const accounts = [account('claude-personal'), account('codex-team')];
    expect(chooseGardenerAccount(accounts, levels({ codex: 2 }))).toEqual({ agent: 'codex', accountId: 'codex-team' });
  });

  it('ties go to the agent earlier in the ACC order (claude, codex, gemini, opencode, agy)', () => {
    const accounts = [account('agy-main'), account('gemini-main'), account('codex-main'), account('claude-main')];
    expect(chooseGardenerAccount(accounts, levels({ agy: 3, gemini: 3, codex: 3, claude: 3 }))).toEqual({
      agent: 'claude',
      accountId: 'claude-main',
    });
    expect(chooseGardenerAccount(accounts, levels({ agy: 3, gemini: 3, codex: 2 }))).toEqual({
      agent: 'gemini',
      accountId: 'gemini-main',
    });
  });

  it('uses the primary account only, never a backup at a higher level', () => {
    const accounts = [account('claude-main'), account('claude-backup', { primary: false })];
    expect(chooseGardenerAccount(accounts, levels({ claude: 1 }))).toEqual({ agent: 'claude', accountId: 'claude-main' });
  });

  it('skips an agent whose primary is unusable and picks the next best agent', () => {
    const cases: Partial<Account>[] = [{ use: false }, { state: 'signed_out' }, { state: 'limited' }];
    for (const overrides of cases) {
      const accounts = [account('claude-main', overrides), account('codex-main')];
      expect(chooseGardenerAccount(accounts, levels({ claude: 3, codex: 1 }))).toEqual({
        agent: 'codex',
        accountId: 'codex-main',
      });
    }
  });

  it('a near-limit primary is still usable (ACC-06 only excludes use off, signed out and limited)', () => {
    const accounts = [account('claude-main', { state: 'near_limit' })];
    expect(chooseGardenerAccount(accounts, levels({}))).toEqual({ agent: 'claude', accountId: 'claude-main' });
  });

  it('returns null when no agent has a usable primary account, so the week is skipped', () => {
    expect(chooseGardenerAccount([], levels({}))).toBeNull();
    expect(chooseGardenerAccount([account('claude-main', { use: false })], levels({}))).toBeNull();
  });
});
