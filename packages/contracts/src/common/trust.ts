import { z } from 'zod';
import { AgentId, Timestamp } from './ids.js';
import { CorrectionLayer } from './review.js';

/** 1 review everything · 2 auto-repair · 3 auto-merge low-risk */
export const TrustLevel = z.union([z.literal(1), z.literal(2), z.literal(3)]);
export type TrustLevel = z.infer<typeof TrustLevel>;

/** First-try verified rate needed to qualify for a level. Changing these is a design decision. */
export const TRUST_THRESHOLDS: Readonly<Record<2 | 3, number>> = { 2: 70, 3: 85 };

export const AgentTrack = z.object({
  agent: AgentId,
  runs: z.number().int().nonnegative(),
  firstTryVerifiedPct: z.number().min(0).max(100),
  humanFixPct: z.number().min(0).max(100),
  level: TrustLevel,
  /** Present when the agent qualifies for the next level; promotion is always manual */
  eligibleFor: TrustLevel.nullable(),
});
export type AgentTrack = z.infer<typeof AgentTrack>;

export const TrustSummary = z.object({
  periodDays: z.union([z.literal(7), z.literal(30)]),
  firstTryVerifiedPct: z.number(),
  humanFixPct: z.number(),
  refutedCount: z.number().int(),
  correctionsMovedUp: z.object({ moved: z.number().int(), total: z.number().int() }),
  correctionsByLayer: z.record(CorrectionLayer, z.number().int()),
  agents: z.array(AgentTrack),
  gardener: z.object({ on: z.boolean(), nextRunAt: Timestamp.nullable(), findings: z.array(z.object({ text: z.string(), at: Timestamp })) }),
});
export type TrustSummary = z.infer<typeof TrustSummary>;
