/**
 * Public API of the Accounts area. Nothing outside this folder imports its internals.
 */
export { registerAccountsContribution } from './accounts.contribution.js';
export { bindAccountsServices } from './services.js';
export { useAccountsUiStore } from './stores/accountsUi.js';

