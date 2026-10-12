/**
 * The engine host: runs Claw Orchestrator as a library and implements every
 * EngineRequest. This is the only file group allowed to import Claw (ENG-02,
 * ADR 0011), and it never imports Claw's bin/* (ENG-04).
 *
 * Callers must set the environment BEFORE calling createEngineHost, because Claw
 * reads it when it is first imported: HOME/USERPROFILE (the engine's own home),
 * CLAWO_NO_EMBEDDED_SERVER=1, CLAWO_WF_DIR and CLAWO_RUNS_DIR. The app entry does
 * that (packages/app/src/node/engineHostMain.ts). This module never reads or
 * writes process.env.
 */
import { AsyncLocalStorage } from 'node:async_hooks';
import { randomUUID } from 'node:crypto';
import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import type { FanoutAgentSpec, WorkflowSpec } from '@enderfga/claw-orchestrator/dist/src/kernel/types.js';
import type { AcceptanceContract } from '@enderfga/claw-orchestrator/dist/src/verify/contract.js';
import type { SessionManager } from '@enderfga/claw-orchestrator';
import type { AgentId, EngineEvent, EngineRequest, EngineEnv, OrchError, ErrorCode } from '@orchagents/contracts';
import { ENGINE_COPY, PLANNER_MESSAGES } from '../common/strings.js';
import {
  type AgentSpec,
  AutoloopInput,
  CompareInput,
  CouncilInput,
  IMPLEMENT_NODE_KEY,
  SolveInput,
  agentKeysFor,
} from '../common/templates.js';
import { EngineStateFile, type EngineState, type SessionRecord, type WorkflowRecord } from './stateFile.js';

/** The user's real home variables. Applied to every agent spawn unless the account env sets the same key. */
export interface HomeEnv {
  readonly HOME?: string;
  readonly USERPROFILE?: string;
}

export interface EngineHostOptions {
  /** Absolute engine data folder, e.g. ~/.orch/engine (ENG-03). */
  readonly engineDir: string;
  /** The user's real home, captured before the host redirected HOME. */
  readonly realHome: HomeEnv;
  /** Path to the claude binary. Tests point this at the fake agent. */
  readonly claudeBin?: string;
  /**
   * Binaries for the other agents. Passed to SessionManager's config, so the
   * host never reads or writes process.env for them. Tests point these at the fake agent.
   */
  readonly agentBins?: Readonly<Partial<Record<Exclude<AgentId, 'claude'>, string>>>;
}

type Template = 'solve' | 'compare' | 'council' | 'autoloop';

export type HostResult = { ok: true; value: unknown } | { ok: false; error: OrchError };

export interface EngineHost {
  handle(request: EngineRequest): Promise<HostResult>;
  onEvent(listener: (event: EngineEvent) => void): () => void;
  /** engine.ready, kept so a port that attaches after start-up still gets it. */
  readonly readyEvent: EngineEvent;
  dispose(): Promise<void>;
}

type ClawModule = typeof import('@enderfga/claw-orchestrator');
/** Claw's built-in workflow templates are not re-exported from the package index (spike S0-04 §3). */
type ClawTemplates = typeof import('@enderfga/claw-orchestrator/dist/src/kernel/templates/index.js');
type Manager = InstanceType<ClawModule['SessionManager']>;
type StartConfig = Parameters<SessionManager['startSession']>[0];

/** The slice of Claw's kernel the host wraps. The kernel is private in Claw's types but public at run time. */
interface KernelLike {
  executors: Record<string, (node: unknown, ctx: { runId: string }) => unknown>;
  setExecutor(kind: string, executor: (node: unknown, ctx: { runId: string }) => unknown): void;
}

class HostFailure extends Error {
  readonly code: ErrorCode;
  readonly userMessage: string;
  readonly fix: string | undefined;

  constructor(code: ErrorCode, userMessage: string, fix?: string) {
    super(userMessage);
    this.code = code;
    this.userMessage = userMessage;
    this.fix = fix;
  }
}

function failure(error: unknown): OrchError {
  if (error instanceof HostFailure) {
    return { code: error.code, message: error.userMessage, ...(error.fix ? { fix: error.fix } : {}) };
  }
  return { code: 'internal', message: ENGINE_COPY.workflowFailed.message, fix: ENGINE_COPY.workflowFailed.fix };
}

