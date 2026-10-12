/**
 * Restart policy for the engine host (ENG-07). Pure logic: the caller supplies
 * the clock and the way to launch the host, so the policy is tested without
 * processes or real time.
 */
import type { OrchEvent } from '@orchagents/contracts';
import { ENGINE_COPY } from './strings.js';

/** ENG-07: 1 s, 2 s, 5 s, 10 s, then every 30 s. */
export const ENGINE_RESTART_DELAYS_MS = [1_000, 2_000, 5_000, 10_000, 30_000] as const;
/** ENG-07: this many failed restarts inside the window shows "keeps stopping". */
export const ENGINE_KEEPS_STOPPING_FAILURES = 5;
export const ENGINE_KEEPS_STOPPING_WINDOW_MS = 10 * 60 * 1000;

export function restartDelayMs(restartIndex: number): number {
  const index = Math.min(restartIndex, ENGINE_RESTART_DELAYS_MS.length - 1);
  return ENGINE_RESTART_DELAYS_MS[index] as number;
}

export interface SupervisorClock {
  now(): number;
  /** Schedule `fn` after `ms`. Returns a cancel function. */
  setTimer(fn: () => void, ms: number): () => void;
}

/** One launched engine host. `onExit` fires once when it stops for any reason. */
export interface LaunchedEngine {
  onExit(listener: (reason: string) => void): void;
  stop(): void;
}

export interface SupervisorOptions {
  launch: () => LaunchedEngine;
  clock: SupervisorClock;
  /** Receives engine.health events, shaped as OrchEvent. */
  emit: (event: Extract<OrchEvent, { type: 'engine.health' }>) => void;
}

export class EngineSupervisor {
  private current: LaunchedEngine | null = null;
  private cancelTimer: (() => void) | null = null;
  private restartIndex = 0;
  private exits: number[] = [];
  private disposed = false;
  private state: 'starting' | 'ready' | 'restarting' | 'failed' = 'starting';

  private readonly options: SupervisorOptions;

  constructor(options: SupervisorOptions) {
    this.options = options;
  }

  /** The last state emitted. */
  get health(): { state: 'starting' | 'ready' | 'restarting' | 'failed' } {
    return { state: this.state };
  }

  start(): void {
    if (this.disposed || this.current) return;
    this.setState('starting');
    this.launch();
  }

  /** The host reported engine.ready: reset the backoff. */
  markReady(): void {
    if (this.disposed) return;
    this.restartIndex = 0;
    this.setState('ready');
  }

  dispose(): void {
    this.disposed = true;
    this.cancelTimer?.();
    this.cancelTimer = null;
    const current = this.current;
    this.current = null;
    current?.stop();
  }

  /**
   * ENG-07: Manual restart from the engine-failure bar. Resets the failure window
   * and restart backoff, stops any running process or pending timer, and launches immediately.
   */
  restartNow(): void {
    if (this.disposed) return;
    this.cancelTimer?.();
    this.cancelTimer = null;
    this.exits = [];
    this.restartIndex = 0;
    const current = this.current;
    this.current = null;
    current?.stop();
    this.setState('restarting');
    this.launch();
  }

  private launch(): void {
    const launched = this.options.launch();
    this.current = launched;
    launched.onExit((reason) => this.onExit(launched, reason));
  }

  private onExit(launched: LaunchedEngine, reason: string): void {
    if (this.disposed || this.current !== launched) return;
    void reason;
    this.current = null;
    const now = this.options.clock.now();
    this.exits = this.exits.filter((t) => now - t < ENGINE_KEEPS_STOPPING_WINDOW_MS);
    this.exits.push(now);

    if (this.exits.length >= ENGINE_KEEPS_STOPPING_FAILURES) {
      this.setState('failed', ENGINE_COPY.keepsStopping);
    } else {
      this.setState('restarting');
    }

    const delay = restartDelayMs(this.restartIndex);
    this.restartIndex += 1;
    this.cancelTimer = this.options.clock.setTimer(() => {
      this.cancelTimer = null;
      if (this.disposed) return;
      this.setState('starting', this.state === 'failed' ? ENGINE_COPY.keepsStopping : undefined);
      this.launch();
    }, delay);
  }

  private setState(state: 'starting' | 'ready' | 'restarting' | 'failed', message?: string): void {
    this.state = state;
    const event: Extract<OrchEvent, { type: 'engine.health' }> = { type: 'engine.health', state };
    if (message !== undefined) event.message = message;
    this.options.emit(event);
  }
}
