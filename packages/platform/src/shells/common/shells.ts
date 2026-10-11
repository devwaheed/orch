/**
 * Common types for the shells service. Plain TypeScript only (no Node/DOM).
 */
export interface ShellPort {
  postMessage(message: unknown): void;
  on(event: 'message', listener: (message: unknown) => void): unknown;
  close(): void;
}

export interface ShellRequest {
  id: number;
  op: 'open' | 'write' | 'resize' | 'close';
  payload: unknown;
}

export interface ShellReply {
  id: number;
  ok: boolean;
  value?: unknown;
  error?: {
    code: string;
    message: string;
    fix?: string;
    details?: Record<string, unknown>;
  };
}

export interface ShellEvent {
  type: 'shell.output' | 'shell.exited';
  shellId: string;
  data?: string;
  code?: number | null;
}

export interface ShellOpenPayload {
  cwd: string;
  cols: number;
  rows: number;
  env?: Record<string, string>;
  shell?: string;
  shellArgs?: string[];
}

export interface ShellWritePayload {
  shellId: string;
  data: string;
}

export interface ShellResizePayload {
  shellId: string;
  cols: number;
  rows: number;
}

export interface ShellClosePayload {
  shellId: string;
}

/** Sent by the PTY host once node-pty is loaded and it accepts requests. */
export const PTY_HOST_READY_TYPE = 'host.ready' as const;

export interface ShellHostReady {
  type: typeof PTY_HOST_READY_TYPE;
}

export function isShellHostReady(message: unknown): message is ShellHostReady {
  return typeof message === 'object' && message !== null && (message as { type?: unknown }).type === PTY_HOST_READY_TYPE;
}
