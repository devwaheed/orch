import { z } from 'zod';
import { AccountId, AgentId, Timestamp } from './ids.js';

export const QuotaWindowKind = z.enum(['per_minute', '5h', 'daily', 'weekly', 'monthly']);
export type QuotaWindowKind = z.infer<typeof QuotaWindowKind>;

export const QuotaWindow = z.object({
  accountId: AccountId,
  window: QuotaWindowKind,
  usedPct: z.number().min(0).max(100),
  resetsAt: Timestamp.nullable(),
  /** reported = from the agent itself; estimated = counted by orch */
  source: z.enum(['reported', 'estimated']),
  seenAt: Timestamp,
});
export type QuotaWindow = z.infer<typeof QuotaWindow>;

/** A single raw signal parsed by an adapter from agent output or errors. */
export const QuotaObservation = z.object({
  accountId: AccountId,
  window: QuotaWindowKind.optional(),
  usedPct: z.number().min(0).max(100).optional(),
  limited: z.boolean(),
  resetsAt: Timestamp.nullable(),
  source: z.enum(['reported', 'estimated']),
  raw: z.string().max(500).optional(),
});
export type QuotaObservation = z.infer<typeof QuotaObservation>;

export const PickAccountResult = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('account'), accountId: AccountId }),
  /** No account has room; earliest reset among usable accounts */
  z.object({ kind: z.literal('wait'), until: Timestamp.nullable(), agent: AgentId }),
  z.object({ kind: z.literal('none'), agent: AgentId, reason: z.string() }),
]);
export type PickAccountResult = z.infer<typeof PickAccountResult>;

export const SpendToday = z.object({ usd: z.number().nonnegative(), fromApiKeysOnly: z.boolean() });
export type SpendToday = z.infer<typeof SpendToday>;