function notFound(kind: 'session' | 'workflow'): HostFailure {
  return new HostFailure('not_found', ENGINE_COPY.notFound[kind]);
}

function nodeState(state: string): 'pending' | 'running' | 'done' | 'failed' {
  switch (state) {
    case 'running':
      return 'running';
    case 'succeeded':
    case 'skipped':
      return 'done';
    case 'failed':
    case 'cancelled':
      return 'failed';
    default:
      return 'pending';
  }
}

const TERMINAL_RUN_STATES = new Set(['completed', 'failed', 'cancelled']);
const LIVE_RUN_STATES = new Set(['pending', 'running', 'verifying']);

/**
 * Session settings for one account. Writing runs are full auto inside their own
 * worktree: no approval prompts (owner decision). Read-only runs plan and may not
 * write (JOB-03).
 */
function sessionConfig(name: string, record: SessionRecord): StartConfig {
  const readOnly = record.readOnly;
  return {
    name,
    cwd: record.cwd,
    engine: record.agent,
    env: record.env,
    permissionMode: readOnly ? 'plan' : 'bypassPermissions',
    sandboxMode: readOnly ? 'read-only' : 'workspace-write',
    ...(record.model ? { model: record.model } : {}),
    ...(record.maxBudgetUsd !== undefined ? { maxBudgetUsd: record.maxBudgetUsd } : {}),
    ...(record.cliSessionId ? { resumeSessionId: record.cliSessionId } : {}),
  };
}

function validateInput(template: Template, input: unknown): SolveInput | CompareInput | CouncilInput | AutoloopInput {
  const schema =
    template === 'solve'
      ? SolveInput
      : template === 'compare'
        ? CompareInput
        : template === 'council'
          ? CouncilInput
          : AutoloopInput;
  const parsed = schema.safeParse(input);
  if (!parsed.success) {
    throw new HostFailure('validation_failed', ENGINE_COPY.invalidRequest.message, ENGINE_COPY.invalidRequest.fix);
  }
  return parsed.data;
}

/** The account env for each autoloop role. A missing role is refused, never run on the default account. */
function autoloopEnvs(record: WorkflowRecord): { plannerEnv: EngineEnv; coderEnv: EngineEnv; reviewerEnv: EngineEnv } {
  const envFor = (key: string): EngineEnv => {
    const env = record.envByNode[key];
    if (!env) throw new HostFailure('validation_failed', ENGINE_COPY.noAccountRecord.message, ENGINE_COPY.noAccountRecord.fix);
    return env;
  };
  return { plannerEnv: envFor('planner'), coderEnv: envFor('coder'), reviewerEnv: envFor('reviewer') };
}

/** Per-agent answers a fanout node stored in its data (Claw's `results`). */
function fanoutAnswers(data: unknown): Array<{ name: string; ok: boolean; output: string }> {
  const results = (data as { results?: unknown } | undefined)?.results;
  if (!Array.isArray(results)) return [];
  return results.map((r: { agent?: unknown; ok?: unknown; output?: unknown }) => ({
    name: String(r.agent ?? ''),
    ok: r.ok === true,
    output: typeof r.output === 'string' ? r.output : '',
  }));
}

function toFanoutAgents(agents: readonly AgentSpec[]): FanoutAgentSpec[] {
  return agents.map((a) => ({
    name: a.name,
    ...(a.engine ? { engine: a.engine } : {}),
    ...(a.model ? { model: a.model } : {}),
    ...(a.persona ? { persona: a.persona } : {}),
  }));
}

interface WorkflowContext {
  workflow: string;
  node: string;
}

