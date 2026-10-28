import type { RoutingRule } from '@orchagents/contracts';
import type { CoreServices } from '../../services/channelSchemas.js';
import { useSettingsUiStore } from './stores/settingsUi.js';

export function getAccountsFilePath(): string {
  const home = typeof window !== 'undefined' ? window.orch?.app.home : undefined;
  return home ? `${home}/.orch/accounts.yaml` : '~/.orch/accounts.yaml';
}

export function getLogsDirPath(): string {
  const home = typeof window !== 'undefined' ? window.orch?.app.home : undefined;
  return home ? `${home}/.orch/logs` : '~/.orch/logs';
}

export async function refreshConfig(services: CoreServices): Promise<void> {
  const result = await services.accounts.getConfig();
  if (result.ok) {
    useSettingsUiStore.getState().setFile(result.value.parsed);
  }
}

export async function setRouting(services: CoreServices, rule: RoutingRule): Promise<void> {
  const result = await services.accounts.setRouting(rule);
  if (result.ok) {
    await refreshConfig(services);
  }
}

export async function runChecks(services: CoreServices): Promise<void> {
  useSettingsUiStore.getState().setRunningChecks(true);
  try {
    const result = await services.doctor.run();
    if (result.ok) {
      useSettingsUiStore.getState().setDoctorReport(result.value);
    }
  } finally {
    useSettingsUiStore.getState().setRunningChecks(false);
  }
}

export async function installCli(services: CoreServices): Promise<void> {
  useSettingsUiStore.getState().setInstallingCli(true);
  try {
    if (typeof window !== 'undefined' && window.orch?.app.cliCommand.install) {
      await window.orch.app.cliCommand.install();
    }
    const result = await services.doctor.run();
    if (result.ok) {
      useSettingsUiStore.getState().setDoctorReport(result.value);
    }
  } finally {
    useSettingsUiStore.getState().setInstallingCli(false);
  }
}

export async function restartEngine(): Promise<void> {
  if (typeof window !== 'undefined' && window.orch?.app.restartEngine) {
    await window.orch.app.restartEngine();
  }
}

export async function showItemInFolder(path: string): Promise<void> {
  if (typeof window !== 'undefined' && window.orch?.app.showItemInFolder) {
    await window.orch.app.showItemInFolder(path);
  }
}
