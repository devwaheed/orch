/**
 * Electron utility-process entry for the core host. Electron's parentPort is passed
 * in, so this file compiles without electron installed. The main process sends each
 * window (or the CLI bridge) a MessagePort in a message; every port is served by the
 * same services the headless entry serves (node/coreHostMain.ts).
 */
import type { MessagePortLike } from '@orch/platform/channels/common';
import { startCoreHost, type CoreHostOptions, type RunningCoreHost } from '../node/coreHostMain.js';

/** The part of Electron's parentPort this entry uses. */
export interface CoreParentPortLike {
  on(event: 'message', listener: (event: { readonly data: unknown; readonly ports: readonly MessagePortLike[] }) => void): void;
}

export async function startCoreUtility(parentPort: CoreParentPortLike, options: CoreHostOptions): Promise<RunningCoreHost> {
  const host = await startCoreHost(options);
  parentPort.on('message', (event) => {
    for (const port of event.ports) host.attachPort(port);
  });
  return host;
}
