/**
 * The typed core-service proxies the Work area calls (jobs, runs).
 *
 * Nothing in the workbench holds the data layer yet, so the area cannot reach the
 * core host on its own. Whoever connects the data layer (connectDataLayer) must pass
 * its services here once. Until then every command reports "not connected".
 */
import type { CoreServices } from '../../services/channelSchemas.js';

let bound: CoreServices | null = null;

export function bindWorkServices(services: CoreServices | null): void {
  bound = services;
}

export function getWorkServices(): CoreServices | null {
  return bound;
}
