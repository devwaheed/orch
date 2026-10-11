import { err, ok, toDisposable, type IDisposable, type Result } from '@orch/base';
import { OrchEvent, type IEventsService } from '@orch/contracts';
import {
  type ChannelAbortController,
  type JsonRpcId,
  type JsonRpcMessage,
  type JsonRpcResponse,
  type MethodSchema,
  type ServiceSchemaMap,
  createAbortController,
  isJsonRpcRequest,
} from './protocol.js';
import type { IChannelTransport } from './transport.js';

interface ServiceEntry {
  service: unknown;
  schemaMap: ServiceSchemaMap | undefined;
}

interface ConnectionContext {
  transport: IChannelTransport;
  pendingCalls: Map<JsonRpcId, ChannelAbortController>;
  eventSubscriptions: Set<() => void>;
  disposable: IDisposable;
}

/**
 * Server that hosts services and manages RPC dispatch, validation,
 * cancellation, and event streaming across connected transports.
 */
export class ChannelServer implements IDisposable {
  private readonly services = new Map<string, ServiceEntry>();
  private readonly connections = new Set<ConnectionContext>();
  private _isDisposed = false;

  constructor(private readonly eventsService?: IEventsService) {}

  get isDisposed(): boolean {
    return this._isDisposed;
  }

  /**
   * Registers a service implementation under a service/channel name.
   */
  registerService<T>(name: string, service: T, schemaMap?: ServiceSchemaMap<T>): void {
    this.services.set(name, {
      service,
      schemaMap: schemaMap as ServiceSchemaMap | undefined,
    });
  }

  /**
   * Attaches an incoming transport connection to the server.
   * Returns a disposable that tears down the connection.
   */
  handleConnection(transport: IChannelTransport): IDisposable {
    if (this._isDisposed || transport.isClosed) {
      return toDisposable(() => undefined);
    }

    const context: ConnectionContext = {
      transport,
      pendingCalls: new Map(),
      eventSubscriptions: new Set(),
      disposable: toDisposable(() => undefined),
    };

    const cleanupConnection = (): void => {
      if (!this.connections.has(context)) {
        return;
      }
      this.connections.delete(context);

      // Abort all in-flight calls on peer disconnect
      for (const controller of context.pendingCalls.values()) {
        controller.abort(new Error('Peer disconnected'));
      }
      context.pendingCalls.clear();

      // Cleanly unsubscribe all event streams for this peer
      for (const unsub of context.eventSubscriptions) {
        try {
          unsub();
        } catch {
          // Ignore subscriber teardown errors
        }
      }
      context.eventSubscriptions.clear();
    };

    const messageSub = transport.onMessage((msg) => {
      this.handleIncomingMessage(context, msg);
    });

    const closeSub = transport.onClose(() => {
      cleanupConnection();
    });

    context.disposable = toDisposable(() => {
      messageSub.dispose();
      closeSub.dispose();
      cleanupConnection();
      transport.close();
    });

    this.connections.add(context);
    return context.disposable;
  }

