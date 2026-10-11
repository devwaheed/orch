/**
 * The core services this area calls. The shell binds them once after connecting the data
 * layer (see index.ts). Until then the screen shows no data and makes no calls.
 */
import type { CoreServices } from '../../services/channelSchemas.js';

let bound: CoreServices | null = null;

export function bindAccountsServices(services: CoreServices | null): void {
  bound = services;
}

export function accountsServices(): CoreServices | null {
  return bound;
}
