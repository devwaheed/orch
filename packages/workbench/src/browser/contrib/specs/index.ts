/**
 * Public API of the Specs area. Nothing outside this folder imports its internals.
 */
export { registerSpecsContribution } from './specs.contribution.js';
export { bindSpecsServices } from './services.js';
export { openSpecsLive, openSpecInQueue, watchSpecLive } from './actions.js';
export { specStatus } from './specsView.js';
