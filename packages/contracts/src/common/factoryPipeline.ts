import { z } from 'zod';
import { AgentId, JobId } from './ids.js';

export const PipelineStage = z.object({
  id: z.string(), title: z.string(), group: z.enum(['planning', 'design', 'build']),
  state: z.enum(['done', 'have', 'skipped', 'next', 'needs_you', 'queued']),
  gate: z.boolean().optional(), question: z.string().optional(), show: z.array(z.string()).optional(),
  skill: z.string().optional(), out: z.array(z.string()).optional(), goal: z.string().optional(),
  answer: z.object({ words: z.string(), by: z.literal('operator'), via: z.string(), at: z.string() }).nullable(),
});
export type PipelineStage = z.infer<typeof PipelineStage>;

export const Counts = z.object({ total: z.number().int(), done: z.number().int(), next: z.number().int(),
  needs_you: z.number().int(), left: z.number().int(), gates_ahead: z.number().int() });
export type Counts = z.infer<typeof Counts>;

export const FactoryPipeline = z.object({
  product: z.string(), stages: z.array(PipelineStage), counts: Counts,
  groups: z.record(z.enum(['planning', 'design', 'build']), Counts),
  now: PipelineStage.nullable(),
});
export type FactoryPipeline = z.infer<typeof FactoryPipeline>;

export const TrailRow = z.object({
  time: z.string(), stage: z.string(), kind: z.string(), by: z.enum(['operator', 'agent']), summary: z.string(), evidence: z.array(z.string()),
});
export type TrailRow = z.infer<typeof TrailRow>;

export const TrailResult = z.object({ rows: z.array(TrailRow), unreadable: z.number().int() });
export type TrailResult = z.infer<typeof TrailResult>;

export const InitAnswers = z.object({
  brief: z.string(),
  have: z.object({
    research: z.union([z.enum(['generate', 'skip']), z.object({ path: z.string() })]).optional(),
    value_map: z.union([z.enum(['generate', 'skip']), z.object({ path: z.string() })]).optional(),
    prd: z.union([z.enum(['generate', 'skip']), z.object({ path: z.string() })]).optional(),
    architecture: z.union([z.enum(['generate', 'skip']), z.object({ path: z.string() })]).optional(),
  }),
  surfaces: z.array(z.enum(['web', 'console'])),
  scope: z.enum(['design', 'build', 'full']),
  specs: z.enum(['one-by-one', 'parallel', 'manual']),
  agent: z.union([AgentId, z.literal('auto')]),
});
export type InitAnswers = z.infer<typeof InitAnswers>;
/** Retained name used by the existing factory setup methods. */
export const FactoryAnswers = InitAnswers;
export type FactoryAnswers = InitAnswers;

export const PipelineRunState = z.object({
  jobId: JobId,
  state: z.enum(['working', 'paused', 'waiting_gate', 'waiting_build', 'stopped', 'done']),
  stage: z.string().nullable(),
  reason: z.string().nullable(),
});
export type PipelineRunState = z.infer<typeof PipelineRunState>;