export async function createEngineHost(options: EngineHostOptions): Promise<EngineHost> {
  await mkdir(options.engineDir, { recursive: true, mode: 0o700 });
  const stateFile = new EngineStateFile(path.join(options.engineDir, 'state.json'));
  const loaded = await stateFile.load();
  const state: EngineState = loaded.state;
  const listeners = new Set<(event: EngineEvent) => void>();
  let disposed = false;

  const emit = (event: EngineEvent): void => {
    if (disposed) return;
    for (const listener of listeners) listener(event);
  };

  // Dynamic import: Claw reads HOME and CLAWO_* when it is first loaded.
  const claw: ClawModule = await import('@enderfga/claw-orchestrator');
  const templates: ClawTemplates = await import('@enderfga/claw-orchestrator/dist/src/kernel/templates/index.js');
  const manager: Manager = new claw.SessionManager({
    claudeBin: options.claudeBin ?? 'claude',
    engineBins: { ...options.agentBins },
  });

  // Every spawn gets the user's real home, unless the account env sets that key (agy).
  const homeEnv: Record<string, string> = {};
  if (options.realHome.HOME !== undefined) homeEnv.HOME = options.realHome.HOME;
  if (options.realHome.USERPROFILE !== undefined) homeEnv.USERPROFILE = options.realHome.USERPROFILE;

  const workflowAsyncStorage = new AsyncLocalStorage<WorkflowContext>();
  const savedSessions = new Map<string, unknown>();
  /** Handoff history when Claw kept none: say so, never invent turns (the caller sends the task next). */
  const NO_TRANSCRIPT = {
    entries: [{ role: 'user', text: ENGINE_COPY.noTranscript }],
    omittedAfterFirst: 0,
    chars: ENGINE_COPY.noTranscript.length,
  };

  // Guard: no session may start without an account env (ENG-05). Internal Claw
  // paths that start sessions without one are refused here, never run on the default account.
  const originalStart = manager.startSession.bind(manager);
  manager.startSession = async (config: StartConfig) => {
    if (!config.env || Object.keys(config.env).length === 0) {
      throw new HostFailure('internal', ENGINE_COPY.noAccountRecord.message, ENGINE_COPY.noAccountRecord.fix);
    }
    const name = config.name || `session-${Date.now()}`;
    const store = workflowAsyncStorage.getStore();
    let workflowId = store?.workflow;
    const nodeKey = store?.node;
    if (!workflowId) {
      for (const wId of Object.keys(state.workflows)) {
        if (name.includes(wId) || (name.startsWith('council-') && wId.length >= 8 && name.includes(wId.slice(0, 8)))) {
          workflowId = wId;
          break;
        }
      }
    }
    const isWorkflowSession = !!workflowId;
    if (isWorkflowSession && !state.sessions[name]) {
      const readOnly = config.permissionMode === 'plan' || config.sandboxMode === 'read-only';
      const agent = (config.engine as AgentId) || 'claude';
      const record: SessionRecord = {
        agent,
        cwd: config.cwd || process.cwd(),
        env: config.env,
        readOnly,
        ...(config.model ? { model: config.model } : {}),
        ...(config.maxBudgetUsd !== undefined ? { maxBudgetUsd: config.maxBudgetUsd } : {}),
        workflow: workflowId,
        ...(nodeKey ? { node: nodeKey } : {}),
        ...(config.resumeSessionId ? { cliSessionId: config.resumeSessionId } : {}),
      };
      state.sessions[name] = record;
      await persist();
    }

    const sessionInfo = await originalStart({ ...config, env: { ...homeEnv, ...config.env } });

    if (isWorkflowSession) {
      emit({ type: 'session.status', session: name, status: 'running' });
    }

    return sessionInfo;
  };

  const originalStop = manager.stopSession.bind(manager);
  manager.stopSession = async (name: string, opts?: unknown) => {
    let cliSessionId: string | undefined;
    try {
      const status = manager.getStatus(name);
      if (status.claudeSessionId) {
        cliSessionId = status.claudeSessionId;
      }
    } catch {
      // ignore
    }
    const managed = (manager as unknown as { sessions: Map<string, unknown> }).sessions?.get(name);
    if (managed) {
      savedSessions.set(name, managed);
    }
    const res = await originalStop(name, opts as object);
    const record = state.sessions[name];
    if (record) {
      if (cliSessionId) {
        record.cliSessionId = cliSessionId;
        await persist();
      }
    }
    emit({
      type: 'session.status',
      session: name,
      status: 'stopped',
      ...(cliSessionId ? { cliSessionId } : record?.cliSessionId ? { cliSessionId: record.cliSessionId } : {}),
    });
    return res;
  };

  // Node executors read their account env from the persisted workflow record,
  // so a resumed workflow runs on the same account (Claw drops env from spec.json).
  const kernel = (manager as unknown as { kernel: KernelLike }).kernel;
  const envFor = (runId: string, key: string): EngineEnv => {
    const env = state.workflows[runId]?.envByNode[key];
    if (!env) throw new HostFailure('validation_failed', ENGINE_COPY.noAccountRecord.message, ENGINE_COPY.noAccountRecord.fix);
    return env;
  };
  const wrap = (kind: 'agent' | 'fanout' | 'council'): void => {
    const original = kernel.executors[kind];
    if (!original) return;
    kernel.setExecutor(kind, (node, ctx) => {
      const spec = node as { id: string; agents?: Array<{ name: string }> };
      const nodeKey = kind === 'agent' ? spec.id : (spec.id ?? kind);
      return workflowAsyncStorage.run({ workflow: ctx.runId, node: nodeKey }, () => {
        if (kind === 'agent') {
          return original({ ...spec, env: envFor(ctx.runId, spec.id) }, ctx);
        }
        const agents = (spec.agents ?? []).map((a) => ({ ...a, env: envFor(ctx.runId, a.name) }));
        return original({ ...spec, agents }, ctx);
      });
    });
  };
  wrap('agent');
  wrap('fanout');
  wrap('council');

  // Fix-on-red repairs the implementer's tree, so its fixer runs on the implementer's account.
  // A verifier with no implementer (council, or no solve) gets no fixer env, and its fixer is refused.
  const originalVerifier = kernel.executors.verifier;
  if (originalVerifier) {
    kernel.setExecutor('verifier', (node, ctx) => {
      const fixerEnv = state.workflows[ctx.runId]?.envByNode[IMPLEMENT_NODE_KEY];
      return workflowAsyncStorage.run({ workflow: ctx.runId, node: 'repair' }, () => {
        return originalVerifier(fixerEnv ? { ...(node as object), env: fixerEnv } : node, ctx);
      });
    });
  }

  const unsubscribeWorkflow = manager.onWorkflowEvent(({ runId, event }) => {
    if (event.type === 'node_state') {
      let kind = 'agent';
      try {
        kind = manager.workflowStatus(runId).nodes[event.node]?.kind ?? kind;
      } catch {
        // run record gone: keep the default kind
      }
      emit({
        type: 'workflow.node',
        workflow: runId,
        node: event.node,
        kind,
        state: nodeState(event.state),
        attempts: event.attempt ?? 0,
      });
    } else if (event.type === 'run_state' && TERMINAL_RUN_STATES.has(event.state)) {
      let evidenceRef: string | null = null;
      try {
        evidenceRef = manager.workflowStatus(runId).evidenceId ?? null;
      } catch {
        // keep null
      }
      emit({
        type: 'verdict',
        workflow: runId,
        verdict: event.outcome ?? 'unverified',
        evidenceRef,
      });
    }
  });

  async function persist(): Promise<void> {
    await stateFile.save(state);
  }

  async function ensureSessionLive(name: string, record: SessionRecord): Promise<void> {
    if (manager.hasSession(name)) return;
    await manager.startSession(sessionConfig(name, record));
    const managed = (manager as unknown as { sessions: Map<string, { transcript?: unknown }> }).sessions?.get(name);
    const saved = savedSessions.get(name) as { transcript?: unknown } | undefined;
    if (saved && managed && saved.transcript && !managed.transcript) {
      managed.transcript = saved.transcript;
    }
  }

  async function startSessionRecord(record: SessionRecord): Promise<string> {
    const name = `s-${randomUUID()}`;
    state.sessions[name] = record;
    await persist();
    try {
      await manager.startSession(sessionConfig(name, record));
    } catch (error) {
      delete state.sessions[name];
      await persist();
      throw error;
    }
    emit({ type: 'session.status', session: name, status: 'idle' });
    return name;
  }

  async function sendToSession(name: string, text: string): Promise<unknown> {
    const record = state.sessions[name];
    if (!record) throw notFound('session');
    await ensureSessionLive(name, record);
    emit({ type: 'session.status', session: name, status: 'running' });
    const result = await manager.sendMessage(name, text);
    emit({ type: 'session.output', session: name, seq: 0, kind: 'result', text: result.output });
    const [row] = manager.getRunLedger({ session: name, limit: 1 }).rows;
    if (row) {
      emit({
        type: 'ledger.turn',
        session: name,
        inputTokens: row.tokensIn,
        outputTokens: row.tokensOut,
        usd: row.costUsd,
        ok: row.ok,
        verified: row.verified ?? null,
      });
    }
    if (result.error) {
      emit({ type: 'session.status', session: name, status: 'failed' });
      throw new HostFailure('internal', ENGINE_COPY.workflowFailed.message, ENGINE_COPY.workflowFailed.fix);
    }
    emit({ type: 'session.status', session: name, status: 'idle' });
    return { session: name, output: result.output };
  }

  async function startAutoloop(input: unknown, envByNode: Record<string, EngineEnv>): Promise<string> {
    const autoloop = validateInput('autoloop', input) as AutoloopInput;
    const runId = `w-${randomUUID()}`;
    const record: WorkflowRecord = { template: 'autoloop', envByNode: { ...envByNode } };
    state.workflows[runId] = record;
    await persist();
    try {
      // Claw starts the Planner here and resolves once it is up. Role envs go in as secrets, never in the spec.
      await workflowAsyncStorage.run({ workflow: runId, node: 'autoloop' }, () =>
        manager.autoloopStart({
          runId,
          workspace: autoloop.cwd,
          plannerEngine: autoloop.plannerEngine,
          ...(autoloop.plannerModel ? { plannerModel: autoloop.plannerModel } : {}),
          coderEngine: autoloop.coderEngine,
          ...(autoloop.coderModel ? { coderModel: autoloop.coderModel } : {}),
          reviewerEngine: autoloop.reviewerEngine,
          ...(autoloop.reviewerModel ? { reviewerModel: autoloop.reviewerModel } : {}),
          ...autoloopEnvs(record),
        })
      );
    } catch (error) {
      delete state.workflows[runId];
      await persist();
      throw error;
    }
    tellPlanner(runId, autoloop.goal);
    return runId;
  }

  /** Send the Planner a message without waiting for its turn to finish; a failed turn shows as a failed session. */
  function tellPlanner(runId: string, text: string): void {
    void workflowAsyncStorage
      .run({ workflow: runId, node: 'autoloop' }, () => manager.autoloopChat(runId, text))
      .catch(() => undefined);
  }

  async function startWorkflow(template: Template, input: unknown, envByNode: Record<string, EngineEnv>): Promise<string> {
    const parsed = validateInput(template, input);
    for (const key of agentKeysFor(template, input)) {
      if (!envByNode[key]) throw new HostFailure('validation_failed', ENGINE_COPY.noAccountRecord.message, ENGINE_COPY.noAccountRecord.fix);
    }
    if (template === 'autoloop') return startAutoloop(input, envByNode);

    let spec: WorkflowSpec;
    if (template === 'solve') {
      const solve = parsed as SolveInput;
      spec = templates.solveWorkflow({
        task: solve.task,
        cwd: solve.cwd,
        ...(solve.contract ? { contract: solve.contract as unknown as AcceptanceContract } : {}),
        scouts: toFanoutAgents(solve.scouts),
        ...(solve.implementer
          ? {
              implementer: {
                ...(solve.implementer.engine ? { engine: solve.implementer.engine } : {}),
                ...(solve.implementer.model ? { model: solve.implementer.model } : {}),
              },
            }
          : {}),
        ...(solve.reviewers ? { reviewers: toFanoutAgents(solve.reviewers) } : {}),
        ...(solve.humanGate !== undefined ? { humanGate: solve.humanGate } : {}),
        ...(solve.maxRepairs !== undefined ? { maxRepairs: solve.maxRepairs } : {}),
      });
      // Synthesis needs an account the solve input does not name, so it stays off.
      for (const node of spec.nodes) {
        if (node.kind === 'fanout') node.synthesize = false;
      }
    } else if (template === 'compare') {
      const compare = parsed as CompareInput;
      spec = templates.fanoutWorkflow({
        task: compare.task,
        cwd: compare.cwd,
        // Fanout shares one folder and is for answers, not edits (JOB-09): every compare agent is read-only.
        agents: toFanoutAgents(compare.agents).map((a) => ({ ...a, permissionMode: 'plan', sandboxMode: 'read-only' as const })),
        synthesize: false,
      });
    } else {
      const council = parsed as CouncilInput;
      spec = templates.councilWorkflow({
        task: council.task,
        cwd: council.cwd,
        agents: toFanoutAgents(council.agents),
        ...(council.maxRounds !== undefined ? { maxRounds: council.maxRounds } : {}),
        ...(council.contract ? { contract: council.contract as unknown as AcceptanceContract } : {}),
      });
    }

    const runId = `w-${randomUUID()}`;
    const record: WorkflowRecord = { template, envByNode: { ...envByNode } };
    state.workflows[runId] = record;
    await persist();
    try {
      await manager.workflowStart(spec, { runId });
    } catch (error) {
      delete state.workflows[runId];
      await persist();
      throw error;
    }
    return runId;
  }

  async function handleRequest(request: EngineRequest): Promise<unknown> {
    switch (request.op) {
      case 'health.ping':
        return { engineVersion: manager.getVersion() };

      case 'session.start': {
        const readOnly = request.readOnly;
        const session = await startSessionRecord({
          agent: request.agent,
          cwd: request.cwd,
          env: request.env,
          readOnly,
          ...(request.model ? { model: request.model } : {}),
          ...(request.maxBudgetUsd !== undefined ? { maxBudgetUsd: request.maxBudgetUsd } : {}),
        });
        return { session };
      }

      case 'session.send':
        return sendToSession(request.session, request.text);

      case 'session.stop': {
        const record = state.sessions[request.session];
        if (!record) throw notFound('session');
        if (manager.hasSession(request.session)) {
          await manager.stopSession(request.session);
        } else {
          emit({
            type: 'session.status',
            session: request.session,
            status: 'stopped',
            ...(record.cliSessionId ? { cliSessionId: record.cliSessionId } : {}),
          });
        }
        return { session: request.session, stopped: true };
      }

      case 'session.resume': {
        const record = state.sessions[request.session];
        if (!record) throw notFound('session');
        record.env = request.env;
        await persist();
        const wasLive = manager.hasSession(request.session);
        await ensureSessionLive(request.session, record);
        emit({
          type: 'session.status',
          session: request.session,
          status: 'running',
          ...(record.cliSessionId ? { cliSessionId: record.cliSessionId } : {}),
        });
        return { session: request.session, resumed: !wasLive };
      }

      case 'session.handoff': {
        const record = state.sessions[request.from];
        if (!record) throw notFound('session');
        if (record.cwd !== request.cwd) {
          throw new HostFailure('validation_failed', ENGINE_COPY.invalidRequest.message, ENGINE_COPY.invalidRequest.fix);
        }
        const newName = `s-${randomUUID()}`;
        const next: SessionRecord = { agent: request.toAgent, cwd: request.cwd, env: request.env, readOnly: record.readOnly };
        state.sessions[newName] = next;
        await persist();
        try {
          if (!manager.hasSession(request.from)) {
            let saved = savedSessions.get(request.from) as
              | {
                  transcript?: { entries: unknown[]; omittedAfterFirst?: number; chars?: number };
                  config?: unknown;
                  cwd?: string;
                  created?: string;
                  lastActivity?: number;
                }
              | undefined;
            if (!saved) {
              const fullConfig = sessionConfig(request.from, record);
              saved = {
                config: fullConfig,
                cwd: record.cwd,
                created: new Date().toISOString(),
                lastActivity: Date.now(),
                transcript: NO_TRANSCRIPT,
              };
            } else if (!saved.transcript || saved.transcript.entries.length === 0) {
              saved.transcript = NO_TRANSCRIPT;
            }
            (manager as unknown as { sessions: Map<string, unknown> }).sessions?.set(request.from, saved);
          }
          await manager.handoffSession(request.from, { engine: request.toAgent, newName, env: request.env });
        } catch (error) {
          delete state.sessions[newName];
          await persist();
          throw error;
        }
        return { session: newName };
      }

      case 'workflow.start': {
        if (!request.envByNode) {
          throw new HostFailure('validation_failed', ENGINE_COPY.noAccountRecord.message, ENGINE_COPY.noAccountRecord.fix);
        }
        const workflow = await startWorkflow(request.template, request.input, request.envByNode);
        return { workflow };
      }

      case 'workflow.status': {
        const record = state.workflows[request.workflow];
        if (!record) throw notFound('workflow');
        const run = manager.workflowStatus(request.workflow);
        return {
          workflow: request.workflow,
          state: run.state,
          outcome: run.outcome,
          evidenceId: run.evidenceId ?? null,
          nodes: Object.values(run.nodes).map((n) => ({ id: n.id, kind: n.kind, state: nodeState(n.state), attempts: n.attempts })),
          // Compare's combine step reads each agent's answer from the fanout node.
          answers: Object.values(run.nodes).flatMap((n) => fanoutAnswers(n.data)),
        };
      }

      case 'workflow.resume': {
        const record = state.workflows[request.workflow];
        if (!record) {
          let exists = true;
          try {
            manager.workflowStatus(request.workflow);
          } catch {
            exists = false;
          }
          if (!exists) throw notFound('workflow');
          // Refuse rather than run without the account this workflow was started on.
          throw new HostFailure('validation_failed', ENGINE_COPY.noAccountRecord.message, ENGINE_COPY.noAccountRecord.fix);
        }
        if (record.template === 'autoloop') {
          await workflowAsyncStorage.run({ workflow: request.workflow, node: 'autoloop' }, () =>
            manager.autoloopResume(request.workflow, autoloopEnvs(record))
          );
          return { workflow: request.workflow, state: manager.workflowStatus(request.workflow).state };
        }
        const run = await manager.workflowResume(request.workflow);
        return { workflow: request.workflow, state: run.state };
      }

      case 'workflow.cancel': {
        if (!state.workflows[request.workflow]) throw notFound('workflow');
        const { cancelled } = manager.workflowCancel(request.workflow);
        return { workflow: request.workflow, cancelled };
      }

      case 'workflow.approve': {
        const record = state.workflows[request.workflow];
        if (!record) throw notFound('workflow');
        if (record.template !== 'autoloop') {
          return { workflow: request.workflow, ...(await manager.workflowApprove(request.workflow, request.approve)) };
        }
        // The autoloop plan gate is a chat with the Planner; its reply arrives as session output.
        tellPlanner(request.workflow, request.approve ? PLANNER_MESSAGES.approved : PLANNER_MESSAGES.rejected(request.reason));
        return { workflow: request.workflow, answered: true };
      }

      case 'verify.run': {
        const bundle = await manager.verifyRun({ cwd: request.cwd, contract: request.contract });
        return { evidenceId: bundle.evidenceId, passed: bundle.passed, rounds: bundle.rounds };
      }

      case 'ledger.query': {
        const { rows } = manager.getRunLedger({ since: request.since });
        return {
          rows: rows.map((row) => ({
            ts: row.ts,
            session: row.session,
            engine: row.engine,
            tokensIn: row.tokensIn,
            tokensOut: row.tokensOut,
            costUsd: row.costUsd,
            ok: row.ok,
            verified: row.verified ?? null,
          })),
        };
      }
    }
  }

  // Resume every workflow that was live when the host last stopped.
  const resumeLive = async (): Promise<void> => {
    for (const runId of Object.keys(state.workflows)) {
      try {
        const run = manager.workflowStatus(runId);
        if (!LIVE_RUN_STATES.has(run.state)) continue;
        const record = state.workflows[runId];
        if (record?.template === 'autoloop') await manager.autoloopResume(runId, autoloopEnvs(record));
        else await manager.workflowResume(runId);
      } catch {
        emit({ type: 'engine.error', message: 'A workflow could not resume after the engine restarted.', fatal: false });
      }
    }
  };

  const readyEvent: EngineEvent = { type: 'engine.ready', engineVersion: manager.getVersion() };
  emit(readyEvent);
  if (loaded.corrupt) {
    emit({ type: 'engine.error', message: 'The engine state file was unreadable and was reset.', fatal: false });
  }
  void resumeLive();

  return {
    async handle(request) {
      try {
        const value = await handleRequest(request);
        return { ok: true, value };
      } catch (error) {
        return { ok: false, error: failure(error) };
      }
    },
    readyEvent,
    onEvent(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    async dispose() {
      if (disposed) return;
      disposed = true;
      unsubscribeWorkflow();
      listeners.clear();
      await manager.shutdown();
    },
  };
}
