import { err, ok, type IDisposable, type Result } from '@orch/base';
import { OrchError, OrchEvent, type ErrorCode, type IEventsService } from '@orch/contracts';
import {
  type JsonRpcId,
  type JsonRpcMessage,
  type JsonRpcRequest,
  type MethodSchema,
  type ServiceSchemaMap,
  isJsonRpcNotification,
  isJsonRpcResponse,
} from './protocol.js';
import type { IChannelTransport } from './transport.js';

interface PendingRequest {
  resolve: (res: Result<unknown>) => void;
  serviceName: string;
  methodName: string;
  schema: MethodSchema | undefined;
}

/**
 * Transport-agnostic client that exposes typed service proxies over an IChannelTransport.
 */
export class ChannelClient implements IDisposable {
  private readonly pendingRequests = new Map<JsonRpcId, PendingRequest>();
  private readonly eventListeners = new Set<(event: OrchEvent) => void>();
  private readonly transportCloseSub: IDisposable;
  private readonly transportMessageSub: IDisposable;
  private requestCounter = 0;
  private isServerSubscribed = false;
  private _isDisposed = false;

  constructor(private readonly transport: IChannelTransport) {
    this.transportMessageSub = this.transport.onMessage((msg) => {
      this.handleIncomingMessage(msg);
    });

    this.transportCloseSub = this.transport.onClose(() => {
      this.handleTransportClose();
    });
  }

  get isDisposed(): boolean {
    return this._isDisposed;
  }

  /**
   * Returns a typed proxy implementing service interface T.
   * Method calls are serialized to JSON-RPC 2.0 requests over the transport.
   */
  getService<T>(serviceName: string, schemaMap?: ServiceSchemaMap<T>): T {
    const proxy = new Proxy({} as object, {
      get: (_target, prop) => {
        if (typeof prop !== 'string' || prop === 'then') {
          return undefined;
        }
        if (serviceName === 'events' && prop === 'subscribe') {
          return (listener: (event: OrchEvent) => void) => this.subscribeEvents(listener);
        }
        const schema = schemaMap?.[prop as keyof T];
        return (...args: unknown[]) => {
          return this.invokeMethod(serviceName, prop, args, schema);
        };
      },
    });
    return proxy as unknown as T;
  }

  /**
   * Typed event subscription to the core host's OrchEvent stream.
   */
  get events(): IEventsService {
    return {
      subscribe: (listener: (event: OrchEvent) => void) => this.subscribeEvents(listener),
    };
  }

  private subscribeEvents(listener: (event: OrchEvent) => void): () => void {
    if (this._isDisposed) {
      return () => undefined;
    }
    this.eventListeners.add(listener);

    if (!this.isServerSubscribed && !this.transport.isClosed) {
      this.isServerSubscribed = true;
      const id = this.nextRequestId();
      this.transport.send({
        jsonrpc: '2.0',
        id,
        method: 'events.subscribe',
      });
    }

    let unsubscribed = false;
    return () => {
      if (unsubscribed) {
        return;
      }
      unsubscribed = true;
      this.eventListeners.delete(listener);

      if (this.eventListeners.size === 0 && this.isServerSubscribed && !this.transport.isClosed) {
        this.isServerSubscribed = false;
        const id = this.nextRequestId();
        this.transport.send({
          jsonrpc: '2.0',
          id,
          method: 'events.unsubscribe',
        });
      }
    };
  }

  private async invokeMethod(
    serviceName: string,
    methodName: string,
    args: unknown[],
    schema: MethodSchema | undefined,
  ): Promise<Result<unknown>> {
    if (this._isDisposed || this.transport.isClosed) {
      return err({
        code: 'internal',
        message: 'Channel transport is closed',
        fix: 'Ensure the host service is running and reconnect.',
      });
    }

    // Client-side argument validation
    if (schema?.args) {
      const parsedArgs = schema.args.safeParse(args);
      if (!parsedArgs.success) {
        return err({
          code: 'validation_failed',
          message: `Invalid arguments for ${serviceName}.${methodName}: ${parsedArgs.error.message}`,
          fix: 'Verify the arguments passed match the schema.',
        });
      }
    }

    const id = this.nextRequestId();
    const wireMethod = serviceName ? `${serviceName}.${methodName}` : methodName;

    return new Promise<Result<unknown>>((resolve) => {
      this.pendingRequests.set(id, {
        resolve,
        serviceName,
        methodName,
        schema,
      });

      const request: JsonRpcRequest = {
        jsonrpc: '2.0',
        id,
        method: wireMethod,
        ...(args.length > 0 ? { params: args } : {}),
      };

      try {
        this.transport.send(request);
      } catch {
        this.pendingRequests.delete(id);
        resolve(
          err({
            code: 'internal',
            message: 'Failed to send message over transport',
            fix: 'Check if the connection was terminated.',
          }),
        );
      }
    });
  }

