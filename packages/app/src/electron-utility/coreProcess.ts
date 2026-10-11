/**
 * Utility-process bootstrap for the core host (ADR 0006). Built to dist/core-host.cjs
 * and forked by the main process. It serves every port main hands it, then posts
 * the ready message that resets main's restart backoff.
 */
import { homedir } from 'node:os';
import { HOST_READY_MESSAGE } from '../node/hostReady.js';
import { startCoreUtility, type CoreParentPortLike } from './coreHost.js';

/** Electron exposes parentPort on process inside utility processes. Node's types don't list it. */
const parentPort = (process as unknown as { parentPort: CoreParentPortLike & { postMessage(message: unknown): void } })
  .parentPort;

const baseEnv = Object.fromEntries(
  Object.entries(process.env).filter((entry): entry is [string, string] => entry[1] !== undefined),
);

void (async () => {
  await startCoreUtility(parentPort, { home: homedir(), baseEnv });
  parentPort.postMessage(HOST_READY_MESSAGE);
})();
