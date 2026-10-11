/**
 * Starts one utility-process host (ADR 0006). Electron's utilityProcess is the
 * only place in the main process that forks a host. The host entry is a bundled
 * .cjs file in the build output.
 */
import { utilityProcess, type UtilityProcess } from 'electron';
import { isHostReadyMessage } from '../node/hostReady.js';
import type { ManagedProcess } from './hosts.js';

export function forkUtilityHost(name: string, entryPath: string, args: readonly string[]): ManagedProcess {
  const child: UtilityProcess = utilityProcess.fork(entryPath, [...args], { serviceName: `orch-${name}` });
  const readyListeners: Array<() => void> = [];
  const exitListeners: Array<(reason: string) => void> = [];

  child.on('message', (message: unknown) => {
    if (isHostReadyMessage(message)) for (const listener of readyListeners) listener();
  });
  child.on('exit', (code: number) => {
    for (const listener of exitListeners) listener(`exit ${code}`);
  });

  return {
    onReady: (listener) => readyListeners.push(listener),
    onExit: (listener) => exitListeners.push(listener),
    post: (message, ports) => child.postMessage(message, [...ports]),
    stop: () => {
      child.kill();
    },
  };
}
