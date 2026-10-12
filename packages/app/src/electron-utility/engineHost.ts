/**
 * Electron utility-process entry for the engine host (ADR 0006). Electron's
 * parentPort is passed in, so this file compiles without electron installed; the
 * app's main process wires the real parentPort when it starts the utility.
 * All logic is shared with the Node entry in ../node/engineHostMain.ts.
 */
import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import type { MessagePortLike } from '@orchagents/platform/channels/common';
import type { EnginePort } from '@orchagents/platform/src/engine/common/engineClient.js';
import { createEngineHost, serveEngine, type HomeEnv, type ServedEngine } from '@orchagents/platform/src/engine/node/index.js';
import type { EngineAgentBins } from '../node/argv.js';
import type { RunningEngineHost } from '../node/engineHostMain.js';

export const ENGINE_PORT_MESSAGE = 'orch.engine.port';

/** The part of Electron's parentPort this entry uses. */
export interface ParentPortLike {
  postMessage(message: unknown): void;
  on(
    event: 'message',
    listener: (event: { data: unknown; ports?: readonly MessagePortLike[] }) => void,
  ): void;
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

function extractPortData(msg: unknown): unknown {
  if (typeof msg === 'object' && msg !== null && 'data' in msg) {
    return (msg as { data: unknown }).data;
  }
  return msg;
}

export function toEnginePort(port: MessagePortLike | EnginePort): EnginePort {
  const p = port as MessagePortLike;
  p.start?.();
  return {
    postMessage: (message: unknown) => p.postMessage(message),
    on: (event: 'message', listener: (message: unknown) => void) => {
      p.start?.();
      const wrappedListener = (msg: unknown): void => {
        listener(extractPortData(msg));
      };
      if (typeof p.on === 'function') {
        p.on(event, wrappedListener);
      } else if (typeof p.addEventListener === 'function') {
        p.addEventListener(event, wrappedListener);
      }
      return undefined;
    },
  };
}

function isEnginePortMessage(data: unknown): boolean {
  return typeof data === 'object' && data !== null && (data as { type?: unknown }).type === ENGINE_PORT_MESSAGE;
}

export async function startEngineUtility(
  parentPort: ParentPortLike,
  engineDir: string,
  claudeBin?: string,
  agentBins?: EngineAgentBins,
): Promise<RunningEngineHost> {
  (parentPort as { start?(): void }).start?.();
  const resolvedEngineDir = path.resolve(engineDir);
  const engineHome = path.join(resolvedEngineDir, 'home');

  // The user's real home, read before the host redirects it (ADR 0011).
  const realHome: HomeEnv = {
    ...(process.env.HOME !== undefined ? { HOME: process.env.HOME } : {}),
    ...(process.env.USERPROFILE !== undefined ? { USERPROFILE: process.env.USERPROFILE } : {}),
  };

  await mkdir(engineHome, { recursive: true, mode: 0o700 });
  process.env.HOME = engineHome;
  process.env.USERPROFILE = engineHome;
  process.env.CLAWO_NO_EMBEDDED_SERVER = '1';
  process.env.CLAWO_WF_DIR = path.join(resolvedEngineDir, 'wf');
  process.env.CLAWO_RUNS_DIR = path.join(resolvedEngineDir, 'runs');

  const host = await createEngineHost({
    engineDir: resolvedEngineDir,
    realHome,
    ...(claudeBin ? { claudeBin } : {}),
    ...(agentBins ? { agentBins: { ...agentBins } } : {}),
  });

  let currentServed: ServedEngine | null = null;

  parentPort.on('message', (event) => {
    const port = event.ports?.[0];
    if (port && (isEnginePortMessage(event.data) || !event.data)) {
      currentServed?.close();
      currentServed = serveEngine(host, toEnginePort(port));
    }
  });

  return {
    async stop() {
      currentServed?.close();
      currentServed = null;
      await host.dispose();
    },
  };
}
