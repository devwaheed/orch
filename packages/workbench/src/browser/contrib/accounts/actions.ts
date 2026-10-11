/**
 * Actions the Accounts screen runs. Each calls the typed core services, never throws,
 * and writes its result into the area stores or the shared accounts store.
 */
import type { AccountId, AgentId, OrchError, RoutingRule } from '@orch/contracts';
import type { CoreServices } from '../../services/channelSchemas.js';
import { loadAccounts } from '../../services/stores/bootstrap.js';
import { useAccountsUiStore } from './stores/accountsUi.js';
import { parseFieldErrors } from './configFile.js';

function notify(error: OrchError): void {
  useAccountsUiStore.getState().setNotice(error);
}

/** Reads accounts.yaml from the core (getConfig) into the area store. */
export async function refreshConfig(services: CoreServices): Promise<void> {
  const result = await services.accounts.getConfig();
  if (!result.ok) {
    notify(result.error);
    return;
  }
  useAccountsUiStore.getState().setServerConfig(result.value.text, result.value.parsed);
}

/** Loads agents, accounts and the config file, and the OS from a light doctor run. */
export async function refreshAll(services: CoreServices): Promise<void> {
  const accountsError = await loadAccounts(services);
  if (accountsError) notify(accountsError);
  await refreshConfig(services);
  const doctor = await services.doctor.run();
  if (doctor.ok) useAccountsUiStore.getState().setOs(doctor.value.os);
}

export async function setUse(services: CoreServices, accountId: AccountId, use: boolean): Promise<void> {
  const result = await services.accounts.setUse(accountId, use);
  if (!result.ok) return notify(result.error);
  await refreshConfig(services);
}

export async function setPrimary(services: CoreServices, accountId: AccountId): Promise<void> {
  const result = await services.accounts.setPrimary(accountId);
  if (!result.ok) return notify(result.error);
  await refreshConfig(services);
}

export async function setRouting(services: CoreServices, rule: RoutingRule): Promise<void> {
  const result = await services.accounts.setRouting(rule);
  if (!result.ok) return notify(result.error);
  await refreshConfig(services);
}

export async function setShareSkills(services: CoreServices, agent: AgentId, share: boolean): Promise<void> {
  const result = await services.accounts.setShareSkills(agent, share);
  if (!result.ok) return notify(result.error);
  await refreshConfig(services);
}

/** Runs the agent's own sign-in for an account, then returns the three checks' result. */
export async function signIn(services: CoreServices, accountId: AccountId): Promise<void> {
  useAccountsUiStore.getState().patchAdd({ busy: true, error: null });
  const result = await services.accounts.signIn(accountId);
  if (!result.ok) {
    useAccountsUiStore.getState().patchAdd({ busy: false, error: result.error });
    return;
  }
  useAccountsUiStore.getState().patchAdd({ busy: false, signIn: result.value });
  await loadAccounts(services);
}

/** "Sign in" / "Re-login" on an account row. */
export async function signInRow(services: CoreServices, accountId: AccountId): Promise<void> {
  const result = await services.accounts.signIn(accountId);
  if (!result.ok) return notify(result.error);
  await loadAccounts(services);
}

/**
 * Moves from Name to Sign in. The profile folder is created here, because sign-in needs an
 * account id (the contract's add() creates the folder and does not sign in).
 */
export async function addProfile(services: CoreServices): Promise<void> {
  const { agent, name, account } = useAccountsUiStore.getState().add;
  if (!agent) return;
  if (account && account.name === name) {
    useAccountsUiStore.getState().patchAdd({ step: 3, error: null });
    return;
  }
  useAccountsUiStore.getState().patchAdd({ busy: true, error: null });
  const result = await services.accounts.add({ agent, name });
  if (!result.ok) {
    useAccountsUiStore.getState().patchAdd({ busy: false, error: result.error });
    return;
  }
  useAccountsUiStore.getState().patchAdd({ busy: false, account: result.value, step: 3 });
  await loadAccounts(services);
}

export async function finishAdd(services: CoreServices): Promise<void> {
  useAccountsUiStore.getState().resetAdd(false);
  await loadAccounts(services);
  await refreshConfig(services);
}

/** Machine check (orch doctor with two throwaway profiles per agent, ACC-03). */
export async function runMachineCheck(services: CoreServices): Promise<void> {
  useAccountsUiStore.getState().setMachine({ running: true });
  const report = await services.doctor.run({ signInTwice: true });
  if (report.ok) {
    useAccountsUiStore.getState().setMachine({ report: report.value, running: false });
    useAccountsUiStore.getState().setOs(report.value.os);
    await loadAccounts(services);
  } else {
    useAccountsUiStore.getState().setMachine({ running: false });
    notify(report.error);
  }
}

/** Saves the edited YAML. Field errors go to the editor; the draft stays until a save succeeds. */
export async function saveConfig(services: CoreServices, text: string): Promise<void> {
  const result = await services.accounts.setConfig(text);
  if (!result.ok) {
    useAccountsUiStore.getState().setConfigErrors(parseFieldErrors(result.error.details));
    notify(result.error);
    return;
  }
  useAccountsUiStore.getState().setConfigErrors([]);
  await refreshConfig(services);
  useAccountsUiStore.getState().markSaved(useAccountsUiStore.getState().configText, result.value);
  await loadAccounts(services);
}
