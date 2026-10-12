/**
 * Shells service (core host side): talks to the PTY host over a MessagePort.
 * Implements the IShellService calls. When the PTY host goes away, every shell
 * it was running is reported with shell.exited, so the UI can show
 * "Terminal stopped · Restart".
 */
import { Emitter } from '@orchagents/base';
import type { IShellService, ShellId, OrchEvent, OrchError, Result } from '@orchagents/contracts';
import { SHELLS_COPY } from '../common/strings.js';
import type { ShellPort, ShellRequest, ShellReply, ShellEvent } from '../common/shells.js';

type ShellOp = ShellRequest['op'];

function hostUnavailable(): { ok: false; error: { code: 'engine_unavailable'; message: string; fix: string } } {
  return { ok: false, error: { code: 'engine_unavailable', message: SHELLS_COPY.ptyHostUnavailable.message, fix: SHELLS_COPY.ptyHostUnavailable.fix } };
}

export class ShellsServiceImpl implements IShellService {
  private readonly port: ShellPort;
  private nextId = 1;
  private closed = false;
  private readonly pending = new Map<number, (result: Result<unknown>) => void>();
  /** Shells the PTY host reported open and has not reported exited. */
  private readonly live = new Set<string>();
  private readonly eventEmitter = new Emitter<OrchEvent>();

  constructor(port: ShellPort) {
    this.port = port;
    port.on('message', (raw: unknown) => this.onMessage(raw));
  }

  /** Subscribe to shell events (shell.output, shell.exited). */
  onEvent(listener: (event: OrchEvent) => void): () => void {
    const subscription = this.eventEmitter.event(listener);
    return () => subscription.dispose();
  }

  /** IShellService.open */
  async open(cwd: string, cols: number, rows: number): Promise<Result<ShellId>> {
    const result = await this.request('open', { cwd, cols, rows });
    if (result.ok) {
      const shellId = (result.value as { shellId: string }).shellId;
      this.live.add(shellId);
      return { ok: true, value: shellId as ShellId };
    }
    return result as Result<ShellId>;
  }

  /** IShellService.write */
  write(shellId: ShellId, data: string): Promise<Result<void>> {
    return this.request('write', { shellId, data }) as Promise<Result<void>>;
  }

  /** IShellService.resize */
  resize(shellId: ShellId, cols: number, rows: number): Promise<Result<void>> {
    return this.request('resize', { shellId, cols, rows }) as Promise<Result<void>>;
  }

  /** IShellService.close */
  async close(shellId: ShellId): Promise<Result<void>> {
    const result = await this.request('close', { shellId });
    if (result.ok) this.live.delete(shellId);
    return result as Result<void>;
  }

  /**
   * Called when the PTY host dies or the port closes. Fails pending requests and
   * reports every live shell as exited (code null), which the UI shows as stopped.
   */
  onPtyHostClose(): void {
    if (this.closed) return;
    this.closed = true;

    for (const resolve of this.pending.values()) {
      resolve(hostUnavailable());
    }
    this.pending.clear();

    for (const shellId of this.live) {
      this.eventEmitter.fire({ type: 'shell.exited', shellId: shellId as ShellId, code: null });
    }
    this.live.clear();
  }

  private request(op: ShellOp, payload: unknown): Promise<Result<unknown>> {
    if (this.closed) return Promise.resolve(hostUnavailable());

    const id = this.nextId++;
    return new Promise<Result<unknown>>((resolve) => {
      this.pending.set(id, resolve);
      this.port.postMessage({ id, op, payload } satisfies ShellRequest);
    });
  }

  private onMessage(raw: unknown): void {
    if (this.closed) return;

    const message = raw;
    if (typeof message !== 'object' || message === null) return;

    // Reply
    if ('ok' in message) {
      const reply = message as ShellReply;
      const resolve = this.pending.get(reply.id);
      if (!resolve) return;
      this.pending.delete(reply.id);

      if (reply.ok) {
        resolve({ ok: true, value: reply.value });
      } else {
        const error = reply.error ?? { code: 'internal', message: SHELLS_COPY.openFailed.message, fix: SHELLS_COPY.openFailed.fix };
        resolve({ ok: false, error: { code: error.code as OrchError['code'], message: error.message, fix: error.fix, details: error.details } });
      }
      return;
    }

    // Event
    if ('type' in message) {
      const event = message as ShellEvent;
      const shellId = event.shellId as ShellId;
      if (event.type === 'shell.output') {
        this.eventEmitter.fire({ type: 'shell.output', shellId, data: event.data ?? '' });
      } else if (event.type === 'shell.exited') {
        this.live.delete(event.shellId);
        this.eventEmitter.fire({ type: 'shell.exited', shellId, code: event.code ?? null });
      }
    }
  }

  dispose(): void {
    if (this.closed) return;
    this.closed = true;

    for (const resolve of this.pending.values()) {
      resolve(hostUnavailable());
    }
    this.pending.clear();
    this.live.clear();
    this.eventEmitter.dispose();
    try {
      this.port.close();
    } catch {
      // Already closed
    }
  }
}
