/**
 * The core host's side of the engine protocol. Sends EngineEnvelopes over a
 * MessagePort-like port, correlates EngineReplies by id, and hands out
 * EngineEvents. Every call returns Result<T>; nothing throws across the port.
 */
import {
  EngineEnvelope,
  EngineEvent,
  EngineReply,
  EngineRequest,
  type ErrorCode,
  ErrorCode as ErrorCodeSchema,
  type OrchError,
  type Result,
} from '@orchagents/contracts';
import { ENGINE_COPY } from './strings.js';

/** Structural MessagePort: Electron's port, a Node child-process channel, or a test pair. */
export interface EnginePort {
  postMessage(message: unknown): void;
  on(event: 'message', listener: (message: unknown) => void): unknown;
}

/** Electron and DOM ports hand over a MessageEvent; the protocol message is its `data`. */
export function unwrapPortMessage(raw: unknown): unknown {
  if (typeof raw === 'object' && raw !== null && 'data' in raw && !('id' in raw) && !('type' in raw)) {
    return (raw as { data: unknown }).data;
  }
  return raw;
}

export function engineUnavailable(): OrchError {
  return { code: 'engine_unavailable', message: ENGINE_COPY.unavailable.message, fix: ENGINE_COPY.unavailable.fix };
}

function toOrchError(code: string, message: string): OrchError {
  const parsed = ErrorCodeSchema.safeParse(code);
  const mapped: ErrorCode = parsed.success ? parsed.data : 'internal';
  return { code: mapped, message };
}

interface Pending {
  resolve: (result: Result<unknown>) => void;
}

export class EngineClient {
  private nextId = 1;
  private closed = false;
  private readonly pending = new Map<number, Pending>();
  private readonly listeners = new Set<(event: EngineEvent) => void>();

  private readonly port: EnginePort;

  constructor(port: EnginePort) {
    this.port = port;
    port.on('message', (raw) => this.onMessage(unwrapPortMessage(raw)));
  }

  /** Send one request. Invalid requests fail here and never reach the port. */
  request(request: EngineRequest): Promise<Result<unknown>> {
    if (this.closed) return Promise.resolve({ ok: false, error: engineUnavailable() });
    const parsed = EngineRequest.safeParse(request);
    if (!parsed.success) {
      return Promise.resolve({
        ok: false,
        error: { code: 'validation_failed', message: ENGINE_COPY.invalidRequest.message, fix: ENGINE_COPY.invalidRequest.fix },
      });
    }
    const id = this.nextId++;
    return new Promise<Result<unknown>>((resolve) => {
      this.pending.set(id, { resolve });
      this.port.postMessage({ id, request: parsed.data } satisfies EngineEnvelope);
    });
  }

  /** Subscribe to engine events. Returns an unsubscribe function. */
  onEvent(listener: (event: EngineEvent) => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  /** Liveness check (health.ping). The engine's version comes back with it. */
  async ping(): Promise<Result<{ engineVersion: string }>> {
    const result = await this.request({ op: 'health.ping' });
    if (!result.ok) return result;
    const value = result.value as { engineVersion?: unknown } | null;
    if (typeof value?.engineVersion !== 'string') {
      return { ok: false, error: { code: 'engine_contract_mismatch', message: ENGINE_COPY.invalidRequest.message } };
    }
    return { ok: true, value: { engineVersion: value.engineVersion } };
  }

  /** `ready` when the engine answers a ping, otherwise the unavailable error. */
  async health(): Promise<Result<{ state: 'ready'; engineVersion: string }>> {
    const pong = await this.ping();
    if (!pong.ok) return pong;
    return { ok: true, value: { state: 'ready', engineVersion: pong.value.engineVersion } };
  }

  /** Called when the port or the engine process goes away. Pending calls fail as unavailable. */
  close(): void {
    if (this.closed) return;
    this.closed = true;
    for (const [id, entry] of this.pending) {
      this.pending.delete(id);
      entry.resolve({ ok: false, error: engineUnavailable() });
    }
    this.listeners.clear();
  }

  private onMessage(message: unknown): void {
    if (typeof message !== 'object' || message === null) return;
    if ('ok' in message) {
      const reply = EngineReply.safeParse(message);
      if (!reply.success) return;
      const entry = this.pending.get(reply.data.id);
      if (!entry) return;
      this.pending.delete(reply.data.id);
      if (reply.data.ok) {
        entry.resolve({ ok: true, value: reply.data.value });
      } else {
        const error = reply.data.error ?? { code: 'internal', message: ENGINE_COPY.workflowFailed.message };
        entry.resolve({ ok: false, error: toOrchError(error.code, error.message) });
      }
      return;
    }
    if ('type' in message) {
      const event = EngineEvent.safeParse(message);
      if (!event.success) return;
      for (const listener of this.listeners) listener(event.data);
    }
  }
}
