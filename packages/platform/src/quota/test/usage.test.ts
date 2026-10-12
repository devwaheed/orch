import { describe, expect, it } from 'vitest';
import type { QuotaWindow } from '@orchagents/contracts';
import { accountUsedPct, estimatedUsedPct, isStale } from '../common/usage.js';

const NOW = new Date('2026-10-11T12:00:00.000Z');
const hoursAgo = (h: number): string => new Date(NOW.getTime() - h * 3600_000).toISOString();

function win(usedPct: number, seenAt: string): QuotaWindow {
  return { accountId: 'claude-a' as QuotaWindow['accountId'], window: '5h', usedPct, resetsAt: null, source: 'reported', seenAt };
}

describe('QTA-05 stale windows', () => {
  it.each([
    { name: 'a window seen just now is fresh', seenAt: hoursAgo(0), stale: false },
    { name: 'a window seen 5 h ago is fresh', seenAt: hoursAgo(5), stale: false },
    { name: 'a window seen exactly 6 h ago is fresh', seenAt: hoursAgo(6), stale: false },
    { name: 'a window seen 7 h ago is stale', seenAt: hoursAgo(7), stale: true },
  ])('$name', ({ seenAt, stale }) => {
    expect(isStale(win(40, seenAt), NOW)).toBe(stale);
  });

  it.each([
    { name: 'no windows means unknown usage (null)', windows: [], want: null },
    { name: 'a fresh window reports its usage', windows: [win(40, hoursAgo(1))], want: 40 },
    { name: 'a stale window counts as 0 %', windows: [win(90, hoursAgo(7))], want: 0 },
    { name: 'a stale 90 % does not outrank a fresh 30 %', windows: [win(90, hoursAgo(7)), win(30, hoursAgo(1))], want: 30 },
    { name: 'the highest fresh window is the account usage', windows: [win(30, hoursAgo(1)), win(72, hoursAgo(2))], want: 72 },
  ])('accountUsedPct: $name', ({ windows, want }) => {
    expect(accountUsedPct(windows, NOW)).toBe(want);
  });
});

describe('QTA-02 estimated usage', () => {
  it.each([
    { name: 'no limit seen yet: unknown', requests: 12, learned: null, want: null },
    { name: 'learned number of 0 is not usable: unknown', requests: 12, learned: 0, want: null },
    { name: 'requests since reset over the learned number', requests: 50, learned: 100, want: 50 },
    { name: 'past the learned number clamps to 100 %', requests: 150, learned: 100, want: 100 },
  ])('$name', ({ requests, learned, want }) => {
    expect(estimatedUsedPct(requests, learned)).toBe(want);
  });
});
