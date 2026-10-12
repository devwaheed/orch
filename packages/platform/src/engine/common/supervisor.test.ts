import { describe, expect, it } from 'vitest';
import type { OrchEvent } from '@orchagents/contracts';
import { EngineSupervisor, type LaunchedEngine, restartDelayMs } from './supervisor.js';

/** Fake clock: timers fire when `advance` passes their due time. */
function fakeClock() {
  let now = 0;
  const timers: Array<{ due: number; fn: () => void; cancelled: boolean }> = [];
  return {
    clock: {
      now: () => now,
      setTimer(fn: () => void, ms: number) {
        const timer = { due: now + ms, fn, cancelled: false };
        timers.push(timer);
        return () => {
          timer.cancelled = true;
        };
      },
    },
    advance(ms: number) {
      now += ms;
      for (const timer of timers) {
        if (!timer.cancelled && timer.due <= now) {
          timer.cancelled = true;
          timer.fn();
        }
      }
    },
    pendingCount: () => timers.filter((t) => !t.cancelled).length,
  };
}

function harness() {
  const clock = fakeClock();
  const events: Array<Extract<OrchEvent, { type: 'engine.health' }>> = [];
  const launches: Array<{ exit: (reason: string) => void; stopped: boolean }> = [];
  const supervisor = new EngineSupervisor({
    clock: clock.clock,
    emit: (event) => events.push(event),
    launch: (): LaunchedEngine => {
      const launch: { exit: (reason: string) => void; stopped: boolean } = {
        exit: (reason) => exitListener?.(reason),
        stopped: false,
      };
      let exitListener: ((reason: string) => void) | undefined;
      launches.push(launch);
      return {
        onExit(listener) {
          exitListener = listener;
        },
        stop() {
          launch.stopped = true;
        },
      };
    },
  });
  return { clock, events, launches, supervisor };
}

describe('restart backoff (ENG-07)', () => {
  it('is 1 s, 2 s, 5 s, 10 s, then every 30 s', () => {
    expect([0, 1, 2, 3, 4, 5, 50].map(restartDelayMs)).toEqual([1000, 2000, 5000, 10000, 30000, 30000, 30000]);
  });
});

describe('EngineSupervisor', () => {
  it('restarts after each exit with the ENG-07 delays', () => {
    const h = harness();
    h.supervisor.start();
    const delays = [1000, 2000, 5000, 10000, 30000];
    for (const delay of delays) {
      h.launches[h.launches.length - 1]?.exit('crash');
      const before = h.launches.length;
      h.clock.advance(delay - 1);
      expect(h.launches.length).toBe(before);
      h.clock.advance(1);
      expect(h.launches.length).toBe(before + 1);
    }
  });

  it('resets the backoff after the engine reports ready', () => {
    const h = harness();
    h.supervisor.start();
    h.launches[0]?.exit('crash');
    h.clock.advance(1000);
    h.supervisor.markReady();
    h.launches[1]?.exit('crash');
    const before = h.launches.length;
    h.clock.advance(1000);
    expect(h.launches.length).toBe(before + 1);
  });

  it('shows "The engine keeps stopping" after 5 exits in 10 minutes, and keeps retrying every 30 s', () => {
    const h = harness();
    h.supervisor.start();
    for (let i = 0; i < 5; i++) {
      h.launches[h.launches.length - 1]?.exit('crash');
      h.clock.advance(1000 * 60);
    }
    const failed = h.events.filter((e) => e.state === 'failed');
    expect(failed).toEqual([{ type: 'engine.health', state: 'failed', message: 'The engine keeps stopping' }]);
    h.launches[h.launches.length - 1]?.exit('crash');
    const before = h.launches.length;
    h.clock.advance(29_999);
    expect(h.launches.length).toBe(before);
    h.clock.advance(1);
    expect(h.launches.length).toBe(before + 1);
  });

  it('does not count exits that are older than 10 minutes', () => {
    const h = harness();
    h.supervisor.start();
    for (let i = 0; i < 4; i++) {
      h.launches[h.launches.length - 1]?.exit('crash');
      h.clock.advance(1000);
    }
    h.clock.advance(11 * 60 * 1000);
    h.launches[h.launches.length - 1]?.exit('crash');
    expect(h.events.some((e) => e.state === 'failed')).toBe(false);
  });

  it('stops everything on dispose and never relaunches', () => {
    const h = harness();
    h.supervisor.start();
    h.launches[0]?.exit('crash');
    h.supervisor.dispose();
    h.clock.advance(60_000);
    expect(h.launches.length).toBe(1);
    expect(h.clock.pendingCount()).toBe(0);
  });

  it('stops the running host on dispose', () => {
    const h = harness();
    h.supervisor.start();
    h.supervisor.dispose();
    expect(h.launches[0]?.stopped).toBe(true);
  });

  it('restartNow resets the failure window and restarts immediately with state restarting', () => {
    const h = harness();
    h.supervisor.start();
    for (let i = 0; i < 5; i++) {
      if (i > 0) h.clock.advance(1000 * 60);
      h.launches[h.launches.length - 1]?.exit('crash');
    }
    expect(h.events.at(-1)).toMatchObject({ state: 'failed' });
    const launchesBefore = h.launches.length;

    h.supervisor.restartNow();
    expect(h.events.at(-1)).toMatchObject({ state: 'restarting' });
    expect(h.launches.length).toBe(launchesBefore + 1);

    // After 1 crash now, it should not fail (window was reset, so this is exit #1, not #6)
    h.launches[h.launches.length - 1]?.exit('crash');
    expect(h.events.at(-1)).toMatchObject({ state: 'restarting' });
  });
});

