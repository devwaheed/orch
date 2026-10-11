import { Emitter, type IDisposable } from '@orch/base';
import {
  type JsonRpcMessage,
  isJsonRpcNotification,
  isJsonRpcRequest,
  isJsonRpcResponse,
} from './protocol.js';
import type { IChannelTransport } from './transport.js';

/**
 * Minimal structural port interface matching DOM MessagePort, Electron MessagePortMain,
 * and node:worker_threads MessagePort.
 */
export interface MessagePortLike {
  postMessage(message: unknown): void;
  close(): void;
  start?(): void;
  on?(event: 'message', listener: (arg: unknown) => void): unknown;
  on?(event: 'close', listener: () => void): unknown;
  off?(event: string, listener: (...args: unknown[]) => void): unknown;
  removeListener?(event: string, listener: (...args: unknown[]) => void): unknown;
  addEventListener?(type: 'message', listener: (event: unknown) => void): void;
  addEventListener?(type: 'close', listener: () => void): void;
  removeEventListener?(type: string, listener: (event: unknown) => void): void;
}

function extractMessage(arg: unknown): JsonRpcMessage | null {
  let target = arg;
  if (
    target !== null &&
    typeof target === 'object' &&
    'data' in target &&
    !('jsonrpc' in target)
  ) {
    target = (target as { data: unknown }).data;
  }
  if (
    isJsonRpcRequest(target) ||
    isJsonRpcNotification(target) ||
    isJsonRpcResponse(target)
  ) {
    return target;
  }
  return null;
}

export class MessagePortTransport implements IChannelTransport {
  private readonly messageEmitter = new Emitter<JsonRpcMessage>();
  private readonly closeEmitter = new Emitter<Error | undefined>();
  private _isClosed = false;
  private readonly cleanupFns: (() => void)[] = [];

  constructor(private readonly port: MessagePortLike) {
    const onMessage = (arg: unknown): void => {
      if (this._isClosed) {
        return;
      }
      const msg = extractMessage(arg);
      if (msg) {
        this.messageEmitter.fire(msg);
      }
    };

    const onClose = (): void => {
      this.handlePortClose();
    };

    if (typeof port.addEventListener === 'function') {
      port.addEventListener('message', onMessage);
      port.addEventListener('close', onClose);
      this.cleanupFns.push(() => {
        if (typeof port.removeEventListener === 'function') {
          port.removeEventListener('message', onMessage);
          port.removeEventListener('close', onClose);
        }
      });
    } else if (typeof port.on === 'function') {
      port.on('message', onMessage);
      port.on('close', onClose);
      this.cleanupFns.push(() => {
        if (typeof port.off === 'function') {
          port.off('message', onMessage);
          port.off('close', onClose);
        } else if (typeof port.removeListener === 'function') {
          port.removeListener('message', onMessage);
          port.removeListener('close', onClose);
        }
      });
    }

    if (typeof port.start === 'function') {
      port.start();
    }
  }

  get isClosed(): boolean {
    return this._isClosed;
  }

  send(message: JsonRpcMessage): void {
    if (this._isClosed) {
      return;
    }
    try {
      this.port.postMessage(message);
    } catch {
      this.handlePortClose();
    }
  }

  onMessage(listener: (message: JsonRpcMessage) => void): IDisposable {
    return this.messageEmitter.event(listener);
  }

  onClose(listener: (error?: Error) => void): IDisposable {
    return this.closeEmitter.event(listener);
  }

  private handlePortClose(): void {
    if (this._isClosed) {
      return;
    }
    this._isClosed = true;
    for (const cleanup of this.cleanupFns) {
      try {
        cleanup();
      } catch {
        // Ignore cleanup failure
      }
    }
    this.cleanupFns.length = 0;
    this.closeEmitter.fire(undefined);
    this.messageEmitter.dispose();
    this.closeEmitter.dispose();
  }

  close(): void {
    if (this._isClosed) {
      return;
    }
    try {
      this.port.close();
    } catch {
      // Ignore close failure
    }
    this.handlePortClose();
  }

  dispose(): void {
    this.close();
  }
}

export function createMessagePortTransport(port: MessagePortLike): IChannelTransport {
  return new MessagePortTransport(port);
}
