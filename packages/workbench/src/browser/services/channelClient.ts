/**
 * Browser-side JSON-RPC client for the core host (docs/architecture.md "Channels").
 *
 * Mirrors the wire format of packages/platform/src/channels/common (protocol.ts,
 * client.ts, messagePort.ts). It cannot import that package: workbench may use only
 * base, contracts and design. The test suite checks the two ends against each other.
 *
 * Wire format:
 * - request:      { jsonrpc: '2.0', id, method: '<channel>.<method>', params?: args[] }
 * - response:     { jsonrpc: '2.0', id, result: Result<T> } or { id, error: { code, message } }
 * - subscribe:    request 'events.subscribe' once; then notifications 'events.event' with params [OrchEvent]
 * - unsubscribe:  request 'events.unsubscribe' when the last listener leaves
 *
 * Every reply and event is validated with the contracts schemas. Calls never throw:
 * they resolve to Result<T>.
 */
import type { OrchError, OrchEvent, Result } from '@orchagents/contracts';
import { OrchError as OrchErrorSchema, OrchEvent as OrchEventSchema } from '@orchagents/contracts';
import { dataStrings } from './dataStrings.js';

/** The part of a MessagePort the client uses. DOM MessagePort and Electron MessagePortMain both fit. */
export interface BrowserPortLike {
  postMessage(message: unknown): void;
  close(): void;
  start?(): void;
  addEventListener(type: 'message', listener: (event: { data: unknown }) => void): void;
  removeEventListener(type: 'message', listener: (event: { data: unknown }) => void): void;
}

type EventListenerFn = (event: OrchEvent) => void;

/** Anything with safeParse that returns success or an error with a message. Zod schemas fit. */
export interface Parser<T> {
  safeParse(value: unknown): { success: true; data: T } | { success: false; error: { message: string } };
}

/** The argument parsers (one per argument, in order) and the reply parser of one method. */
export interface MethodSpec<A extends readonly unknown[] = readonly unknown[], R = unknown> {
  readonly args: { readonly [I in keyof A]: Parser<A[I]> };
  readonly result: Parser<R>;
}

interface PendingCall {
  resolve: (result: Result<unknown>) => void;
  spec: MethodSpec | undefined;
  label: string;
}

const JSONRPC_METHOD_NOT_FOUND = -32601;
const JSONRPC_INVALID_PARAMS = -32602;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function failure(error: OrchError): Result<never> {
  return { ok: false, error };
}

function unreadable(label: string): Result<never> {
  const copy = dataStrings.replyUnreadable(label);
  return failure({ code: 'internal', message: copy.message, fix: copy.fix });
}

export class BrowserChannelClient {
  private readonly pending = new Map<number, PendingCall>();
  private readonly listeners = new Set<EventListenerFn>();
  private readonly onPortMessage: (event: { data: unknown }) => void;
  private requestCounter = 0;
  private isEventsSubscribed = false;
  private closed = false;

  constructor(private readonly port: BrowserPortLike) {
    this.onPortMessage = (event) => this.handleMessage(event.data);
    this.port.addEventListener('message', this.onPortMessage);
    this.port.start?.();
  }

  get isClosed(): boolean {
    return this.closed;
  }

  /**
   * Calls one service method. `spec` validates the arguments before sending and the
   * reply after receiving. The returned promise always resolves.
   */
  call(
    channel: string,
    method: string,
    args: readonly unknown[],
    spec: MethodSpec | undefined,
  ): Promise<Result<unknown>> {
    const label = `${channel}.${method}`;
    if (this.closed) {
      return Promise.resolve(
        failure({
          code: 'internal',
          message: dataStrings.connectionLost.message,
          fix: dataStrings.connectionLost.fix,
        }),
      );
    }

    if (spec) {
      for (let i = 0; i < spec.args.length; i += 1) {
        const parsed = spec.args[i]?.safeParse(args[i]);
        if (!parsed || !parsed.success) {
          return Promise.resolve(
            failure({
              code: 'validation_failed',
              message: `Invalid arguments for ${label}: argument ${i + 1} does not match the contract.`,
              fix: 'Verify the arguments passed match the schema.',
            }),
          );
        }
      }
      // Missing trailing args are allowed when their parser accepts undefined (optional parameters).
      if (args.length > spec.args.length) {
        return Promise.resolve(
          failure({
            code: 'validation_failed',
            message: `Invalid arguments for ${label}: expected ${spec.args.length}, got ${args.length}.`,
            fix: 'Verify the arguments passed match the schema.',
          }),
        );
      }
    }

    const id = this.nextId();
    return new Promise<Result<unknown>>((resolve) => {
      this.pending.set(id, { resolve, spec, label });
      try {
        this.port.postMessage({
          jsonrpc: '2.0',
          id,
          method: label,
          ...(args.length > 0 ? { params: [...args] } : {}),
        });
      } catch {
        this.pending.delete(id);
        resolve(
          failure({
            code: 'internal',
            message: dataStrings.connectionLost.message,
            fix: dataStrings.connectionLost.fix,
          }),
        );
      }
    });
  }

