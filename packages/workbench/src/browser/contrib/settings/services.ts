/**
 * The core services this area calls. Bound once by the shell after connecting
 * the data layer.
 */
import type { CoreServices } from '../../services/channelSchemas.js';

let bound: CoreServices | null = null;

export function bindSettingsServices(services: CoreServices | null): void {
  bound = services;
}

export function settingsServices(): CoreServices | null {
  return bound;
}
