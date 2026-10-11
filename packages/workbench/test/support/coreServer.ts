/**
 * A minimal COPY of the core host's channel server (packages/platform/src/channels/common/server.ts),
 * used by the workbench tests.
 *
 * Why a copy: depcruise rule workbench-no-platform forbids packages/workbench (tests included)
 * from importing platform. The copy follows the same wire rules: JSON-RPC 2.0 requests with
 * 'channel.method' names and params as an args array; replies are { jsonrpc, id, result: Result };
 * events.subscribe / events.unsubscribe; events go out as 'events.event' notifications with [event].
 * It does not validate args or results: the browser client does that, which is what is under test.
 */
import { err, ok, type Result } from '@orch/base';
import type { OrchEvent } from '@orch/contracts';

type Handler = (...args: unknown[]) => Promise<Result<unknown>> | Result<unknown>;

interface PortLike {
  postMessage(message: unknown): void;
  addEventListener(type: 'message', listener: (event: { data: unknown }) => void): void;
  start(): void;
}

export class MiniCoreServer {
  private readonly services = new Map<string, Record<string, unknown>>();
  private readonly subscribers = new Set<PortLike>();

  register(channel: string, service: object): void {
    this.services.set(channel, service as Record<string, unknown>);
  }

  get subscriberCount(): number {
    return this.subscribers.size;
  }

  /** Attaches one port end of a MessageChannel. */
  connect(port: PortLike): void {
    port.addEventListener('message', (event) => {
      void this.handle(port, event.data);
    });
    port.start();
  }

  /** Sends an event to every subscribed port. */
  emit(event: OrchEvent): void {
    for (const port of this.subscribers) {
      port.postMessage({ jsonrpc: '2.0', method: 'events.event', params: [event] });
    }
  }

  private reply(port: PortLike, id: unknown, result: Result<unknown>): void {
    port.postMessage({ jsonrpc: '2.0', id, result });
  }

  private async handle(port: PortLike, message: unknown): Promise<void> {
    if (typeof message !== 'object' || message === null) return;
    const msg = message as { jsonrpc?: unknown; id?: unknown; method?: unknown; params?: unknown };
    if (msg.jsonrpc !== '2.0' || typeof msg.method !== 'string' || msg.id === undefined) return;

    if (msg.method === 'events.subscribe') {
      this.subscribers.add(port);
      this.reply(port, msg.id, ok(undefined));
      return;
    }
    if (msg.method === 'events.unsubscribe') {
      this.subscribers.delete(port);
      this.reply(port, msg.id, ok(undefined));
      return;
    }

    const dot = msg.method.indexOf('.');
    const channel = dot === -1 ? '' : msg.method.slice(0, dot);
    const name = dot === -1 ? msg.method : msg.method.slice(dot + 1);
    const service = this.services.get(channel);
    const handler = service?.[name];
    if (typeof handler !== 'function') {
      this.reply(port, msg.id, err({ code: 'not_found', message: `Method '${msg.method}' not found`, fix: 'Verify the service and method name.' }));
      return;
    }

    const args = Array.isArray(msg.params) ? msg.params : [];
    try {
      const result = await (handler as Handler).apply(service, args);
      this.reply(port, msg.id, result);
    } catch {
      this.reply(port, msg.id, err({ code: 'internal', message: 'Internal service error', fix: 'An unexpected error occurred while executing the service method.' }));
    }
  }
}
