/**
 * The PTY host as a supervised child process (ADR 0006). The core host forks it
 * with IPC and talks to it through ShellsServiceImpl. Restart timing (ENG-07) and
 * the health states come from the engine supervisor, which the PTY host reuses.
 */
import { fork, type ChildProcess } from 'node:child_process';
import { EngineSupervisor, type LaunchedEngine, type SupervisorClock } from '@orch/platform/src/engine/common/supervisor.js';
import { ShellsServiceImpl } from '@orch/platform/src/shells/node/shellsService.js';
import { isShellHostReady, type ShellPort } from '@orch/platform/src/shells/common/shells.js';

export interface PtyHostChildOptions {
  /** The PTY host entry: the compiled ptyHost.js, or the .ts entry under a loader in tests. */
  readonly entry: string;
  /** Flags for the entry. */
  readonly args: readonly string[];
  /** Extra node flags, e.g. ['--import', loader] in tests. */
  readonly execArgv?: readonly string[];
  /** The environment the child starts with. */
  readonly env: Readonly<Record<string, string>>;
  readonly clock?: SupervisorClock;
}

export type PtyHostHealth = 'starting' | 'ready' | 'restarting' | 'failed';

const REAL_CLOCK: SupervisorClock = {
  now: () => Date.now(),
  setTimer: (fn, ms) => {
    const timer = setTimeout(fn, ms);
    return () => clearTimeout(timer);
  },
};

export class PtyHostChild {
  private service: ShellsServiceImpl | null = null;
  private child: ChildProcess | null = null;
  private health: PtyHostHealth = 'starting';
  private readonly supervisor: EngineSupervisor | null;
  private readonly onRestart: () => void;

  /**
   * @param options null disables the PTY host.
   * @param onRestart called each time the PTY host reports ready (after a start or a restart).
   */
  constructor(
    options: PtyHostChildOptions | null,
    onRestart: () => void,
  ) {
    this.onRestart = onRestart;
    this.supervisor = options
      ? new EngineSupervisor({
          clock: options.clock ?? REAL_CLOCK,
          emit: (event) => this.onHealth(event.state),
          launch: () => this.launch(options),
        })
      : null;
  }

  start(): void {
    this.supervisor?.start();
  }

  /** The current health: starting, ready, restarting (the host died and will restart), or failed. */
  get state(): PtyHostHealth | null {
    return this.supervisor ? this.health : null;
  }

  /** The PID of the running PTY host process, or null when none is running. */
  get pid(): number | null {
    return this.child?.pid ?? null;
  }

  /** Returns the ShellsService if the PTY host is running, otherwise null. */
  getService(): ShellsServiceImpl | null {
    return this.service;
  }

  dispose(): void {
    this.service?.dispose();
    this.service = null;
    this.supervisor?.dispose();
  }

  private onHealth(state: PtyHostHealth): void {
    this.health = state;
    if (state === 'ready') this.onRestart();
  }

  private launch(options: PtyHostChildOptions): LaunchedEngine {
    const child: ChildProcess = fork(options.entry, [...options.args], {
      env: { ...options.env },
      execArgv: [...(options.execArgv ?? [])],
      stdio: ['ignore', 'inherit', 'inherit', 'ipc'],
    });
    this.child = child;

    const port: ShellPort = {
      postMessage: (message: unknown) => {
        child.send(message as object);
      },
      on: (_event: 'message', listener: (message: unknown) => void) => {
        child.on('message', listener);
        return undefined;
      },
      close: () => {
        child.kill();
      },
    };

    const service = new ShellsServiceImpl(port);
    this.service = service;
    child.on('message', (message) => {
      if (isShellHostReady(message) && this.child === child) this.supervisor?.markReady();
    });

    return {
      onExit: (listener) => {
        child.once('exit', (code, signal) => {
          if (this.child === child) this.child = null;
          // Reports every live shell as exited, which the UI shows as "Terminal stopped".
          service.onPtyHostClose();
          if (this.service === service) this.service = null;
          listener(`exit ${code ?? signal ?? 'unknown'}`);
        });
      },
      stop: () => {
        child.kill();
      },
    };
  }
}
