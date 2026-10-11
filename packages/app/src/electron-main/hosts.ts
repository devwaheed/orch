/**
 * Supervision of the utility-process hosts (ADR 0006, ENG-07). Main restarts a
 * host with the engine's backoff policy (1 s, 2 s, 5 s, 10 s, then every 30 s),
 * and reports "keeps stopping" after 5 failures in 10 minutes. The policy itself
 * lives in platform's supervisor; this file only wires it to a process.
 */
import { EngineSupervisor, type LaunchedEngine, type SupervisorClock } from '@orch/platform/src/engine/common/supervisor.js';
import type { MessagePortMain } from 'electron';
import type { OrchEvent } from '@orch/contracts';

export type HostName = 'core' | 'engine' | 'pty';

/** One running host process. */
export interface ManagedProcess extends LaunchedEngine {
  /** Fires when the host posts its ready message. */
  onReady(listener: () => void): void;
  /** Sends a message, with ports, to the host. */
  post(message: unknown, ports: readonly MessagePortMain[]): void;
}

export interface HostSpec {
  readonly name: HostName;
  /** Starts a new process for this host. Called again on every restart. */
  readonly launch: () => ManagedProcess;
}

export type HostHealth = Extract<OrchEvent, { type: 'engine.health' }> & { readonly host: HostName };

export const REAL_CLOCK: SupervisorClock = {
  now: () => Date.now(),
  setTimer: (fn, ms) => {
    const timer = setTimeout(fn, ms);
    return () => clearTimeout(timer);
  },
};

/** Keeps one host running. Start it, stop it on quit. */
export class HostSupervisor {
  private readonly supervisor: EngineSupervisor;
  private current: ManagedProcess | null = null;

  constructor(
    private readonly spec: HostSpec,
    clock: SupervisorClock,
    onHealth: (health: HostHealth) => void,
  ) {
    this.supervisor = new EngineSupervisor({
      clock,
      emit: (event) => onHealth({ ...event, host: spec.name }),
      launch: () => {
        const launched = this.spec.launch();
        this.current = launched;
        launched.onReady(() => this.supervisor.markReady());
        launched.onExit(() => {
          if (this.current === launched) this.current = null;
        });
        return launched;
      },
    });
  }

  get name(): HostName {
    return this.spec.name;
  }

  get health(): { state: 'starting' | 'ready' | 'restarting' | 'failed' } {
    return this.supervisor.health;
  }

  start(): void {
    this.supervisor.start();
  }

  /** Sends to the running process. Returns false while the host is down. */
  post(message: unknown, ports: readonly MessagePortMain[] = []): boolean {
    if (!this.current) return false;
    this.current.post(message, ports);
    return true;
  }

  dispose(): void {
    this.current = null;
    this.supervisor.dispose();
  }
}
