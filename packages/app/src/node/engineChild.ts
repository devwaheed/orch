/**
 * The engine host as a supervised child process (ENG-07). The core host forks it
 * with IPC and talks to it through EngineClient. Restart timing and the health
 * states come from the platform supervisor. With no options the engine is
 * disabled: start does nothing and ping reports the engine as unavailable.
 */
import { fork, type ChildProcess } from 'node:child_process';
import type { EngineEvent, EngineRequest, OrchEvent, Result } from '@orchagents/contracts';
import { EngineClient, engineUnavailable, type EnginePort } from '@orchagents/platform/src/engine/common/engineClient.js';
import { EngineSupervisor, type LaunchedEngine, type SupervisorClock } from '@orchagents/platform/src/engine/common/supervisor.js';
import type { DoctorEngine } from '@orchagents/platform/src/doctor/node/doctorService.js';

export interface EngineChildOptions {
  /** The engine host entry: the compiled engineHost.js, or the .ts entry under a loader in tests. */
  readonly entry: string;
  /** Flags for the entry, e.g. ['--engine-dir', dir, '--claude-bin', path]. */
  readonly args: readonly string[];
  /** Extra node flags, e.g. ['--import', loader] in tests. */
  readonly execArgv?: readonly string[];
  /** The environment the child starts with. The engine host sets its own HOME. */
  readonly env: Readonly<Record<string, string>>;
  readonly clock?: SupervisorClock;
}

const REAL_CLOCK: SupervisorClock = {
  now: () => Date.now(),
  setTimer: (fn, ms) => {
    const timer = setTimeout(fn, ms);
    return () => clearTimeout(timer);
  },
};

export class EngineChild implements DoctorEngine {
  private client: EngineClient | null = null;
  private readonly supervisor: EngineSupervisor | null;
  /** Engine event listeners survive restarts: each new client gets them again. */
  private readonly eventListeners = new Set<(event: EngineEvent) => void>();
  /** True from engine.ready until the engine process exits. */
  private engineReady = false;
  private readyWaiters: Array<() => void> = [];

  /**
   * @param options null disables the engine.
   * @param emit receives engine.health events (the core host forwards them to subscribers).
   */
  constructor(
    private readonly options: EngineChildOptions | null,
    private readonly emit: (event: Extract<OrchEvent, { type: 'engine.health' }>) => void,
  ) {
    this.supervisor = options
      ? new EngineSupervisor({
          clock: options.clock ?? REAL_CLOCK,
          emit: this.emit,
          launch: () => this.launch(options),
        })
      : null;
  }

  start(): void {
    this.supervisor?.start();
  }

  /**
   * Uses an engine host that already runs elsewhere (Electron starts its engine
   * utility and hands the core host a port to it) instead of forking one. The
   * engine's restarts are then its owner's job, not this class's.
   */
  attachPort(port: EnginePort): void {
    this.client?.close();
    this.attachClient(new EngineClient(port));
  }

  /** Resolves when the engine reports ready (now, if it already has). Never rejects. */
  whenReady(): Promise<void> {
    if (this.engineReady) return Promise.resolve();
    return new Promise((resolve) => {
      this.readyWaiters.push(resolve);
    });
  }

  /** Sends one engine request to the current engine host, or engine_unavailable when it is down. */
  async request(request: EngineRequest): Promise<Result<unknown>> {
    const current = this.client;
    if (!current) return { ok: false, error: engineUnavailable() };
    return current.request(request);
  }

  /** Subscribes to engine events across restarts. Returns an unsubscribe function. */
  onEvent(listener: (event: EngineEvent) => void): () => void {
    this.eventListeners.add(listener);
    const current = this.client;
    const detach = current ? current.onEvent(listener) : undefined;
    return () => {
      this.eventListeners.delete(listener);
      detach?.();
    };
  }

  /** Liveness through the current engine host, or engine_unavailable. Never throws. */
  async ping(): Promise<Result<{ engineVersion: string }>> {
    const current = this.client;
    if (!current) return { ok: false, error: engineUnavailable() };
    return current.ping();
  }

  dispose(): void {
    this.client = null;
    this.supervisor?.dispose();
  }

  private attachClient(client: EngineClient): void {
    this.client = client;
    for (const listener of this.eventListeners) client.onEvent(listener);
    client.onEvent((event) => {
      if (event.type === 'engine.ready') {
        this.supervisor?.markReady();
        // An attached engine is supervised by Electron main, so nothing else tells the window it is up.
        if (!this.supervisor) this.emit({ type: 'engine.health', state: 'ready' });
        this.markEngineReady();
      }
    });
  }

  private markEngineReady(): void {
    this.engineReady = true;
    const waiters = this.readyWaiters;
    this.readyWaiters = [];
    for (const waiter of waiters) waiter();
  }

  private launch(options: EngineChildOptions): LaunchedEngine {
    const child: ChildProcess = fork(options.entry, [...options.args], {
      env: { ...options.env },
      execArgv: [...(options.execArgv ?? [])],
      stdio: ['ignore', 'inherit', 'inherit', 'ipc'],
    });
    const port: EnginePort = {
      postMessage: (message) => {
        child.send(message as object);
      },
      on: (_event, listener) => {
        child.on('message', listener);
        return undefined;
      },
    };
    const client = new EngineClient(port);
    this.attachClient(client);
    return {
      onExit: (listener) => {
        child.once('exit', (code, signal) => {
          client.close();
          if (this.client === client) this.client = null;
          this.engineReady = false;
          listener(`exit ${code ?? signal ?? 'unknown'}`);
        });
      },
      stop: () => {
        child.kill();
      },
    };
  }
}
