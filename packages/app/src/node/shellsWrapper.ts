/**
 * Wrapper ShellsService that manages the PTY host child lifecycle.
 * This lives in the app package because it depends on PtyHostChild.
 *
 * Shell events (shell.output, shell.exited) come from whichever ShellsServiceImpl
 * is live. The wrapper re-publishes them through one stream, so subscribers keep
 * receiving events across PTY host restarts.
 */
import { Emitter, type Event } from '@orchagents/base';
import type { IShellService, OrchEvent, ShellId, Result } from '@orchagents/contracts';
import { ShellsServiceImpl } from '@orchagents/platform/src/shells/node/shellsService.js';
import { SHELLS_COPY } from '@orchagents/platform/src/shells/common/strings.js';
import type { PtyHostChild } from './ptyChild.js';

function hostUnavailable(): { ok: false; error: { code: 'engine_unavailable'; message: string; fix: string } } {
  return { ok: false, error: { code: 'engine_unavailable', message: SHELLS_COPY.ptyHostUnavailable.message, fix: SHELLS_COPY.ptyHostUnavailable.fix } };
}

export class ShellsServiceWrapper implements IShellService {
  private impl: ShellsServiceImpl | null = null;
  private unbindImpl: (() => void) | null = null;
  private readonly ptyChild: Pick<PtyHostChild, 'getService'>;
  private readonly eventEmitter = new Emitter<OrchEvent>();

  /** shell.output and shell.exited from the PTY host. Forwarded to the core events channel by coreHostMain. */
  readonly onEvent: Event<OrchEvent> = this.eventEmitter.event;

  constructor(ptyChild: Pick<PtyHostChild, 'getService'>) {
    this.ptyChild = ptyChild;
  }

  private getImpl(): ShellsServiceImpl | null {
    if (!this.impl) {
      const service = this.ptyChild.getService();
      if (!service) {
        return null;
      }
      this.impl = service;
      this.unbindImpl = service.onEvent((event) => this.eventEmitter.fire(event));
    }
    return this.impl;
  }

  /** IShellService.open */
  async open(cwd: string, cols: number, rows: number): Promise<Result<ShellId>> {
    const impl = this.getImpl();
    if (!impl) {
      return hostUnavailable();
    }
    return impl.open(cwd, cols, rows);
  }

  /** Starts a program in a terminal (see ShellsServiceImpl.openCommand). */
  async openCommand(argv: readonly string[], env: Readonly<Record<string, string>>, cwd: string, cols: number, rows: number): Promise<Result<ShellId>> {
    const impl = this.getImpl();
    if (!impl) {
      return hostUnavailable();
    }
    return impl.openCommand(argv, env, cwd, cols, rows);
  }

  /** IShellService.write */
  async write(shellId: ShellId, data: string): Promise<Result<void>> {
    const impl = this.getImpl();
    if (!impl) {
      return hostUnavailable();
    }
    return impl.write(shellId, data);
  }

  /** IShellService.resize */
  async resize(shellId: ShellId, cols: number, rows: number): Promise<Result<void>> {
    const impl = this.getImpl();
    if (!impl) {
      return hostUnavailable();
    }
    return impl.resize(shellId, cols, rows);
  }

  /** IShellService.close */
  async close(shellId: ShellId): Promise<Result<void>> {
    const impl = this.getImpl();
    if (!impl) {
      return hostUnavailable();
    }
    return impl.close(shellId);
  }

  /** Called when the PTY host restarts. */
  onPtyHostRestart(): void {
    this.releaseImpl();
  }

  dispose(): void {
    this.releaseImpl();
    this.eventEmitter.dispose();
  }

  private releaseImpl(): void {
    this.unbindImpl?.();
    this.unbindImpl = null;
    this.impl?.dispose();
    this.impl = null;
  }
}
