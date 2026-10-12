import { describe, expect, it } from 'vitest';
import type { SignInResult } from '@orchagents/contracts';
import {
  addAgentChoices,
  canStart,
  cliLine,
  existingLabels,
  signInChecks,
} from '../../src/browser/contrib/accounts/addAccount.js';
import { account, agent } from './fixtures.js';

const signedIn: SignInResult = {
  accountId: 'codex-team' as SignInResult['accountId'],
  signedIn: true,
  emailMasked: 'a•••@acme.dev',
  keptSeparate: true,
  ready: true,
  identity: 'checked',
};

describe('addAgentChoices (ACC-03)', () => {
  it('greys out a single-account OS agent once it has an account', () => {
    const choices = addAgentChoices(
      [agent('agy', 'single', { displayName: 'Antigravity' }), agent('codex', 'parallel', { displayName: 'Codex' })],
      [account('agy-main', 'agy')],
      'macos',
    );
    expect(choices[0]).toMatchObject({ agent: 'agy', disabled: true, sub: 'One account on macOS (already added)' });
    expect(choices[1]).toMatchObject({ agent: 'codex', disabled: false, sub: '0 added · several allowed' });
  });

  it('keeps a single-account agent pickable while it has none', () => {
    const [choice] = addAgentChoices([agent('agy', 'single', { displayName: 'Antigravity' })], [], 'windows');
    expect(choice?.disabled).toBe(false);
  });

  it('says a new agent will be tested first when its support is unverified', () => {
    const [choice] = addAgentChoices([agent('opencode', 'unverified', { displayName: 'OpenCode' })], [], 'windows');
    expect(choice?.sub).toBe('Will be tested first on Windows');
    expect(choice?.warn).toBe(true);
  });

  it('counts accounts per agent for the subtitle', () => {
    const [choice] = addAgentChoices(
      [agent('claude', 'parallel', { displayName: 'Claude Code' })],
      [account('claude-personal', 'claude'), account('claude-work', 'claude')],
      'linux',
    );
    expect(choice?.sub).toBe('2 added · several allowed');
  });
});

describe('canStart', () => {
  it('needs an agent and a name of 1 to 40 characters', () => {
    expect(canStart(null, 'Work')).toBe(false);
    expect(canStart('claude', '  ')).toBe(false);
    expect(canStart('claude', 'Work')).toBe(true);
    expect(canStart('claude', 'x'.repeat(41))).toBe(false);
  });
});

describe('signInChecks', () => {
  it('shows the masked email under Signed in when the identity was checked', () => {
    const rows = signInChecks(signedIn, []);
    expect(rows.map((r) => r.title)).toEqual(['Signed in', 'Kept separate', 'Ready']);
    expect(rows[0]?.text).toBe('as a•••@acme.dev');
    expect(rows.every((r) => r.ok)).toBe(true);
  });

  it('renders an unknown identity without an email and without claiming it was checked', () => {
    const rows = signInChecks({ ...signedIn, identity: 'unknown', emailMasked: undefined }, []);
    expect(rows[0]).toMatchObject({ key: 'signedIn', text: null, ok: true });
  });

  it('ignores an email when the identity is unknown, even if one is present', () => {
    const rows = signInChecks({ ...signedIn, identity: 'unknown' }, []);
    expect(rows[0]?.text).toBeNull();
  });

  it('names the other accounts of the same agent under Kept separate', () => {
    const rows = signInChecks(signedIn, ['Personal', 'Work']);
    expect(rows[1]?.text).toBe('orch confirmed this login is different from Personal and Work.');
  });

  it('says the account is in its own folder when it is the first of its agent', () => {
    expect(signInChecks(signedIn, [])[1]?.text).toBe('in its own private folder.');
  });

  it('marks a failed check as not ok', () => {
    const rows = signInChecks({ ...signedIn, keptSeparate: false }, []);
    expect(rows.find((r) => r.key === 'keptSeparate')?.ok).toBe(false);
  });

  it('gives the Ready copy from the design', () => {
    expect(signInChecks(signedIn, [])[2]?.text).toBe('usage tracking is on and orch can route work to it.');
  });
});

describe('existingLabels and cliLine', () => {
  it('lists the labels of an agent accounts only', () => {
    const accounts = [account('claude-personal', 'claude', { name: 'Personal' }), account('codex-team', 'codex', { name: 'Team' })];
    expect(existingLabels(accounts, 'claude')).toEqual(['Personal']);
    expect(existingLabels(accounts, null)).toEqual([]);
  });

  it('shows the equivalent CLI line, or the placeholder before an agent is picked', () => {
    expect(cliLine('codex', 'Client')).toBe('orch accounts add codex "Client"');
    expect(cliLine(null, 'Work')).toBe('orch accounts add <agent> "<name>"');
  });
});
