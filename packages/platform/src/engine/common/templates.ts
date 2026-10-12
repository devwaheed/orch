/**
 * Inputs for each engine workflow template (`workflow.start`). Plain TypeScript:
 * the engine host turns these into Claw workflow specs, and the core host sends
 * them in `input`. Agent names are the keys of `envByNode`.
 */
import { z } from 'zod';
import { AgentId } from '@orchagents/contracts';

export const AgentSpec = z.object({
  /** Unique within the workflow. Also the key for this agent's env in envByNode. */
  name: z.string().min(1),
  engine: AgentId.optional(),
  model: z.string().min(1).optional(),
  persona: z.string().min(1).optional(),
});
export type AgentSpec = z.infer<typeof AgentSpec>;

/** An acceptance contract is passed through to the engine as-is. */
const Contract = z.record(z.unknown());

export const SolveInput = z.object({
  task: z.string().min(1),
  cwd: z.string().min(1),
  contract: Contract.optional(),
  scouts: z.array(AgentSpec).min(1),
  implementer: z.object({ engine: AgentId.optional(), model: z.string().min(1).optional() }).optional(),
  reviewers: z.array(AgentSpec).optional(),
  humanGate: z.boolean().optional(),
  maxRepairs: z.number().int().min(0).optional(),
});
export type SolveInput = z.infer<typeof SolveInput>;

/** ADR 0011: compare runs use Claw's fanout across 2 to 5 agents. */
export const CompareInput = z.object({
  task: z.string().min(1),
  cwd: z.string().min(1),
  agents: z.array(AgentSpec).min(2).max(5),
});
export type CompareInput = z.infer<typeof CompareInput>;

export const CouncilInput = z.object({
  task: z.string().min(1),
  cwd: z.string().min(1),
  agents: z.array(AgentSpec).min(1),
  maxRounds: z.number().int().min(1).optional(),
  contract: Contract.optional(),
});
export type CouncilInput = z.infer<typeof CouncilInput>;

/**
 * Autoloop (JOB-08): Planner, Coder and Reviewer each run on their own account.
 * Claw has no role names in its input, so the host passes these to autoloopStart.
 */
export const AutoloopInput = z.object({
  cwd: z.string().min(1),
  /** The job goal, sent to the Planner as its first message. */
  goal: z.string().min(1),
  plannerEngine: AgentId,
  plannerModel: z.string().min(1).optional(),
  coderEngine: AgentId,
  coderModel: z.string().min(1).optional(),
  reviewerEngine: AgentId,
  reviewerModel: z.string().min(1).optional(),
});
export type AutoloopInput = z.infer<typeof AutoloopInput>;

/** The env key of the implementer in a solve workflow's envByNode. */
export const IMPLEMENT_NODE_KEY = 'implement';

/** Every agent name a template runs, so the host can require an env for each. */
export function agentKeysFor(template: 'solve' | 'compare' | 'council' | 'autoloop', input: unknown): string[] {
  if (template === 'autoloop') {
    AutoloopInput.parse(input);
    return ['planner', 'coder', 'reviewer'];
  }
  if (template === 'solve') {
    const solve = SolveInput.parse(input);
    return [
      ...solve.scouts.map((a) => a.name),
      IMPLEMENT_NODE_KEY,
      ...(solve.reviewers ?? []).map((a) => a.name),
    ];
  }
  if (template === 'compare') return CompareInput.parse(input).agents.map((a) => a.name);
  return CouncilInput.parse(input).agents.map((a) => a.name);
}
