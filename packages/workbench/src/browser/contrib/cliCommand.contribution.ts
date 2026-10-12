import type { IDisposable } from '@orchagents/base';
import { workbenchRegistry } from '../services/registry.js';
import { getOrchBridge } from '../services/orchClient.js';

export function registerCliCommandContribution(): IDisposable[] {
  if (!getOrchBridge().app.cliCommand.offered) return [];
  const install = workbenchRegistry.registerCommand({
    id: 'cli.install', title: 'Install orch command', icon: 'plus', order: 30,
    action: () => getOrchBridge().app.cliCommand.install(),
  });
  const uninstall = workbenchRegistry.registerCommand({
    id: 'cli.uninstall', title: 'Uninstall orch command', icon: 'close', order: 31,
    action: () => getOrchBridge().app.cliCommand.uninstall(),
  });
  return [install, uninstall];
}