  private handleIncomingMessage(msg: JsonRpcMessage): void {
    if (isJsonRpcResponse(msg)) {
      if (msg.id === null) {
        return;
      }
      const pending = this.pendingRequests.get(msg.id);
      if (!pending) {
        return;
      }
      this.pendingRequests.delete(msg.id);

      if (msg.error) {
        let code: ErrorCode = 'internal';
        if (msg.error.code === -32601) {
          code = 'not_found';
        } else if (msg.error.code === -32602) {
          code = 'validation_failed';
        }
        pending.resolve(
          err({
            code,
            message: msg.error.message || 'Service call failed',
            fix: 'Verify the service method and parameters.',
          }),
        );
        return;
      }

      if (typeof msg.result === 'object' && msg.result !== null && 'ok' in msg.result) {
        const rawResult = msg.result as Result<unknown>;
        if (rawResult.ok === true) {
          if (pending.schema?.result) {
            const parsed = pending.schema.result.safeParse(rawResult.value);
            if (!parsed.success) {
              pending.resolve(
                err({
                  code: 'validation_failed',
                  message: `Result validation failed for ${pending.serviceName}.${pending.methodName}: ${parsed.error.message}`,
                  fix: 'The service returned a payload violating the schema contract.',
                }),
              );
              return;
            }
            pending.resolve(ok(parsed.data));
            return;
          }
          pending.resolve(rawResult);
          return;
        } else {
          const parsedErr = OrchError.safeParse(rawResult.error);
          if (!parsedErr.success) {
            pending.resolve(
              err({
                code: 'validation_failed',
                message: `Error validation failed for ${pending.serviceName}.${pending.methodName}: ${parsedErr.error.message}`,
                fix: 'The service returned an invalid error structure.',
              }),
            );
            return;
          }
          pending.resolve(rawResult);
          return;
        }
      }

      pending.resolve(
        err({
          code: 'validation_failed',
          message: `Response from ${pending.serviceName}.${pending.methodName} is not a valid Result`,
          fix: 'Service methods must return Result<T>.',
        }),
      );
      return;
    }

    if (isJsonRpcNotification(msg)) {
      if (msg.method === 'events.event' && Array.isArray(msg.params) && msg.params.length > 0) {
        const eventData = msg.params[0];
        const parsed = OrchEvent.safeParse(eventData);
        if (parsed.success) {
          for (const listener of Array.from(this.eventListeners)) {
            try {
              listener(parsed.data);
            } catch {
              // Subscriber exceptions do not break the event loop
            }
          }
        }
      }
    }
  }

  private handleTransportClose(): void {
    for (const pending of this.pendingRequests.values()) {
      pending.resolve(
        err({
          code: 'internal',
          message: 'Connection closed',
          fix: 'The connection was lost. Check if the service host is still running.',
        }),
      );
    }
    this.pendingRequests.clear();
  }

  private nextRequestId(): number {
    this.requestCounter += 1;
    return this.requestCounter;
  }

  dispose(): void {
    if (this._isDisposed) {
      return;
    }
    this._isDisposed = true;

    if (this.isServerSubscribed && !this.transport.isClosed) {
      try {
        const id = this.nextRequestId();
        this.transport.send({
          jsonrpc: '2.0',
          id,
          method: 'events.unsubscribe',
        });
      } catch {
        // Ignore send errors during disposal
      }
    }

    this.eventListeners.clear();
    this.handleTransportClose();
    this.transportMessageSub.dispose();
    this.transportCloseSub.dispose();
    this.transport.close();
  }
}

/**
 * Convenience helper to create a single service proxy over a transport.
 */
export function createServiceProxy<T>(
  transport: IChannelTransport,
  serviceName: string,
  schemaMap?: ServiceSchemaMap<T>,
): T {
  const client = new ChannelClient(transport);
  return client.getService<T>(serviceName, schemaMap);
}
