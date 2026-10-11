import { describe, expect, it } from 'vitest';
import type { AccountId, PickAccountResult, RoutingRule } from '@orch/contracts';
import { routeAccount, type RouteCandidate } from '../common/route.js';

const A = 'claude-a' as AccountId; // oldest
const B = 'claude-b' as AccountId;
const C = 'claude-c' as AccountId;
const D = 'claude-d' as AccountId;

/** A candidate with the defaults a healthy, idle, unlimited account has. */
function c(id: AccountId, over: Partial<RouteCandidate> = {}): RouteCandidate {
  return {
    id,
    primary: false,
    use: true,
    signedOut: false,
    usedPct: 0,
    limited: false,
    resetsAt: null,
    activeRuns: 0,
    ...over,
  };
}

type Row = {
  name: string;
  rule?: RoutingRule;
  nearLimitPct?: number;
  maxRuns?: number;
  candidates: RouteCandidate[];
  expect: PickAccountResult;
};

const pickedAccount = (id: AccountId): PickAccountResult => ({ kind: 'account', accountId: id });

/** Each row is one clause of ACC-05..07 (and the no-account case). Oldest account first. */
const rows: Row[] = [
  // ACC-05: the account flagged primary is the primary, wherever it sits in the list.
  {
    name: 'ACC-05 the primary is the flagged account, not the first listed',
    candidates: [c(A), c(B, { primary: true })],
    expect: pickedAccount(B),
  },

  // ACC-06 primary-first
  {
    name: 'ACC-06 primary-first: primary below near_limit_at (84%) is used',
    candidates: [c(A, { primary: true, usedPct: 84 }), c(B, { usedPct: 0 })],
    expect: pickedAccount(A),
  },
  {
    name: 'ACC-06 primary-first: primary exactly at near_limit_at (85%) moves to backup',
    candidates: [c(A, { primary: true, usedPct: 85 }), c(B, { usedPct: 30 })],
    expect: pickedAccount(B),
  },
  {
    name: 'ACC-06 primary-first: primary above near_limit_at moves to the backup with lowest usage',
    candidates: [c(A, { primary: true, usedPct: 97 }), c(B, { usedPct: 60 }), c(C, { usedPct: 20 }), c(D, { usedPct: 40 })],
    expect: pickedAccount(C),
  },
  {
    name: 'ACC-06 primary-first: custom near_limit_at (50%) is honoured',
    nearLimitPct: 50,
    candidates: [c(A, { primary: true, usedPct: 50 }), c(B, { usedPct: 10 })],
    expect: pickedAccount(B),
  },
  {
    name: 'ACC-06 primary-first: primary with unknown usage is not near, so it is used',
    candidates: [c(A, { primary: true, usedPct: null }), c(B, { usedPct: 0 })],
    expect: pickedAccount(A),
  },
  {
    name: 'ACC-06 primary-first: primary near its limit with no backup able to run is still used',
    candidates: [c(A, { primary: true, usedPct: 95 }), c(B, { usedPct: 5, use: false }), c(C, { usedPct: 5, signedOut: true })],
    expect: pickedAccount(A),
  },
  {
    name: 'ACC-06 primary-first: primary near its limit and backups at max runs is still used',
    candidates: [c(A, { primary: true, usedPct: 95 }), c(B, { activeRuns: 3 })],
    expect: pickedAccount(A),
  },
  {
    name: 'ACC-06 primary-first: a limited primary is never picked, backup is used',
    candidates: [c(A, { primary: true, usedPct: 10, limited: true, resetsAt: '2026-10-11T12:00:00.000Z' }), c(B, { usedPct: 50 })],
    expect: pickedAccount(B),
  },
  {
    name: 'ACC-06 primary-first: a signed-out primary is never picked, backup is used',
    candidates: [c(A, { primary: true, signedOut: true }), c(B, { usedPct: 50 })],
    expect: pickedAccount(B),
  },
  {
    name: 'ACC-06 primary-first: primary with use:false is never picked, backup is used',
    candidates: [c(A, { primary: true, use: false }), c(B, { usedPct: 50 })],
    expect: pickedAccount(B),
  },
  {
    name: 'ACC-06 primary-first: backups tie on usage, the older one wins',
    candidates: [c(A, { primary: true, usedPct: 99 }), c(B, { usedPct: 30 }), c(C, { usedPct: 30 })],
    expect: pickedAccount(B),
  },
  {
    name: 'ACC-06 primary-first: unknown backup usage ranks after a known one',
    candidates: [c(A, { primary: true, usedPct: 99 }), c(B, { usedPct: null }), c(C, { usedPct: 70 })],
    expect: pickedAccount(C),
  },

  // ACC-06 most-headroom
  {
    name: 'ACC-06 most-headroom: picks the lowest usage even when the primary has room',
    rule: 'most-headroom',
    candidates: [c(A, { primary: true, usedPct: 10 }), c(B, { usedPct: 5 })],
    expect: pickedAccount(B),
  },
  {
    name: 'ACC-06 most-headroom: primary at 90% loses to a backup at 20%',
    rule: 'most-headroom',
    candidates: [c(A, { primary: true, usedPct: 90 }), c(B, { usedPct: 20 })],
    expect: pickedAccount(B),
  },
  {
    name: 'ACC-06 most-headroom: ties go to the older account, even a backup',
    rule: 'most-headroom',
    candidates: [c(A, { usedPct: 40 }), c(B, { primary: true, usedPct: 40 })],
    expect: pickedAccount(A),
  },
  {
    name: 'ACC-06 most-headroom: unknown usage ranks after a known 50%',
    rule: 'most-headroom',
    candidates: [c(A, { primary: true, usedPct: null }), c(B, { usedPct: 50 })],
    expect: pickedAccount(B),
  },
  {
    name: 'ACC-06 most-headroom: an account with use:false is never picked, even at 0%',
    rule: 'most-headroom',
    candidates: [c(A, { primary: true, usedPct: 60 }), c(B, { usedPct: 0, use: false })],
    expect: pickedAccount(A),
  },
  {
    name: 'ACC-06 most-headroom: a signed-out account is never picked, even at 0%',
    rule: 'most-headroom',
    candidates: [c(A, { primary: true, usedPct: 60 }), c(B, { usedPct: 0, signedOut: true })],
    expect: pickedAccount(A),
  },
  {
    name: 'ACC-06 most-headroom: a limited account is never picked, even at 0%',
    rule: 'most-headroom',
    candidates: [c(A, { primary: true, usedPct: 60 }), c(B, { usedPct: 0, limited: true, resetsAt: null })],
    expect: pickedAccount(A),
  },

  // ACC-07 max_runs_per_account
  {
    name: 'ACC-07 an account at max runs (3 of 3) is skipped',
    candidates: [c(A, { primary: true, activeRuns: 3 }), c(B, { usedPct: 50 })],
    expect: pickedAccount(B),
  },
  {
    name: 'ACC-07 an account with 2 of 3 active runs still has room',
    candidates: [c(A, { primary: true, activeRuns: 2 }), c(B, { usedPct: 50 })],
    expect: pickedAccount(A),
  },
  {
    name: 'ACC-07 custom max_runs_per_account (1) skips an account with one active run',
    maxRuns: 1,
    candidates: [c(A, { primary: true, activeRuns: 1 }), c(B, { usedPct: 50 })],
    expect: pickedAccount(B),
  },

  // No account available
  {
    name: 'no account: the agent has no accounts at all',
    candidates: [],
    expect: { kind: 'none', agent: 'claude', reason: 'No claude account is signed in and set to use.' },
  },
  {
    name: 'no account: every account is use:false',
    candidates: [c(A, { primary: true, use: false }), c(B, { use: false })],
    expect: { kind: 'none', agent: 'claude', reason: 'No claude account is signed in and set to use.' },
  },
  {
    name: 'no account: every account is signed out',
    candidates: [c(A, { primary: true, signedOut: true })],
    expect: { kind: 'none', agent: 'claude', reason: 'No claude account is signed in and set to use.' },
  },

  // Waiting
  {
    name: 'wait: all usable accounts are limited, earliest reset wins',
    candidates: [
      c(A, { primary: true, limited: true, resetsAt: '2026-10-11T15:00:00.000Z' }),
      c(B, { limited: true, resetsAt: '2026-10-11T13:00:00.000Z' }),
    ],
    expect: { kind: 'wait', agent: 'claude', until: '2026-10-11T13:00:00.000Z' },
  },
  {
    name: 'wait: a limited account with no reset time does not hide a known one',
    candidates: [c(A, { primary: true, limited: true, resetsAt: null }), c(B, { limited: true, resetsAt: '2026-10-11T13:00:00.000Z' })],
    expect: { kind: 'wait', agent: 'claude', until: '2026-10-11T13:00:00.000Z' },
  },
  {
    name: 'wait: limited accounts with no reset times give until null',
    candidates: [c(A, { primary: true, limited: true, resetsAt: null })],
    expect: { kind: 'wait', agent: 'claude', until: null },
  },
  {
    name: 'wait: a use:false account with an earlier reset is not considered',
    candidates: [
      c(A, { primary: true, limited: true, resetsAt: '2026-10-11T15:00:00.000Z' }),
      c(B, { use: false, limited: true, resetsAt: '2026-10-11T10:00:00.000Z' }),
    ],
    expect: { kind: 'wait', agent: 'claude', until: '2026-10-11T15:00:00.000Z' },
  },
  {
    name: 'wait: every usable account is at max runs, no reset time',
    candidates: [c(A, { primary: true, activeRuns: 3 }), c(B, { activeRuns: 3 })],
    expect: { kind: 'wait', agent: 'claude', until: null },
  },
];

describe('routeAccount', () => {
  it.each(rows)('$name', ({ rule = 'primary-first', nearLimitPct = 85, maxRuns = 3, candidates, expect: want }) => {
    const result = routeAccount({ agent: 'claude', rule, nearLimitPct, maxRunsPerAccount: maxRuns, candidates });
    expect(result).toEqual(want);
  });
});
