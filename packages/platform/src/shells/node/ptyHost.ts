/**
 * PTY host: runs real shells via node-pty. The core host talks to this over a
 * MessagePort-like port (in the app, a supervised child process; ADR 0006).
 */
import { randomBytes } from 'node:crypto';
import { chmodSync, existsSync, statSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import type { IPty } from 'node-pty';
import type { ShellPort, ShellRequest, ShellReply, ShellEvent, ShellOpenPayload, ShellWritePayload, ShellResizePayload, ShellClosePayload } from '../common/shells.js';
import { SHELLS_COPY } from '../common/strings.js';
import type { Result, ShellId } from '@orch/contracts';

interface PtyProcess {
  shellId: ShellId;
  pty: IPty;
  cols: number;
  rows: number;
}

export type SpawnHelperCheck = { ok: true } | { ok: false; reason: string; helperPath: string };

/**
 * node-pty 1.1.0 ships its prebuilt `spawn-helper` without the execute bit on
 * macOS and Linux, so every spawn fails with "posix_spawnp failed". Give the
 * helper the bit before a spawn. Reports a failure when the file cannot be made
 * executable (for example inside a read-only signed app bundle).
 */
export function ensureSpawnHelperExecutable(): SpawnHelperCheck {
  if (process.platform === 'win32') return { ok: true };

  const packageDir = path.dirname(createRequire(import.meta.url).resolve('node-pty/package.json'));
  // Inside a packaged app node-pty runs the unpacked copy, as node-pty itself does.
  const helperPath = path
    .join(packageDir, 'prebuilds', `${process.platform}-${process.arch}`, 'spawn-helper')
    .replace(`app.asar${path.sep}`, `app.asar.unpacked${path.sep}`);
  if (!existsSync(helperPath)) return { ok: true };
  if ((statSync(helperPath).mode & 0o111) !== 0) return { ok: true };

  try {
    chmodSync(helperPath, 0o755);
    return { ok: true };
  } catch (e) {
    return { ok: false, reason: e instanceof Error ? e.message : 'chmod failed', helperPath };
  }
}

export class PtyHost {
  private readonly port: ShellPort;
  private readonly shells = new Map<string, PtyProcess>();
  private closed = false;
  private ptyModule: typeof import('node-pty') | null = null;
  private readonly defaultShell: string;
  private readonly defaultShellArgs: string[];
  private readonly baseEnv: Record<string, string>;
  public readonly ready: Promise<void>;

  constructor(
    port: ShellPort,
    options: { defaultShell: string; defaultShellArgs: string[]; baseEnv: Record<string, string> }
  ) {
    this.port = port;
    this.defaultShell = options.defaultShell;
    this.defaultShellArgs = options.defaultShellArgs;
    this.baseEnv = options.baseEnv;

    this.ready = (async () => {
      try {
        this.ptyModule = await import('node-pty');
      } catch {
        // Stays null: every open replies with openFailed.
        this.ptyModule = null;
      }
    })();

    port.on('message', (raw: unknown) => this.onMessage(raw));
  }

  private onMessage(raw: unknown): void {
    if (this.closed) return;

    const message = raw;
    if (typeof message !== 'object' || message === null) return;
    if (!('id' in message) || !('op' in message)) return;

    void this.handleRequest(message as ShellRequest);
  }

  private async handleRequest(request: ShellRequest): Promise<void> {
    const { id, op, payload } = request;

    try {
      let result: Result<unknown>;

      switch (op) {
        case 'open':
          result = await this.handleOpen(payload as ShellOpenPayload);
          break;
        case 'write':
          result = this.handleWrite(payload as ShellWritePayload);
          break;
        case 'resize':
          result = this.handleResize(payload as ShellResizePayload);
          break;
        case 'close':
          result = this.handleClose(payload as ShellClosePayload);
          break;
        default:
          result = { ok: false, error: { code: 'validation_failed', message: `Unknown operation: ${op}` } };
      }

      this.sendReply(id, result);
    } catch {
      this.sendReply(id, {
        ok: false,
        error: {
          code: 'internal',
          message: 'Unknown error',
        },
      });
    }
  }

  private sendReply(id: number, result: Result<unknown>): void {
    if (this.closed) return;

    let reply: ShellReply;
    if (result.ok) {
      reply = { id, ok: true, value: result.value };
    } else {
      const { code, message, fix, details } = result.error;
      reply = { id, ok: false, error: { code, message, ...(fix !== undefined ? { fix } : {}), ...(details !== undefined ? { details } : {}) } };
    }

    try {
      this.port.postMessage(reply);
    } catch {
      // Port closed, ignore
    }
  }

  private sendEvent(event: ShellEvent): void {
    if (this.closed) return;
    try {
      this.port.postMessage(event);
    } catch {
      // Port closed, ignore
    }
  }

  private async handleOpen(payload: ShellOpenPayload): Promise<Result<{ shellId: ShellId }>> {
    await this.ready;
    if (!this.ptyModule) {
      return { ok: false, error: { code: 'internal', message: SHELLS_COPY.openFailed.message, fix: SHELLS_COPY.openFailed.fix } };
    }

    const helper = ensureSpawnHelperExecutable();
    if (!helper.ok) {
      return {
        ok: false,
        error: {
          code: 'internal',
          message: SHELLS_COPY.openFailed.message,
          fix: SHELLS_COPY.openFailed.fix,
          details: { reason: 'spawn-helper is not executable', helperPath: helper.helperPath, cause: helper.reason },
        },
      };
    }

    const shellId = `sh-${randomBytes(4).toString('hex')}` as ShellId;
    const { cwd, cols, rows, env, shell, shellArgs } = payload;

    const actualShell = shell ?? this.defaultShell;
    const actualShellArgs = shellArgs ?? this.defaultShellArgs;

    try {
      const pty = this.ptyModule.spawn(actualShell, actualShellArgs, {
        name: 'xterm-256color',
        cols,
        rows,
        cwd,
        env: {
          ...this.baseEnv,
          ...env,
          TERM: 'xterm-256color',
        },
      });

      this.shells.set(shellId, { shellId, pty, cols, rows });

      pty.onData((data: string) => {
        this.sendEvent({ type: 'shell.output', shellId, data });
      });

      pty.onExit((e: { exitCode: number; signal?: number }) => {
        this.shells.delete(shellId);
        this.sendEvent({ type: 'shell.exited', shellId, code: e.exitCode });
      });

      return { ok: true, value: { shellId } };
    } catch {
      return { ok: false, error: { code: 'internal', message: SHELLS_COPY.openFailed.message, fix: SHELLS_COPY.openFailed.fix } };
    }
  }

  private handleWrite(payload: ShellWritePayload): Result<void> {
    const ptyProcess = this.shells.get(payload.shellId);

    if (!ptyProcess) {
      return { ok: false, error: { code: 'not_found', message: SHELLS_COPY.writeFailed.message, fix: SHELLS_COPY.writeFailed.fix } };
    }

    try {
      ptyProcess.pty.write(payload.data);
      return { ok: true, value: undefined };
    } catch {
      return { ok: false, error: { code: 'internal', message: SHELLS_COPY.writeFailed.message, fix: SHELLS_COPY.writeFailed.fix } };
    }
  }

  private handleResize(payload: ShellResizePayload): Result<void> {
    const { shellId, cols, rows } = payload;
    const ptyProcess = this.shells.get(shellId);

    if (!ptyProcess) {
      return { ok: false, error: { code: 'not_found', message: SHELLS_COPY.resizeFailed.message, fix: SHELLS_COPY.resizeFailed.fix } };
    }

    try {
      ptyProcess.pty.resize(cols, rows);
      ptyProcess.cols = cols;
      ptyProcess.rows = rows;
      return { ok: true, value: undefined };
    } catch {
      return { ok: false, error: { code: 'internal', message: SHELLS_COPY.resizeFailed.message, fix: SHELLS_COPY.resizeFailed.fix } };
    }
  }

  private handleClose(payload: ShellClosePayload): Result<void> {
    const ptyProcess = this.shells.get(payload.shellId);

    if (!ptyProcess) {
      return { ok: false, error: { code: 'not_found', message: SHELLS_COPY.closeFailed.message, fix: SHELLS_COPY.closeFailed.fix } };
    }

    try {
      ptyProcess.pty.kill();
      this.shells.delete(payload.shellId);
      return { ok: true, value: undefined };
    } catch {
      return { ok: false, error: { code: 'internal', message: SHELLS_COPY.closeFailed.message, fix: SHELLS_COPY.closeFailed.fix } };
    }
  }

  /** Called when the port or the PTY host process goes away. */
  dispose(): void {
    if (this.closed) return;
    this.closed = true;

    for (const ptyProcess of this.shells.values()) {
      try {
        ptyProcess.pty.kill();
      } catch {
        // Already gone
      }
    }
    this.shells.clear();
  }
}
