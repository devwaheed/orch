/**
 * Registers the Accounts area: its route and the "Add an account" palette command.
 * The activity bar item for Accounts is already provided by the shell (PRD-06).
 */
import { workbenchRegistry } from '../../services/registry.js';
import { useWorkbenchStore } from '../../services/workbenchStore.js';
import type { IDisposable } from '@orch/base';
import { AccountsScreen } from './components/AccountsScreen.js';
import { useAccountsUiStore } from './stores/accountsUi.js';
import { accountsStrings as S } from './strings.js';

export function registerAccountsContribution(): IDisposable[] {
  const route = workbenchRegistry.registerRoute({
    id: 'accounts',
    path: '/accounts',
    title: S.title,
    component: AccountsScreen,
  });
  const command = workbenchRegistry.registerCommand({
    id: 'accounts.add',
    title: S.contribution.paletteAddAccount,
    icon: 'plus',
    order: 9,
    action: () => {
      useWorkbenchStore.getState().setActiveRoute('/accounts');
      useAccountsUiStore.getState().resetAdd(true);
    },
  });
  return [route, command];
}