  private handleIncomingMessage(context: ConnectionContext, msg: JsonRpcMessage): void {
    if (!isJsonRpcRequest(msg)) {
      return;
    }

    const { id, method, params } = msg;

    // Handle event subscription
    if (method === 'events.subscribe') {
      if (!this.eventsService) {
        this.sendResult(
          context.transport,
          id,
          err({
            code: 'not_found',
            message: 'Events service is not registered',
            fix: 'Register an events service on the channel host.',
          }),
        );
        return;
      }

      const unsub = this.eventsService.subscribe((event) => {
        if (context.transport.isClosed) {
          return;
        }
        const parsed = OrchEvent.safeParse(event);
        if (parsed.success) {
          context.transport.send({
            jsonrpc: '2.0',
            method: 'events.event',
            params: [parsed.data],
          });
        }
      });

      context.eventSubscriptions.add(unsub);
      this.sendResult(context.transport, id, ok(undefined));
      return;
    }

    // Handle event unsubscription
    if (method === 'events.unsubscribe') {
      for (const unsub of context.eventSubscriptions) {
        try {
          unsub();
        } catch {
          // Ignore teardown error
        }
      }
      context.eventSubscriptions.clear();
      this.sendResult(context.transport, id, ok(undefined));
      return;
    }

    // Resolve service and method
    const dotIndex = method.indexOf('.');
    let serviceName = '';
    let methodName = method;
    if (dotIndex !== -1) {
      serviceName = method.slice(0, dotIndex);
      methodName = method.slice(dotIndex + 1);
    }

    const entry = this.services.get(serviceName);
    if (!entry) {
      this.sendResult(
        context.transport,
        id,
        err({
          code: 'not_found',
          message: `Method '${method}' not found`,
          fix: 'Verify the service and method name.',
        }),
      );
      return;
    }

    const serviceImpl = entry.service as Record<string, unknown>;
    const handler = serviceImpl[methodName];
    if (typeof handler !== 'function') {
      this.sendResult(
        context.transport,
        id,
        err({
          code: 'not_found',
          message: `Method '${method}' not found`,
          fix: 'Verify the method exists on the service interface.',
        }),
      );
      return;
    }

    const schema: MethodSchema | undefined = entry.schemaMap?.[methodName];
    const rawArgs = Array.isArray(params) ? params : params !== undefined ? [params] : [];

    // Server-side argument validation
    if (schema?.args) {
      const parsedArgs = schema.args.safeParse(rawArgs);
      if (!parsedArgs.success) {
        this.sendResult(
          context.transport,
          id,
          err({
            code: 'validation_failed',
            message: `Invalid arguments for ${method}: ${parsedArgs.error.message}`,
            fix: 'Ensure arguments match the schema defined in the contract.',
          }),
        );
        return;
      }
    }

    // Per-call AbortController for cancellation on disconnect
    const abortController = createAbortController();
    context.pendingCalls.set(id, abortController);

    void (async () => {
      try {
        const resultPromise = (handler as (...args: unknown[]) => Promise<Result<unknown>>).apply(
          serviceImpl,
          [...rawArgs, abortController.signal],
        );

        const serviceResult = await resultPromise;
        context.pendingCalls.delete(id);

        if (context.transport.isClosed) {
          return;
        }

        if (typeof serviceResult === 'object' && serviceResult !== null && 'ok' in serviceResult) {
          if (serviceResult.ok === true && schema?.result) {
            const parsedResult = schema.result.safeParse(serviceResult.value);
            if (!parsedResult.success) {
              this.sendResult(
                context.transport,
                id,
                err({
                  code: 'validation_failed',
                  message: `Result validation failed for ${method}: ${parsedResult.error.message}`,
                  fix: 'The service returned a payload violating the schema contract.',
                }),
              );
              return;
            }
          }
          this.sendResult(context.transport, id, serviceResult);
        } else {
          this.sendResult(
            context.transport,
            id,
            err({
              code: 'internal',
              message: 'Service method did not return a Result',
              fix: 'Service methods must return Result<T>.',
            }),
          );
        }
      } catch {
        context.pendingCalls.delete(id);
        if (context.transport.isClosed) {
          return;
        }
        // Handler exceptions must not leak stack or secrets
        this.sendResult(
          context.transport,
          id,
          err({
            code: 'internal',
            message: 'Internal service error',
            fix: 'An unexpected error occurred while executing the service method.',
          }),
        );
      }
    })();
  }

  private sendResult(transport: IChannelTransport, id: JsonRpcId, result: Result<unknown>): void {
    if (transport.isClosed) {
      return;
    }
    const response: JsonRpcResponse = {
      jsonrpc: '2.0',
      id,
      result,
    };
    try {
      transport.send(response);
    } catch {
      // Transport closed during write
    }
  }

  dispose(): void {
    if (this._isDisposed) {
      return;
    }
    this._isDisposed = true;

    for (const context of Array.from(this.connections)) {
      context.disposable.dispose();
    }
    this.connections.clear();
    this.services.clear();
  }
}
