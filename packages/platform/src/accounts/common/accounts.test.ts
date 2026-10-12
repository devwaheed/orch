import type { AccountId, AgentId } from '@orchagents/contracts';
import { describe, expect, it } from 'vitest';
import { accountKey, evaluateSignIn, oldestFirst } from './accounts.js';
import { primaryToPromote } from './primaries.js';

const base = {
  loginOk: true,
  identityCheckAvailable: true,
  statusSignedIn: true,
  emailMasked: 'a•••@acme.dev' as string | null,
  envInsideProfile: true,
  others: [] as { id: AccountId; emailMasked: string | null }[],
};

describe('evaluateSignIn (SignInResult checks)', () => {
  it('is ready when signed in and kept separate', () => {
    expect(evaluateSignIn(base)).toEqual({
      signedIn: true,
      emailMasked: 'a•••@acme.dev',
      identityKnown: true,
      keptSeparate: true,
      ready: true,
    });
  });

  it('is not signed in when the status finds no login', () => {
    expect(evaluateSignIn({ ...base, statusSignedIn: false, emailMasked: null }).signedIn).toBe(false);
  });

  it('a status that names no account (codex, agy) is signed in, identity unknown, never a clash', () => {
    const outcome = evaluateSignIn({
      ...base,
      emailMasked: null,
      loginOk: false,
      others: [{ id: 'codex-a' as AccountId, emailMasked: null }],
    });
    expect(outcome).toMatchObject({ signedIn: true, identityKnown: false, keptSeparate: true, ready: true });
  });

  it('treats an unknown identity (no status command) as signed in with identity unknown', () => {
    const outcome = evaluateSignIn({ ...base, identityCheckAvailable: false, statusSignedIn: false, emailMasked: null });
    expect(outcome).toMatchObject({ signedIn: true, identityKnown: false, keptSeparate: true, ready: true });
  });

  it('is not kept separate when the identity matches another account', () => {
    const outcome = evaluateSignIn({ ...base, others: [{ id: 'claude-x' as AccountId, emailMasked: 'a•••@acme.dev' }] });
    expect(outcome.keptSeparate).toBe(false);
    expect(outcome.ready).toBe(false);
  });

  it('is not kept separate when the settings leave the profile folder', () => {
    expect(evaluateSignIn({ ...base, envInsideProfile: false }).ready).toBe(false);
  });
});

describe('ACC-05 helpers', () => {
  const c = (id: string, agent: AgentId, createdAt: string) => ({ id: id as AccountId, agent, createdAt });

  it('promotes the oldest account of an agent that has no primary', () => {
    const promote = primaryToPromote(
      [c('claude-new', 'claude', '2026-10-11T10:00:00.000Z'), c('claude-old', 'claude', '2026-10-11T09:00:00.000Z')].sort(
        (a, b) => (a.createdAt < b.createdAt ? -1 : 1),
      ),
      () => false,
    );
    expect([...promote.entries()]).toEqual([['claude', 'claude-old']]);
  });

  it('promotes nothing for an agent that already has a primary', () => {
    const promote = primaryToPromote([c('claude-a', 'claude', '2026-10-11T09:00:00.000Z')], (id) => id === 'claude-a');
    expect(promote.size).toBe(0);
  });

  it('orders by created_at and keeps insertion order for ties', () => {
    const rows = [
      { id: 'b', createdAt: '2026-10-11T09:00:00.000Z' },
      { id: 'a', createdAt: '2026-10-11T09:00:00.000Z' },
      { id: 'c', createdAt: '2026-10-11T08:00:00.000Z' },
    ];
    expect(oldestFirst(rows).map((r) => r.id)).toEqual(['c', 'b', 'a']);
  });

  it('derives the key under accounts.<agent> from the account id', () => {
    expect(accountKey('claude-my-team-2', 'claude')).toBe('my-team-2');
  });
});
