/**
 * Utility-process bootstrap for the engine host (ADR 0006, ENG-03). Built to
 * dist/engine-host.cjs. The engine data folder is ~/.orch/engine (ENG-03).
 */
import { join } from 'node:path';
import { homedir } from 'node:os';
import { HOST_READY_MESSAGE } from '../node/hostReady.js';
import { startEngineUtility, type ParentPortLike } from './engineHost.js';

const parentPort = (process as unknown as { parentPort: ParentPortLike & { postMessage(message: unknown): void } })
  .parentPort;

void (async () => {
  await startEngineUtility(parentPort, join(homedir(), '.orch', 'engine'));
  parentPort.postMessage(HOST_READY_MESSAGE);
})();
