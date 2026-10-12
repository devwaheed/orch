/**
 * The trust service's id, so the core host can register it next to the others
 * (docs/architecture.md: a service is an interface, an id and one implementation).
 */
import { createServiceId } from '@orchagents/base';
import type { ITrustService } from '@orchagents/contracts';

export const ITrustServiceId = createServiceId<ITrustService>('trust');
