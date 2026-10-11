/**
 * The core services this area calls. The shell binds them once after connecting the data
 * layer (see index.ts). Until then the screen shows no options and makes no calls.
 */
import type { CoreServices } from '../../services/channelSchemas.js';

let bound: CoreServices | null = null;

export function bindSessionsServices(services: CoreServices | null): void {
  bound = services;
}

export function sessionsServices(): CoreServices | null {
  return bound;
}
