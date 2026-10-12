/**
 * Electron utility-process entry for the core host. Electron's parentPort is passed
 * in, so this file compiles without electron installed. The main process sends each
 * window (or the CLI bridge) a MessagePort in a message; every port is served by the
 * same services the headless entry serves (node/coreHostMain.ts).
 */
import type { MessagePortLike } from '@orchagents/platform/channels/common';
import type { EnginePort } from '@orchagents/platform/src/engine/common/engineClient.js';
import { startCoreHost, type CoreHostOptions, type RunningCoreHost } from '../node/coreHostMain.js';

/** The `type` of the message main sends with the engine utility's port (the port travels in `ports`). */
export const ENGINE_PORT_MESSAGE = 'orch.engine.port';

/** The part of Electron's parentPort this entry uses. */
export interface CoreParentPortLike {
  on(event: 'message', listener: (event: { readonly data: unknown; readonly ports: readonly MessagePortLike[] }) => void): void;
}

/**
 * Starts the core host in an Electron utility process. Main sends the engine
 * utility's port in a message tagged ENGINE_PORT_MESSAGE; the core host then uses
 * that engine instead of forking its own. Every other port is a window or CLI
 * connection to the core host.
 */
export async function startCoreUtility(parentPort: CoreParentPortLike, options: CoreHostOptions): Promise<RunningCoreHost> {
  const host = await startCoreHost({ ...options, awaitEnginePort: true });
  parentPort.on('message', (event) => {
    if (isEnginePortMessage(event.data) && event.ports[0]) {
      host.attachEnginePort(event.ports[0] as unknown as EnginePort);
      return;
    }
    for (const port of event.ports) host.attachPort(port);
  });
  return host;
}

function isEnginePortMessage(data: unknown): boolean {
  return typeof data === 'object' && data !== null && (data as { type?: unknown }).type === ENGINE_PORT_MESSAGE;
}
