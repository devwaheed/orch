/** In-memory fakes for the trust service's ports. */
import type { AgentId, CorrectionLayer, Timestamp, TrustLevel } from '@orchagents/contracts';
import type {
  ITrustAgentsSource,
  ITrustCorrectionsSource,
  ITrustGardenerSource,
  ITrustLevelStore,
  ITrustRunHistory,
  TrustAgentInfo,
  TrustCorrectionRecord,
  TrustGardenerFinding,
  TrustGardenerState,
  TrustRunRecord,
} from '../common/ports.js';

/** The agents the Trust screen lists, in the prototype's order (design/prototype/Main.dc.html). */
export const TRUST_AGENTS: readonly TrustAgentInfo[] = [
  { agent: 'claude', displayName: 'Claude Code' },
  { agent: 'codex', displayName: 'Codex' },
  { agent: 'agy', displayName: 'Antigravity' },
  { agent: 'gemini', displayName: 'Gemini CLI' },
  { agent: 'opencode', displayName: 'OpenCode' },
];

export class ListTrustAgents implements ITrustAgentsSource {
  constructor(private readonly agents: readonly TrustAgentInfo[] = TRUST_AGENTS) {}
  list(): readonly TrustAgentInfo[] {
    return this.agents;
  }
}

export class MemoryRunHistory implements ITrustRunHistory {
  constructor(private records: TrustRunRecord[] = []) {}
  runs(): readonly TrustRunRecord[] {
    return this.records;
  }
  add(...records: TrustRunRecord[]): void {
    this.records.push(...records);
  }
  set(records: TrustRunRecord[]): void {
    this.records = [...records];
  }
}

export class MemoryCorrections implements ITrustCorrectionsSource {
  constructor(private records: TrustCorrectionRecord[] = []) {}
  corrections(): readonly TrustCorrectionRecord[] {
    return this.records;
  }
  set(records: TrustCorrectionRecord[]): void {
    this.records = [...records];
  }
}

export class MemoryTrustLevelStore implements ITrustLevelStore {
  private readonly rows = new Map<AgentId, { level: TrustLevel; changedAt: Timestamp }>();
  levelOf(agent: AgentId): TrustLevel | undefined {
    return this.rows.get(agent)?.level;
  }
  putLevel(agent: AgentId, level: TrustLevel, changedAt: Timestamp): void {
    this.rows.set(agent, { level, changedAt });
  }
  changedAtOf(agent: AgentId): Timestamp | undefined {
    return this.rows.get(agent)?.changedAt;
  }
}

export class MemoryGardener implements ITrustGardenerSource {
  private current: TrustGardenerState = { on: true, nextRunAt: '2026-10-12T09:00:00.000Z', findings: [] };
  state(): TrustGardenerState {
    return this.current;
  }
  setOn(on: boolean): void {
    this.current = { ...this.current, on };
  }
  set(patch: Partial<Omit<TrustGardenerState, 'findings'>> & { findings?: TrustGardenerFinding[] }): void {
    this.current = { ...this.current, ...patch };
  }
}

/** Builds one correction. */
export function correction(layer: CorrectionLayer, createdAt: Timestamp): TrustCorrectionRecord {
  return { layer, createdAt };
}
