import type { IDisposable } from '@orchagents/base';
import type { JsonRpcMessage } from './protocol.js';

/**
 * Transport-agnostic contract for full-duplex communication between channel endpoints.
 */
export interface IChannelTransport extends IDisposable {
  /** Sends a JSON-RPC message to the peer. */
  send(message: JsonRpcMessage): void;
  /** Registers a listener for incoming messages. Returns an unsubscribe disposable. */
  onMessage(listener: (message: JsonRpcMessage) => void): IDisposable;
  /** Registers a listener for connection close/termination. Returns an unsubscribe disposable. */
  onClose(listener: (error?: Error) => void): IDisposable;
  /** Closes the transport. */
  close(): void;
  /** Whether the transport has been closed. */
  readonly isClosed: boolean;
}
