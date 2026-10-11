/**
 * The trust service's id, so the core host can register it next to the others
 * (docs/architecture.md: a service is an interface, an id and one implementation).
 */
import { createServiceId } from '@orch/base';
import type { ITrustService } from '@orch/contracts';

export const ITrustServiceId = createServiceId<ITrustService>('trust');
