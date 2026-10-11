/**
 * Electron utility-process entry for the engine host (ADR 0006). Electron's
 * parentPort is passed in, so this file compiles without electron installed; the
 * app's main process wires the real parentPort when it starts the utility.
 * All logic is shared with the Node entry in ../node/engineHostMain.ts.
 */
import type { EnginePort } from '@orch/platform/src/engine/common/engineClient.js';
import { runEngineHost, type EngineAgentBins, type RunningEngineHost } from '../node/engineHostMain.js';

/** The part of Electron's parentPort this entry uses. */
export interface ParentPortLike {
  postMessage(message: unknown): void;
  on(event: 'message', listener: (event: { data: unknown }) => void): void;
}

export function portFromParentPort(parentPort: ParentPortLike): EnginePort {
  return {
    postMessage: (message) => parentPort.postMessage(message),
    on: (_event, listener) => {
      parentPort.on('message', (event) => listener(event));
      return undefined;
    },
  };
}

export async function startEngineUtility(
  parentPort: ParentPortLike,
  engineDir: string,
  claudeBin?: string,
  agentBins?: EngineAgentBins,
): Promise<RunningEngineHost> {
  return runEngineHost({
    engineDir,
    port: portFromParentPort(parentPort),
    ...(claudeBin ? { claudeBin } : {}),
    ...(agentBins ? { agentBins } : {}),
  });
}
