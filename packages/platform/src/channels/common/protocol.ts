import { z } from 'zod';

export interface ChannelAbortSignal {
  readonly aborted: boolean;
  readonly reason?: unknown;
  addEventListener?(type: string, listener: () => void): void;
  removeEventListener?(type: string, listener: () => void): void;
}

export interface ChannelAbortController {
  readonly signal: ChannelAbortSignal;
  abort(reason?: unknown): void;
}

class FallbackAbortSignal implements ChannelAbortSignal {
  constructor(private readonly controller: FallbackAbortController) {}

  get aborted(): boolean {
    return this.controller.isAborted;
  }

  get reason(): unknown {
    return this.controller.abortReason;
  }

  addEventListener(type: string, listener: () => void): void {
    if (type === 'abort') {
      if (this.controller.isAborted) {
        listener();
      } else {
        this.controller.addListener(listener);
      }
    }
  }

  removeEventListener(type: string, listener: () => void): void {
    if (type === 'abort') {
      this.controller.removeListener(listener);
    }
  }
}

class FallbackAbortController implements ChannelAbortController {
  private _aborted = false;
  private _reason: unknown;
  private readonly listeners = new Set<() => void>();
  readonly signal: ChannelAbortSignal;

  constructor() {
    this.signal = new FallbackAbortSignal(this);
  }

  get isAborted(): boolean {
    return this._aborted;
  }

  get abortReason(): unknown {
    return this._reason;
  }

  addListener(listener: () => void): void {
    this.listeners.add(listener);
  }

  removeListener(listener: () => void): void {
    this.listeners.delete(listener);
  }

  abort(reason?: unknown): void {
    if (this._aborted) {
      return;
    }
    this._aborted = true;
    this._reason = reason;
    for (const listener of Array.from(this.listeners)) {
      try {
        listener();
      } catch {
        // Ignore listener error
      }
    }
    this.listeners.clear();
  }
}

interface NativeAbortControllerConstructor {
  new (): ChannelAbortController;
}

export function createAbortController(): ChannelAbortController {
  const globalObj = globalThis as unknown as {
    AbortController?: NativeAbortControllerConstructor;
  };
  if (typeof globalObj.AbortController === 'function') {
    return new globalObj.AbortController();
  }
  return new FallbackAbortController();
}

export interface MethodSchema<TArgs extends unknown[] = unknown[], TResult = unknown> {
  readonly args: z.ZodType<TArgs>;
  readonly result: z.ZodType<TResult>;
}

export type ServiceSchemaMap<T = unknown> = {
  readonly [K in keyof T]?: MethodSchema<unknown[], unknown>;
} & {
  readonly [key: string]: MethodSchema<unknown[], unknown> | undefined;
};

export function createMethodSchema<TArgs extends unknown[], TResult>(
  args: z.ZodType<TArgs>,
  result: z.ZodType<TResult>,
): MethodSchema<TArgs, TResult> {
  return { args, result };
}

export const JsonRpcId = z.union([z.string(), z.number()]);
export type JsonRpcId = z.infer<typeof JsonRpcId>;

export const JsonRpcRequest = z.object({
  jsonrpc: z.literal('2.0'),
  id: JsonRpcId,
  method: z.string(),
  params: z.unknown().optional(),
});
export type JsonRpcRequest = z.infer<typeof JsonRpcRequest>;

export const JsonRpcNotification = z.object({
  jsonrpc: z.literal('2.0'),
  method: z.string(),
  params: z.unknown().optional(),
});
export type JsonRpcNotification = z.infer<typeof JsonRpcNotification>;

export const JsonRpcErrorPayload = z.object({
  code: z.number(),
  message: z.string(),
  data: z.unknown().optional(),
});
export type JsonRpcErrorPayload = z.infer<typeof JsonRpcErrorPayload>;

export const JsonRpcResponse = z.object({
  jsonrpc: z.literal('2.0'),
  id: JsonRpcId.nullable(),
  result: z.unknown().optional(),
  error: JsonRpcErrorPayload.optional(),
});
export type JsonRpcResponse = z.infer<typeof JsonRpcResponse>;

export type JsonRpcMessage = JsonRpcRequest | JsonRpcNotification | JsonRpcResponse;

export function isJsonRpcRequest(msg: unknown): msg is JsonRpcRequest {
  if (typeof msg !== 'object' || msg === null) {
    return false;
  }
  const candidate = msg as Record<string, unknown>;
  return (
    candidate.jsonrpc === '2.0' &&
    'id' in candidate &&
    (typeof candidate.id === 'string' || typeof candidate.id === 'number') &&
    typeof candidate.method === 'string'
  );
}

export function isJsonRpcNotification(msg: unknown): msg is JsonRpcNotification {
  if (typeof msg !== 'object' || msg === null) {
    return false;
  }
  const candidate = msg as Record<string, unknown>;
  return (
    candidate.jsonrpc === '2.0' &&
    !('id' in candidate) &&
    typeof candidate.method === 'string'
  );
}

export function isJsonRpcResponse(msg: unknown): msg is JsonRpcResponse {
  if (typeof msg !== 'object' || msg === null) {
    return false;
  }
  const candidate = msg as Record<string, unknown>;
  return (
    candidate.jsonrpc === '2.0' &&
    'id' in candidate &&
    ('result' in candidate || 'error' in candidate)
  );
}
