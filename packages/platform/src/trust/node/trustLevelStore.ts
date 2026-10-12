/**
 * Levels on record, in the `trust_level` table (store/common/schema.ts, SEC-04).
 * This is the only file in the trust service that touches SQL; everything else
 * sees the ITrustLevelStore port.
 */
import { eq } from 'drizzle-orm';
import type { AgentId, Timestamp } from '@orchagents/contracts';
import type { TrustLevel } from '@orchagents/contracts';
import { trustLevelTable } from '../../store/common/schema.js';
import type { IStoreService } from '../../store/common/store.js';
import type { ITrustLevelStore } from '../common/ports.js';

/** The table's integer column holds a TrustLevel; anything else is read as no row. */
function asLevel(level: number | undefined): TrustLevel | undefined {
  return level === 1 || level === 2 || level === 3 ? level : undefined;
}

export class StoreTrustLevelStore implements ITrustLevelStore {
  constructor(private readonly store: IStoreService) {}

  levelOf(agent: AgentId): TrustLevel | undefined {
    const rows = this.store.db
      .select()
      .from(trustLevelTable)
      .where(eq(trustLevelTable.agent, agent))
      .all();
    return asLevel(rows[0]?.level);
  }

  putLevel(agent: AgentId, level: TrustLevel, changedAt: Timestamp): void {
    this.store.db
      .insert(trustLevelTable)
      .values({ agent, level, changedAt })
      .onConflictDoUpdate({ target: trustLevelTable.agent, set: { level, changedAt } })
      .run();
  }
}
