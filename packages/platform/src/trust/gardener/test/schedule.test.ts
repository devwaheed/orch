import { describe, expect, it } from 'vitest';
import { nextGardenerRun, wallClockAt, zonedWallTimeToInstant } from '../common/schedule.js';

const ISO = (s: string): Date => new Date(s);

/** The next run, checked against the zone's own wall clock: Monday 09:00. */
function expectMondayNine(run: Date, zone: string): void {
  const wall = wallClockAt(run, zone);
  expect(wall.hour).toBe(9);
  expect(wall.minute).toBe(0);
  expect(wall.second).toBe(0);
  const weekday = new Date(Date.UTC(wall.year, wall.month - 1, wall.day)).getUTCDay();
  expect(weekday).toBe(1);
}

describe('nextGardenerRun (TRU-04: Mondays 09:00 local)', () => {
  it('a Monday before 09:00 is the same day', () => {
    // Monday 2026-10-12 08:59 in London (BST, UTC+1) is 07:59Z.
    const run = nextGardenerRun(ISO('2026-10-12T07:59:00Z'), 'Europe/London');
    expect(run.toISOString()).toBe('2026-10-12T08:00:00.000Z');
  });

  it('exactly 09:00 on a Monday is already due, so the next Monday is returned', () => {
    const run = nextGardenerRun(ISO('2026-10-12T08:00:00Z'), 'Europe/London');
    expect(run.toISOString()).toBe('2026-10-19T08:00:00.000Z');
  });

  it('a Monday after 09:00 is next week', () => {
    const run = nextGardenerRun(ISO('2026-10-12T12:00:00Z'), 'Europe/London');
    expect(run.toISOString()).toBe('2026-10-19T08:00:00.000Z');
  });

  it('from a Sunday evening it is the next morning', () => {
    // Sunday 2026-10-11 23:30 in New York (EDT, UTC-4) is Monday 03:30Z.
    const run = nextGardenerRun(ISO('2026-10-12T03:30:00Z'), 'America/New_York');
    expect(run.toISOString()).toBe('2026-10-12T13:00:00.000Z');
  });

  it('from a Friday it is the following Monday', () => {
    const run = nextGardenerRun(ISO('2026-10-09T10:00:00Z'), 'UTC');
    expect(run.toISOString()).toBe('2026-10-12T09:00:00.000Z');
  });

  it('is 09:00 by the wall clock in every zone it is asked about', () => {
    const now = ISO('2026-10-11T00:00:00Z');
    for (const zone of ['Europe/London', 'America/New_York', 'Australia/Sydney', 'Pacific/Auckland', 'Asia/Kolkata', 'UTC']) {
      expectMondayNine(nextGardenerRun(now, zone), zone);
    }
  });

  describe('DST weeks', () => {
    it('US spring-forward week: 09:00 is EDT, so 13:00Z, after the clocks move on Sunday 2026-03-08', () => {
      // Friday 2026-03-06 12:00 EST (17:00Z) -> Monday 2026-03-09 09:00 EDT.
      const run = nextGardenerRun(ISO('2026-03-06T17:00:00Z'), 'America/New_York');
      expect(run.toISOString()).toBe('2026-03-09T13:00:00.000Z');
      expectMondayNine(run, 'America/New_York');
    });

    it('the run after a spring-forward Monday is 167 hours later: the 09:00 wall time holds across the change', () => {
      // Monday 2026-03-09 09:00 EDT, then the next Monday 09:00 EDT (still DST).
      const first = nextGardenerRun(ISO('2026-03-09T13:00:00Z'), 'America/New_York');
      expect(first.toISOString()).toBe('2026-03-16T13:00:00.000Z');
    });

    it('EU spring week: from Saturday GMT, Monday 09:00 is BST (08:00Z)', () => {
      // EU clocks move on Sunday 2026-03-29. Saturday 2026-03-28 12:00 GMT.
      const run = nextGardenerRun(ISO('2026-03-28T12:00:00Z'), 'Europe/London');
      expect(run.toISOString()).toBe('2026-03-30T08:00:00.000Z');
    });

    it('EU autumn week: Monday 09:00 after the clocks go back is GMT (09:00Z)', () => {
      // EU clocks go back on Sunday 2026-10-25. Saturday 2026-10-24 12:00 BST (11:00Z).
      const run = nextGardenerRun(ISO('2026-10-24T11:00:00Z'), 'Europe/London');
      expect(run.toISOString()).toBe('2026-10-26T09:00:00.000Z');
    });

    it('southern hemisphere: Sydney starts DST on Sunday 2026-10-04, so Monday 09:00 is AEDT (22:00Z Sunday)', () => {
      const run = nextGardenerRun(ISO('2026-10-02T00:00:00Z'), 'Australia/Sydney');
      expect(run.toISOString()).toBe('2026-10-04T22:00:00.000Z');
      expectMondayNine(run, 'Australia/Sydney');
    });
  });
});

describe('zonedWallTimeToInstant', () => {
  it('converts a wall time on either side of a DST change', () => {
    expect(zonedWallTimeToInstant(2026, 3, 9, 9, 0, 'America/New_York').toISOString()).toBe('2026-03-09T13:00:00.000Z');
    expect(zonedWallTimeToInstant(2026, 3, 6, 9, 0, 'America/New_York').toISOString()).toBe('2026-03-06T14:00:00.000Z');
  });
});
