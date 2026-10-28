/**
 * Actions the Accounts screen runs. Each calls the typed core services, never throws,
 * and writes its result into the area stores or the shared accounts store.
 */
import type { Account, AccountId, AgentId, OrchError, RoutingRule } from '@orchagents/contracts';
import type { CoreServices } from '../../services/channelSchemas.js';
import { loadAccounts } from '../../services/stores/bootstrap.js';
import { useConfigErrorsStore } from '../../services/stores/config.js';
import { useAccountsUiStore } from './stores/accountsUi.js';
import { parseFieldErrors } from './configFile.js';
import { getOrchBridge } from '../../services/orchClient.js';
import { suggestName } from './addAccount.js';

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

/** Loads agents, accounts and the config file, and the OS (from the app at once, then the doctor run). */
export async function refreshAll(services: CoreServices): Promise<void> {
  // The doctor takes seconds; until it answers, Add account would have no agents to offer.
  const appOs = window.orch?.app.os;
  if (appOs) useAccountsUiStore.getState().setOs(appOs);
  const accountsError = await loadAccounts(services);
  if (accountsError) notify(accountsError);
  await refreshConfig(services);
  const doctor = await services.doctor.run();
  if (doctor.ok) {
    useAccountsUiStore.getState().setOs(doctor.value.os);
    useAccountsUiStore.getState().setMachine({ report: doctor.value });
  }
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

/** Sign-in terminal size until the dialog's view measures itself and resizes it. */
const SIGN_IN_COLS = 100;
const SIGN_IN_ROWS = 32;

/**
 * Sign in: creates the account the first time (agent, name, type), then starts the agent's own
 * sign-in in a terminal the dialog shows.
 */
export async function startSignIn(services: CoreServices): Promise<void> {
  const addState = useAccountsUiStore.getState().add;
  const { agent } = addState;
  if (!agent) return;
  useAccountsUiStore.getState().patchAdd({ busy: true, error: null, signIn: null });
  const account = await ensureAddedAccount(services);
  if (!account) return;
  const opened = await services.accounts.openSignIn(account.id, SIGN_IN_COLS, SIGN_IN_ROWS);
  if (!opened.ok) {
    useAccountsUiStore.getState().patchAdd({ busy: false, phase: 'form', error: opened.error });
    return;
  }
  useAccountsUiStore.getState().patchAdd({ busy: false, phase: 'signing', shellId: opened.value });
}

/** Adds a new account once and records it in the dialog for both add flows. */
async function ensureAddedAccount(services: CoreServices): Promise<Account | null> {
  const state = useAccountsUiStore.getState().add;
  if (state.account) return state.account;
  if (!state.agent) return null;
  const trimmedType = state.type.trim();
  const added = await services.accounts.add({
    agent: state.agent,
    name: state.name.trim(),
    ...(trimmedType ? { type: trimmedType } : {}),
  });
  if (!added.ok) {
    useAccountsUiStore.getState().patchAdd({ busy: false, error: added.error });
    return null;
  }
  useAccountsUiStore.getState().patchAdd({ account: added.value, created: true });
  await loadAccounts(services);
  return added.value;
}

/** Creates an OpenCode account without starting a provider login terminal. */
export async function addWithoutSignIn(services: CoreServices): Promise<void> {
  const { agent } = useAccountsUiStore.getState().add;
  if (agent !== 'opencode') return;
  useAccountsUiStore.getState().patchAdd({ busy: true, error: null, signIn: null });
  const account = await ensureAddedAccount(services);
  if (!account) return;
  useAccountsUiStore.getState().patchAdd({ phase: 'checking' });
  const result = await services.accounts.checkSignIn(account.id, false);
  if (!result.ok) {
    useAccountsUiStore.getState().patchAdd({ phase: 'form', busy: false, error: result.error });
    return;
  }
  useAccountsUiStore.getState().patchAdd({ phase: 'result', busy: false, signIn: result.value });
  await loadAccounts(services);
}

/**
 * After the sign-in terminal ends (or "I’m signed in" for an agent that stays open, which
 * closes it): runs the three checks.
 */
export async function finishSignIn(services: CoreServices, closeShell: boolean): Promise<void> {
  const { account, shellId, phase } = useAccountsUiStore.getState().add;
  if (!account || phase !== 'signing') return;
  useAccountsUiStore.getState().patchAdd({ phase: 'checking', busy: true });
  if (closeShell && shellId) await services.shells.close(shellId);
  const result = await services.accounts.checkSignIn(account.id, closeShell);
  if (!result.ok) {
    useAccountsUiStore.getState().patchAdd({ phase: 'form', busy: false, shellId: null, error: result.error });
    return;
  }
  useAccountsUiStore.getState().patchAdd({ phase: 'result', busy: false, shellId: null, signIn: result.value });
  await loadAccounts(services);
}

/** Closes the dialog. An account this dialog created that is not ready is removed again. */
export async function cancelAdd(services: CoreServices): Promise<void> {
  const { account, created, shellId, signIn } = useAccountsUiStore.getState().add;
  useAccountsUiStore.getState().resetAdd(false);
  if (shellId) await services.shells.close(shellId);
  if (account && created && !signIn?.ready) await services.accounts.remove(account.id);
  await loadAccounts(services);
  await refreshConfig(services);
}

/** "Sign in" / "Re-login" on an account row: the same dialog, for that account. */
export function openSignInFor(account: Account): void {
  useAccountsUiStore.getState().resetAdd(true);
  useAccountsUiStore.getState().patchAdd({ agent: account.agent, name: account.name, type: account.type ?? '', account });
}

/** Opens the add dialog with the section's agent and its next suggested account name. */
export function openAddFor(agent: AgentId, accounts: readonly Account[]): void {
  useAccountsUiStore.getState().resetAdd(true);
  useAccountsUiStore.getState().patchAdd({ agent, name: suggestName(accounts, agent), agentFixed: true });
}

export async function finishAdd(services: CoreServices): Promise<void> {
  useAccountsUiStore.getState().resetAdd(false);
  await loadAccounts(services);
  await refreshConfig(services);
}

/** Removes the confirmed account and refreshes the account list and generated config. */
export async function removeAccount(services: CoreServices, accountId: AccountId): Promise<void> {
  useAccountsUiStore.getState().setRemoving(null);
  const result = await services.accounts.remove(accountId);
  if (!result.ok) return notify(result.error);
  const accountsError = await loadAccounts(services);
  if (accountsError) notify(accountsError);
  await refreshConfig(services);
}

/** Machine check (orch doctor with two throwaway profiles per agent, ACC-03). */
export async function runMachineCheck(services: CoreServices): Promise<void> {
  useAccountsUiStore.getState().setMachine({ running: true });
  const report = await services.doctor.run({ signInTwice: true });
  if (report.ok) {
    const cliOnPath = report.value.checks.find((check) => check.id === 'cli_on_path')?.status === 'pass';
    void getOrchBridge().app.cliCommand.machineCheckFinished(cliOnPath);
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
    useConfigErrorsStore.getState().setErrors(parseFieldErrors(result.error.details));
    notify(result.error);
    return;
  }
  useConfigErrorsStore.getState().setErrors([]);
  await refreshConfig(services);
  useAccountsUiStore.getState().markSaved(useAccountsUiStore.getState().configText, result.value);
  await loadAccounts(services);
}
