/**
 * The typed core services this area calls (jobs.start, jobs.toCommand, quota.pickAccount).
 * The data layer hands them over once it is connected; until then the area
 * shows no CLI line and Start does nothing.
 */
import type { CoreServices } from '../../services/channelSchemas.js';

export type NewJobServices = Pick<CoreServices, 'jobs' | 'quota'>;

let current: NewJobServices | null = null;

export function setNewJobServices(services: NewJobServices | null): void {
  current = services;
}

export function getNewJobServices(): NewJobServices | null {
  return current;
}
