import * as fs from 'node:fs';
import * as net from 'node:net';
import { Emitter, type IDisposable } from '@orchagents/base';
import {
  type JsonRpcMessage,
  isJsonRpcNotification,
  isJsonRpcRequest,
  isJsonRpcResponse,
} from '../common/protocol.js';
import type { ChannelServer } from '../common/server.js';
import type { IChannelTransport } from '../common/transport.js';

function parseJsonRpcMessage(obj: unknown): JsonRpcMessage | null {
  if (
    isJsonRpcRequest(obj) ||
    isJsonRpcNotification(obj) ||
    isJsonRpcResponse(obj)
  ) {
    return obj;
  }
  return null;
}

export class SocketTransport implements IChannelTransport {
  private readonly messageEmitter = new Emitter<JsonRpcMessage>();
  private readonly closeEmitter = new Emitter<Error | undefined>();
  private _isClosed = false;
  private buffer = '';

  constructor(
    private readonly socket: net.Socket,
    initialBuffer = '',
  ) {
    this.buffer = initialBuffer;

    this.socket.on('data', (chunk: Buffer) => {
      this.handleData(chunk.toString('utf8'));
    });

    this.socket.on('close', () => {
      this.handleSocketClose();
    });

    this.socket.on('error', (err: Error) => {
      this.handleSocketClose(err);
    });

    if (this.buffer.length > 0) {
      this.processBuffer();
    }
  }

  get isClosed(): boolean {
    return this._isClosed;
  }

  private handleData(data: string): void {
    if (this._isClosed) {
      return;
    }
    this.buffer += data;
    this.processBuffer();
  }

  private processBuffer(): void {
    let newlineIndex: number;
    while ((newlineIndex = this.buffer.indexOf('\n')) !== -1) {
      const line = this.buffer.slice(0, newlineIndex).trim();
      this.buffer = this.buffer.slice(newlineIndex + 1);
      if (line.length === 0) {
        continue;
      }
      try {
        const parsed: unknown = JSON.parse(line);
        const msg = parseJsonRpcMessage(parsed);
        if (msg) {
          this.messageEmitter.fire(msg);
        }
      } catch {
        // Drop unparseable lines
      }
    }
  }

  private handleSocketClose(error?: Error): void {
    if (this._isClosed) {
      return;
    }
    this._isClosed = true;
    this.closeEmitter.fire(error);
    this.messageEmitter.dispose();
    this.closeEmitter.dispose();
  }

  send(message: JsonRpcMessage): void {
    if (this._isClosed || this.socket.destroyed) {
      return;
    }
    try {
      this.socket.write(JSON.stringify(message) + '\n', 'utf8');
    } catch {
      this.handleSocketClose();
    }
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
    try {
      this.socket.end();
      this.socket.destroy();
    } catch {
      // Ignore destroy failure
    }
    this.handleSocketClose();
  }

  dispose(): void {
    this.close();
  }
}

export interface SocketServerOptions {
  socketPath: string;
  token: string;
  channelServer: ChannelServer;
}

export class SocketServer implements IDisposable {
  private server: net.Server | null = null;
  private readonly sockets = new Set<net.Socket>();
  private readonly socketPath: string;
  private readonly token: string;
  private readonly channelServer: ChannelServer;
  private _isDisposed = false;

  constructor(options: SocketServerOptions) {
    this.socketPath = options.socketPath;
    this.token = options.token;
    this.channelServer = options.channelServer;
  }

  get isDisposed(): boolean {
    return this._isDisposed;
  }

  async start(): Promise<void> {
    if (this._isDisposed) {
      throw new Error('SocketServer has been disposed');
    }

    // Clean up stale socket file on Unix
    if (process.platform !== 'win32') {
      try {
        if (fs.existsSync(this.socketPath)) {
          fs.unlinkSync(this.socketPath);
        }
      } catch {
        // Ignore unlink error
      }
    }

    return new Promise<void>((resolve, reject) => {
      const server = net.createServer((socket) => {
        this.handleConnection(socket);
      });
      this.server = server;

      server.on('error', (err) => {
        reject(err);
      });

      server.listen(this.socketPath, () => {
        // Owner-only permissions (chmod 0600) on Unix sockets
        if (process.platform !== 'win32') {
          try {
            fs.chmodSync(this.socketPath, 0o600);
          } catch (chmodErr) {
            reject(chmodErr);
            return;
          }
        }
        resolve();
      });
    });
  }

