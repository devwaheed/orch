import { Emitter, type IDisposable } from '@orchagents/base';
import type { JsonRpcMessage } from './protocol.js';
import type { IChannelTransport } from './transport.js';

class InProcessTransport implements IChannelTransport {
  private readonly messageEmitter = new Emitter<JsonRpcMessage>();
  private readonly closeEmitter = new Emitter<Error | undefined>();
  private _isClosed = false;
  private peer: InProcessTransport | null = null;

  get isClosed(): boolean {
    return this._isClosed;
  }

  setPeer(peer: InProcessTransport): void {
    this.peer = peer;
  }

  send(message: JsonRpcMessage): void {
    if (this._isClosed || !this.peer || this.peer.isClosed) {
      return;
    }
    const peer = this.peer;
    void Promise.resolve().then(() => {
      if (!peer.isClosed) {
        peer.receive(message);
      }
    });
  }

  receive(message: JsonRpcMessage): void {
    if (this._isClosed) {
      return;
    }
    this.messageEmitter.fire(message);
  }

  onMessage(listener: (message: JsonRpcMessage) => void): IDisposable {
    return this.messageEmitter.event(listener);
  }

  onClose(listener: (error?: Error) => void): IDisposable {
    return this.closeEmitter.event(listener);
  }

  close(): void {
    if (this._isClosed) {
      return;
    }
    this._isClosed = true;
    this.closeEmitter.fire(undefined);
    this.messageEmitter.dispose();
    this.closeEmitter.dispose();

    const peer = this.peer;
    this.peer = null;
    if (peer && !peer.isClosed) {
      void Promise.resolve().then(() => {
        peer.close();
      });
    }
  }

  dispose(): void {
    this.close();
  }
}

/**
 * Creates a connected pair of in-process transports for same-process communication.
 */
export function createInProcessTransportPair(): [IChannelTransport, IChannelTransport] {
  const endpointA = new InProcessTransport();
  const endpointB = new InProcessTransport();
  endpointA.setPeer(endpointB);
  endpointB.setPeer(endpointA);
  return [endpointA, endpointB];
}
