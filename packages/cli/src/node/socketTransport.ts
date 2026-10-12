import * as fs from 'node:fs';
import * as net from 'node:net';
import * as os from 'node:os';
import * as path from 'node:path';
import { Emitter, type IDisposable } from '@orchagents/base';
import {
  type JsonRpcMessage,
  isJsonRpcNotification,
  isJsonRpcRequest,
  isJsonRpcResponse,
} from '@orchagents/platform/src/channels/common/protocol.js';
import type { IChannelTransport } from '@orchagents/platform/src/channels/common/transport.js';

function parseJsonRpcMessage(obj: unknown): JsonRpcMessage | null {
  if (isJsonRpcRequest(obj) || isJsonRpcNotification(obj) || isJsonRpcResponse(obj)) {
    return obj;
  }
  return null;
}

export class SocketClientTransport implements IChannelTransport {
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

export function getDefaultSocketPath(home: string = os.homedir()): string {
  if (process.platform === 'win32') {
    const username = os.userInfo().username;
    return `\\\\.\\pipe\\orch-${username}`;
  }
  return path.join(home, '.orch', 'orch.sock');
}

export function getDefaultTokenPath(home: string = os.homedir()): string {
  return path.join(home, '.orch', 'token');
}

export function readToken(tokenPath: string = getDefaultTokenPath()): string {
  try {
    return fs.readFileSync(tokenPath, 'utf8').trim();
  } catch (cause) {
    throw new Error(`Failed to read orch token from ${tokenPath}: engine/core unavailable`, {
      cause,
    });
  }
}

export interface CliSocketOptions {
  socketPath?: string;
  token?: string;
  /** Home folder whose ~/.orch is used (SEC-01); defaults to the user's home. */
  home?: string;
}

export async function createCliSocketTransport(
  options: CliSocketOptions = {},
): Promise<IChannelTransport> {
  const socketPath = options.socketPath ?? getDefaultSocketPath(options.home);
  const token = options.token ?? readToken(getDefaultTokenPath(options.home));

  return new Promise<IChannelTransport>((resolve, reject) => {
    const socket = net.createConnection(socketPath);
    let buffer = '';
    let settled = false;

    const timeout = setTimeout(() => {
      if (!settled) {
        settled = true;
        socket.destroy();
        reject(new Error(`Connection timed out connecting to engine socket at ${socketPath}`));
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
        reject(
          new Error(`Failed to connect to orch engine at ${socketPath}: ${err.message}`, {
            cause: err,
          }),
        );
      }
    };

    const onClose = (): void => {
      if (!settled) {
        settled = true;
        cleanup();
        reject(new Error(`Connection closed before authentication completed with ${socketPath}`));
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
          resolve(new SocketClientTransport(socket, remaining));
          return;
        }
      } catch {
        // Fall through
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
          params: { token },
        }) + '\n',
        'utf8',
      );
    });
  });
}