  private handleConnection(socket: net.Socket): void {
    this.sockets.add(socket);
    socket.on('close', () => {
      this.sockets.delete(socket);
    });

    let buffer = '';
    let authenticated = false;

    const authTimeout = setTimeout(() => {
      if (!authenticated) {
        socket.destroy();
      }
    }, 5000);

    const onData = (chunk: Buffer): void => {
      buffer += chunk.toString('utf8');
      const newlineIndex = buffer.indexOf('\n');
      if (newlineIndex === -1) {
        return;
      }

      const line = buffer.slice(0, newlineIndex).trim();
      const remaining = buffer.slice(newlineIndex + 1);

      socket.off('data', onData);
      clearTimeout(authTimeout);

      try {
        const msg: unknown = JSON.parse(line);
        if (
          typeof msg === 'object' &&
          msg !== null &&
          'method' in msg &&
          (msg as { method: unknown }).method === 'auth' &&
          'params' in msg &&
          typeof (msg as { params: unknown }).params === 'object' &&
          (msg as { params: { token?: unknown } }).params.token === this.token
        ) {
          authenticated = true;
          const reqId = 'id' in msg ? (msg as { id: unknown }).id : 1;
          socket.write(
            JSON.stringify({
              jsonrpc: '2.0',
              id: reqId,
              result: { ok: true },
            }) + '\n',
            'utf8',
          );

          const transport = new SocketTransport(socket, remaining);
          this.channelServer.handleConnection(transport);
          return;
        }
      } catch {
        // Invalid auth payload
      }

      // Wrong token or invalid first message: refuse and close immediately
      socket.write(
        JSON.stringify({
          jsonrpc: '2.0',
          id: null,
          error: { code: -32000, message: 'Authentication failed' },
        }) + '\n',
        'utf8',
        () => {
          socket.destroy();
        },
      );
      setTimeout(() => {
        if (!socket.destroyed) {
          socket.destroy();
        }
      }, 50);
    };

    socket.on('data', onData);
  }

  async close(): Promise<void> {
    if (this._isDisposed) {
      return;
    }
    this._isDisposed = true;

    for (const socket of Array.from(this.sockets)) {
      try {
        socket.destroy();
      } catch {
        // Ignore
      }
    }
    this.sockets.clear();

    if (this.server) {
      await new Promise<void>((resolve) => {
        this.server?.close(() => {
          resolve();
        });
      });
      this.server = null;
    }

    if (process.platform !== 'win32') {
      try {
        if (fs.existsSync(this.socketPath)) {
          fs.unlinkSync(this.socketPath);
        }
      } catch {
        // Ignore unlink error
      }
    }
  }

  dispose(): void {
    void this.close();
  }
}

export interface SocketClientOptions {
  socketPath: string;
  token: string;
}

/**
 * Connects to a local socket server, sends the random authentication token in the first message,
 * and returns the authenticated IChannelTransport.
 */
export async function createSocketClientTransport(
  options: SocketClientOptions,
): Promise<IChannelTransport> {
  return new Promise<IChannelTransport>((resolve, reject) => {
    const socket = net.createConnection(options.socketPath);
    let buffer = '';
    let settled = false;

    const timeout = setTimeout(() => {
      if (!settled) {
        settled = true;
        socket.destroy();
        reject(new Error('Connection timed out during authentication'));
      }
    }, 5000);

    const cleanup = (): void => {
      clearTimeout(timeout);
      socket.off('data', onData);
      socket.off('error', onError);
      socket.off('close', onClose);
    };

    const onError = (err: Error): void => {
      if (!settled) {
        settled = true;
        cleanup();
        reject(err);
      }
    };

    const onClose = (): void => {
      if (!settled) {
        settled = true;
        cleanup();
        reject(new Error('Connection closed before authentication completed'));
      }
    };

    const onData = (chunk: Buffer): void => {
      buffer += chunk.toString('utf8');
      const newlineIndex = buffer.indexOf('\n');
      if (newlineIndex === -1) {
        return;
      }

      const line = buffer.slice(0, newlineIndex).trim();
      const remaining = buffer.slice(newlineIndex + 1);
      settled = true;
      cleanup();

      try {
        const msg: unknown = JSON.parse(line);
        if (
          typeof msg === 'object' &&
          msg !== null &&
          'result' in msg &&
          typeof (msg as { result: unknown }).result === 'object' &&
          (msg as { result: { ok?: unknown } }).result.ok === true
        ) {
          resolve(new SocketTransport(socket, remaining));
          return;
        }
      } catch {
        // Fall through to reject
      }

      socket.destroy();
      reject(new Error('Authentication failed: wrong token or connection refused'));
    };

    socket.on('error', onError);
    socket.on('close', onClose);
    socket.on('data', onData);

    socket.on('connect', () => {
      socket.write(
        JSON.stringify({
          jsonrpc: '2.0',
          id: 1,
          method: 'auth',
          params: { token: options.token },
        }) + '\n',
        'utf8',
      );
    });
  });
}
