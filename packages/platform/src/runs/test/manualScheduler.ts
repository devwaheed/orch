import type { ResumeScheduler } from '../node/runsService.js';

/** A clock the test moves by hand. Pass `clock.ms` as the service's `now`. */
export interface ManualClock {
  ms: number;
}

/** Timers that fire only when the test advances the clock (QTA-04 without waiting). */
export class ManualScheduler implements ResumeScheduler {
  private nextHandle = 1;
  private readonly timers = new Map<number, { due: number; callback: () => Promise<void> }>();

  constructor(private readonly clock: ManualClock) {}

  set(callback: () => Promise<void>, delayMs: number): unknown {
    const handle = this.nextHandle++;
    this.timers.set(handle, { due: this.clock.ms + delayMs, callback });
    return handle;
  }

  clear(handle: unknown): void {
    this.timers.delete(handle as number);
  }

  get armed(): number {
    return this.timers.size;
  }

  /** Moves the clock forward and runs every timer that is due, in due order. */
  async advance(ms: number): Promise<void> {
    this.clock.ms += ms;
    for (;;) {
      const next = [...this.timers.entries()]
        .filter(([, t]) => t.due <= this.clock.ms)
        .sort((a, b) => a[1].due - b[1].due)[0];
      if (!next) return;
      this.timers.delete(next[0]);
      await next[1].callback();
    }
  }
}
