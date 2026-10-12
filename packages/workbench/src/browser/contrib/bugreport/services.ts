/**
 * The core services bugreport area calls.
 */
import type { CoreServices } from '../../services/channelSchemas.js';

let bound: CoreServices | null = null;

export function bindBugReportServices(services: CoreServices | null): void {
  bound = services;
}

export function bugReportServices(): CoreServices | null {
  return bound;
}
