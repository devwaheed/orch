/**
 * Utility-process bootstrap for the core host (ADR 0006). Built to dist/core-host.cjs
 * and forked by the main process. It serves every port main hands it, then posts
 * the ready message that resets main's restart backoff.
 */
import { homedir } from 'node:os';
import { join } from 'node:path';
import type { MessagePortLike } from '@orch/platform/channels/common';
import { HOST_READY_MESSAGE } from '../node/hostReady.js';
import { startCoreUtility, type CoreParentPortLike } from './coreHost.js';

/** Electron exposes parentPort on process inside utility processes. Node's types don't list it. */
const parentPort = (process as unknown as { parentPort: CoreParentPortLike & { postMessage(message: unknown): void; start?(): void } })
  .parentPort;

const baseEnv = Object.fromEntries(
  Object.entries(process.env).filter((entry): entry is [string, string] => entry[1] !== undefined),
);

function toPortLike(port: MessagePortLike): MessagePortLike {
  port.start?.();
  return {
    postMessage: (message: unknown) => port.postMessage(message),
    on: (event: 'message', listener: (message: unknown) => void) => {
      port.start?.();
      const wrappedListener = (msg: unknown): void => {
        if (typeof msg === 'object' && msg !== null && 'data' in msg) {
          listener((msg as { data: unknown }).data);
        } else {
          listener(msg);
        }
      };
      if (typeof port.on === 'function') {
        port.on(event, wrappedListener);
      } else if (typeof port.addEventListener === 'function') {
        port.addEventListener(event, wrappedListener);
      }
      return undefined;
    },
    start: () => port.start?.(),
    close: () => port.close?.(),
  };
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
