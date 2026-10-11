/**
 * Wrapper ShellsService that manages the PTY host child lifecycle.
 * This lives in the app package because it depends on PtyHostChild.
 */
import type { IShellService, ShellId, Result } from '@orch/contracts';
import { ShellsServiceImpl } from '@orch/platform/src/shells/node/shellsService.js';
import { SHELLS_COPY } from '@orch/platform/src/shells/common/strings.js';
import { PtyHostChild } from './ptyChild.js';

function hostUnavailable(): { ok: false; error: { code: 'engine_unavailable'; message: string; fix: string } } {
  return { ok: false, error: { code: 'engine_unavailable', message: SHELLS_COPY.ptyHostUnavailable.message, fix: SHELLS_COPY.ptyHostUnavailable.fix } };
}

export class ShellsServiceWrapper implements IShellService {
  private impl: ShellsServiceImpl | null = null;
  private readonly ptyChild: PtyHostChild;

  constructor(ptyChild: PtyHostChild) {
    this.ptyChild = ptyChild;
  }

  private getImpl(): ShellsServiceImpl | null {
    if (!this.impl) {
      const service = this.ptyChild.getService();
      if (!service) {
        return null;
      }
      this.impl = service;
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
    this.impl?.dispose();
    this.impl = null;
  }

  dispose(): void {
    this.impl?.dispose();
    this.impl = null;
  }
}