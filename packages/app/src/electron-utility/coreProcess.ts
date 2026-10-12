/**
 * Utility-process bootstrap for the core host (ADR 0006). Built to dist/core-host.cjs
 * and forked by the main process. It serves every port main hands it, then posts
 * the ready message that resets main's restart backoff.
 */
import { homedir } from 'node:os';
import { join } from 'node:path';
import type { MessagePortLike } from '@orchagents/platform/channels/common';
import { HOST_READY_MESSAGE } from '../node/hostReady.js';
import { startCoreUtility, type CoreParentPortLike } from './coreHost.js';

/** Electron exposes parentPort on process inside utility processes. Node's types don't list it. */
const parentPort = (process as unknown as { parentPort: CoreParentPortLike & { postMessage(message: unknown): void; start?(): void } })
  .parentPort;

const baseEnv = Object.fromEntries(
  Object.entries(process.env).filter((entry): entry is [string, string] => entry[1] !== undefined),
);

class PortLikeWrapper implements MessagePortLike {
  constructor(private readonly port: MessagePortLike) {
    this.port.start?.();
  }

  postMessage(message: unknown): void {
    this.port.postMessage(message);
  }

  start(): void {
    this.port.start?.();
  }

  close(): void {
    this.port.close?.();
  }

  on(event: 'message', listener: (arg: unknown) => void): unknown;
  on(event: 'close', listener: () => void): unknown;
  on(event: 'message' | 'close', listener: ((arg: unknown) => void) | (() => void)): unknown {
    if (event === 'close') {
      const closeListener = listener as () => void;
      if (typeof this.port.on === 'function') {
        return this.port.on('close', closeListener);
      }
      if (typeof this.port.addEventListener === 'function') {
        this.port.addEventListener('close', closeListener);
      }
      return undefined;
    }
    this.port.start?.();
    const msgListener = listener as (arg: unknown) => void;
    const wrappedListener = (msg: unknown): void => {
      if (typeof msg === 'object' && msg !== null && 'data' in msg) {
        msgListener((msg as { data: unknown }).data);
      } else {
        msgListener(msg);
      }
    };
    if (typeof this.port.on === 'function') {
      return this.port.on(event, wrappedListener);
    }
    if (typeof this.port.addEventListener === 'function') {
      this.port.addEventListener(event, wrappedListener);
    }
    return undefined;
  }
}

function toPortLike(port: MessagePortLike): MessagePortLike {
  return new PortLikeWrapper(port);
}

parentPort.start?.();
const wrappedParentPort: CoreParentPortLike & { postMessage(message: unknown): void } = {
  postMessage: (message: unknown) => parentPort.postMessage(message),
  on: (event: 'message', listener: (e: { readonly data: unknown; readonly ports: readonly MessagePortLike[] }) => void) => {
    parentPort.on(event, (e) => {
      const ports = (e.ports ?? []).map(toPortLike);
      listener({ data: e.data, ports });
    });
  },
};

void (async () => {
  await startCoreUtility(wrappedParentPort, {
    home: homedir(),
    baseEnv,
    pty: {
      entry: join(__dirname, 'pty-host.cjs'),
      args: [],
    },
  });
  parentPort.postMessage(HOST_READY_MESSAGE);
})();
