/**
 * Protocol between the core host and the engine host (the utility process that
 * runs Claw as a library). Messages travel over an Electron MessagePort or a
 * Node child-process channel and are validated with these schemas on BOTH ends.
 * Nothing outside packages/platform/src/engine may use this protocol.
 */
import { z } from 'zod';
import { AgentId } from './ids.js';

/**
 * The only environment variables orch may pass to a Claw session (`session_start({ env })`).
 * HOME/USERPROFILE are allowed only for agents whose adapter needs a separate home folder.
 */
export const ENGINE_ENV_ALLOWLIST = [
  'CLAUDE_CONFIG_DIR',
  'CODEX_HOME',
  'GEMINI_CLI_HOME',
  'XDG_DATA_HOME',
  'OPENCODE_CONFIG_DIR',
  'HOME',
  'USERPROFILE',
] as const;
export const EngineEnv = z
  .record(z.enum(ENGINE_ENV_ALLOWLIST), z.string().min(1))
  .refine((env) => Object.keys(env).length > 0, 'env must set at least one account variable');
export type EngineEnv = z.infer<typeof EngineEnv>;

/** Engine-side handle for a session or workflow. Opaque to everything above the engine package. */
const Handle = z.string().min(1);

export const EngineRequest = z.discriminatedUnion('op', [
  z.object({ op: z.literal('health.ping') }),
  z.object({
    op: z.literal('session.start'),
    agent: AgentId,
    cwd: z.string(),
    env: EngineEnv,
    model: z.string().optional(),
    readOnly: z.boolean(),
    maxBudgetUsd: z.number().positive().optional(),
  }),
  z.object({ op: z.literal('session.send'), session: Handle, text: z.string().min(1) }),
  z.object({ op: z.literal('session.stop'), session: Handle }),
  z.object({ op: z.literal('session.resume'), session: Handle, env: EngineEnv }),
  z.object({ op: z.literal('session.handoff'), from: Handle, toAgent: AgentId, env: EngineEnv, cwd: z.string() }),
  z.object({
    op: z.literal('workflow.start'),
    template: z.enum(['solve', 'compare', 'council', 'autoloop']),
    input: z.record(z.unknown()),
    /** Per-node env so each node runs on the account the router chose */
    envByNode: z.record(EngineEnv).optional(),
  }),
  z.object({ op: z.literal('workflow.status'), workflow: Handle }),
  z.object({ op: z.literal('workflow.resume'), workflow: Handle }),
  z.object({ op: z.literal('workflow.cancel'), workflow: Handle }),
  z.object({ op: z.literal('verify.run'), cwd: z.string(), contract: z.record(z.unknown()) }),
  z.object({ op: z.literal('ledger.query'), since: z.string().datetime() }),
]);
export type EngineRequest = z.infer<typeof EngineRequest>;

export const EngineEnvelope = z.object({ id: z.number().int().nonnegative(), request: EngineRequest });
export type EngineEnvelope = z.infer<typeof EngineEnvelope>;

export const EngineReply = z.object({
  id: z.number().int().nonnegative(),
  ok: z.boolean(),
  value: z.unknown().optional(),
  error: z.object({ code: z.string(), message: z.string() }).optional(),
});
export type EngineReply = z.infer<typeof EngineReply>;

export const EngineEvent = z.discriminatedUnion('type', [
  z.object({ type: z.literal('engine.ready'), engineVersion: z.string() }),
  z.object({ type: z.literal('engine.error'), message: z.string(), fatal: z.boolean() }),
  z.object({ type: z.literal('session.output'), session: Handle, seq: z.number().int(), kind: z.string(), text: z.string() }),
  z.object({ type: z.literal('session.status'), session: Handle, status: z.enum(['running', 'idle', 'stopped', 'failed']), cliSessionId: z.string().optional() }),
  z.object({ type: z.literal('workflow.node'), workflow: Handle, node: z.string(), kind: z.string(), state: z.enum(['pending', 'running', 'done', 'failed']), attempts: z.number().int() }),
  z.object({ type: z.literal('verdict'), workflow: Handle, verdict: z.enum(['verified', 'refuted', 'unverified']), evidenceRef: z.string().nullable() }),
  z.object({ type: z.literal('ledger.turn'), session: Handle, inputTokens: z.number().int(), outputTokens: z.number().int(), usd: z.number(), ok: z.boolean(), verified: z.boolean().nullable() }),
]);
export type EngineEvent = z.infer<typeof EngineEvent>;
