/**
 * Public API of the Accounts area. Nothing outside this folder imports its internals.
 */
export { registerAccountsContribution } from './accounts.contribution.js';
export { bindAccountsServices } from './services.js';
export { useAccountsUiStore } from './stores/accountsUi.js';

import type { ConfigFieldError } from '@orch/contracts';
import { useAccountsUiStore as store } from './stores/accountsUi.js';

/**
 * Feeds config.invalid events into the screen: the field errors show in the config file view.
 * The data layer calls this for config.invalid (services/stores/apply.ts).
 */
export function applyConfigInvalid(errors: readonly ConfigFieldError[]): void {
  store.getState().setConfigErrors(errors);
}
