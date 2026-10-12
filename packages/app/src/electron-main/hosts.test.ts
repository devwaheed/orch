import { describe, expect, it } from 'vitest';
import type { MessagePortMain } from 'electron';
import { HostSupervisor, type HostHealth, type ManagedProcess } from './hosts.js';
import { ENGINE_COPY } from '@orchagents/platform/src/engine/common/strings.js';

/** A clock that runs timers only when the test advances it. */
function fakeClock() {
  let now = 0;
  const timers: Array<{ at: number; fn: () => void; cancelled: boolean }> = [];
  return {
    clock: {
      now: () => now,
      setTimer: (fn: () => void, ms: number) => {
        const timer = { at: now + ms, fn, cancelled: false };
        timers.push(timer);
        return () => {
          timer.cancelled = true;
        };
      },
    },
    advance(ms: number) {
      now += ms;
      for (const timer of timers) {
        if (!timer.cancelled && timer.at <= now) {
          timer.cancelled = true;
          timer.fn();
        }
      }
    },
    setNow(ms: number) {
      now = ms;
    },
  };
}

interface FakeProcess extends ManagedProcess {
  exit(reason?: string): void;
  ready(): void;
  posted: Array<{ message: unknown; ports: readonly MessagePortMain[] }>;
}

function fakeHost() {
  const launched: FakeProcess[] = [];
  const spawn = (): ManagedProcess => {
    const readyListeners: Array<() => void> = [];
    const exitListeners: Array<(reason: string) => void> = [];
    const posted: FakeProcess['posted'] = [];
    const process: FakeProcess = {
      onReady: (listener) => readyListeners.push(listener),
      onExit: (listener) => exitListeners.push(listener),
      stop: () => undefined,
      post: (message, ports) => posted.push({ message, ports }),
      exit: (reason = 'crashed') => exitListeners.forEach((listener) => listener(reason)),
      ready: () => readyListeners.forEach((listener) => listener()),
      posted,
    };
    launched.push(process);
    return process;
  };
  return { launched, spawn };
}

describe('ENG-07 host supervision', () => {
  it('starts the host and restarts it with the engine backoff', () => {
    const timers = fakeClock();
    const host = fakeHost();
    const health: HostHealth[] = [];
    const supervisor = new HostSupervisor({ name: 'core', launch: host.spawn }, timers.clock, (h) => health.push(h));

    supervisor.start();
    expect(host.launched).toHaveLength(1);
    expect(health.at(-1)).toMatchObject({ host: 'core', state: 'starting' });

    host.launched[0]?.ready();
    expect(health.at(-1)).toMatchObject({ host: 'core', state: 'ready' });

    host.launched[0]?.exit();
    expect(health.at(-1)).toMatchObject({ state: 'restarting' });
    timers.advance(999);
    expect(host.launched).toHaveLength(1);
    timers.advance(1);
    expect(host.launched).toHaveLength(2);

    // Second crash without a ready message: the backoff steps up to 2 s.
    host.launched[1]?.exit();
    timers.advance(1999);
    expect(host.launched).toHaveLength(2);
    timers.advance(1);
    expect(host.launched).toHaveLength(3);

    supervisor.dispose();
  });

  it('resets the backoff after the host reports ready', () => {
    const timers = fakeClock();
    const host = fakeHost();
    const supervisor = new HostSupervisor({ name: 'engine', launch: host.spawn }, timers.clock, () => undefined);
    supervisor.start();
    host.launched[0]?.exit();
    timers.advance(1000);
    host.launched[1]?.ready();
    host.launched[1]?.exit();
    timers.advance(1000);
    expect(host.launched).toHaveLength(3);
    supervisor.dispose();
  });

  it('shows "keeps stopping" after five failed restarts in ten minutes', () => {
    const timers = fakeClock();
    const host = fakeHost();
    const health: HostHealth[] = [];
    const supervisor = new HostSupervisor({ name: 'engine', launch: host.spawn }, timers.clock, (h) => health.push(h));
    supervisor.start();
    for (let i = 0; i < 5; i += 1) {
      host.launched[i]?.exit();
      timers.advance(60_000);
    }
    expect(health).toContainEqual({ type: 'engine.health', host: 'engine', state: 'failed', message: ENGINE_COPY.keepsStopping });
    supervisor.dispose();
  });

  it('posts to the running host and refuses while it is down', () => {
    const timers = fakeClock();
    const host = fakeHost();
    const supervisor = new HostSupervisor({ name: 'core', launch: host.spawn }, timers.clock, () => undefined);
    expect(supervisor.post(null, [])).toBe(false);

    supervisor.start();
    const port = {} as MessagePortMain;
    expect(supervisor.post('hello', [port])).toBe(true);
    expect(host.launched[0]?.posted).toEqual([{ message: 'hello', ports: [port] }]);

    host.launched[0]?.exit();
    expect(supervisor.post('again', [])).toBe(false);
    timers.advance(1000);
    expect(supervisor.post('again', [])).toBe(true);
    supervisor.dispose();
  });

  it('stops restarting after dispose', () => {
    const timers = fakeClock();
    const host = fakeHost();
    const supervisor = new HostSupervisor({ name: 'pty', launch: host.spawn }, timers.clock, () => undefined);
    supervisor.start();
    host.launched[0]?.exit();
    supervisor.dispose();
    timers.advance(60_000);
    expect(host.launched).toHaveLength(1);
  });

  it('restart() relaunches immediately and resets failure window', () => {
    const timers = fakeClock();
    const host = fakeHost();
    const health: HostHealth[] = [];
    const supervisor = new HostSupervisor({ name: 'engine', launch: host.spawn }, timers.clock, (h) => health.push(h));
    supervisor.start();
    // Five crashes; the backoff relaunch runs between them, not after the fifth.
    for (let i = 0; i < 5; i += 1) {
      if (i > 0) timers.advance(60_000);
      host.launched[i]?.exit();
    }
    expect(health.at(-1)).toMatchObject({ host: 'engine', state: 'failed' });

    supervisor.restart();
    expect(health.at(-1)).toMatchObject({ host: 'engine', state: 'restarting' });
    expect(host.launched).toHaveLength(6);
    timers.advance(60_000);
    expect(host.launched).toHaveLength(6); // the cancelled backoff timer doesn't launch a second host
    supervisor.dispose();
  });
});