  /**
   * Subscribes to the core host's OrchEvent stream. The first listener makes the
   * client ask the host to start sending events; the last one to leave stops it.
   * Returns an unsubscribe function.
   */
  subscribe(listener: EventListenerFn): () => void {
    if (this.closed) {
      return () => undefined;
    }
    this.listeners.add(listener);

    if (!this.isEventsSubscribed) {
      this.isEventsSubscribed = true;
      this.sendNotificationRequest('events.subscribe');
    }

    let unsubscribed = false;
    return () => {
      if (unsubscribed) {
        return;
      }
      unsubscribed = true;
      this.listeners.delete(listener);
      if (this.listeners.size === 0 && this.isEventsSubscribed) {
        this.isEventsSubscribed = false;
        if (!this.closed) {
          this.sendNotificationRequest('events.unsubscribe');
        }
      }
    };
  }

  /** Stops listening, fails pending calls and closes the port. Safe to call twice. */
  close(): void {
    if (this.closed) {
      return;
    }
    if (this.isEventsSubscribed) {
      this.isEventsSubscribed = false;
      this.sendNotificationRequest('events.unsubscribe');
    }
    this.closed = true;
    this.listeners.clear();
    this.failAllPending();
    this.port.removeEventListener('message', this.onPortMessage);
    try {
      this.port.close();
    } catch {
      // Closing an already closed port is not an error for us
    }
  }

  private sendNotificationRequest(method: 'events.subscribe' | 'events.unsubscribe'): void {
    try {
      this.port.postMessage({ jsonrpc: '2.0', id: this.nextId(), method });
    } catch {
      // The port is gone; the next call will report the lost connection
    }
  }

  private nextId(): number {
    this.requestCounter += 1;
    return this.requestCounter;
  }

  private handleMessage(data: unknown): void {
    if (!isRecord(data) || data.jsonrpc !== '2.0') {
      return;
    }

    if (typeof data.method === 'string' && !('id' in data)) {
      this.handleNotification(data.method, data.params);
      return;
    }

    if ('id' in data && ('result' in data || 'error' in data)) {
      this.handleResponse(data);
    }
  }

  private handleNotification(method: string, params: unknown): void {
    if (method !== 'events.event' || !Array.isArray(params) || params.length === 0) {
      return;
    }
    const parsed = OrchEventSchema.safeParse(params[0]);
    if (!parsed.success) {
      return;
    }
    for (const listener of Array.from(this.listeners)) {
      try {
        listener(parsed.data);
      } catch {
        // A listener that throws must not stop the others
      }
    }
  }

  private handleResponse(data: Record<string, unknown>): void {
    const id = data.id;
    if (typeof id !== 'number') {
      return;
    }
    const pending = this.pending.get(id);
    if (!pending) {
      return;
    }
    this.pending.delete(id);

    if (isRecord(data.error)) {
      const code = typeof data.error.code === 'number' ? data.error.code : 0;
      const message = typeof data.error.message === 'string' ? data.error.message : '';
      let errorCode: OrchError['code'] = 'internal';
      if (code === JSONRPC_METHOD_NOT_FOUND) errorCode = 'not_found';
      else if (code === JSONRPC_INVALID_PARAMS) errorCode = 'validation_failed';
      pending.resolve(
        failure({
          code: errorCode,
          message: message || 'Service call failed',
          fix: 'Verify the service method and parameters.',
        }),
      );
      return;
    }

    const result = data.result;
    if (!isRecord(result) || typeof result.ok !== 'boolean') {
      pending.resolve(unreadable(pending.label));
      return;
    }

    if (result.ok === true) {
      if (!pending.spec) {
        pending.resolve({ ok: true, value: result.value });
        return;
      }
      const parsed = pending.spec.result.safeParse(result.value);
      if (!parsed.success) {
        pending.resolve(unreadable(pending.label));
        return;
      }
      pending.resolve({ ok: true, value: parsed.data });
      return;
    }

    const parsedError = OrchErrorSchema.safeParse(result.error);
    if (!parsedError.success) {
      pending.resolve(unreadable(pending.label));
      return;
    }
    pending.resolve({ ok: false, error: parsedError.data });
  }

  private failAllPending(): void {
    for (const pending of this.pending.values()) {
      pending.resolve(
        failure({
          code: 'internal',
          message: dataStrings.connectionLost.message,
          fix: dataStrings.connectionLost.fix,
        }),
      );
    }
    this.pending.clear();
  }
}
