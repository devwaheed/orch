/**
 * Spec try runner (docs/specs/spec-queue.md §5, §6).
 * Manages implementer turn, verify checks & guardrails, audit by different agent, and after_each gates.
 */
import type {
  AccountId,
  AgentId,
  CriterionResult,
  Job,
  JobId,
  JobSpec,
  OrchEvent,
  PickAccountResult,
  Result,
  Run,
  RunId,
  RunLine,
  SpecQueueSettings,
  SpecRun,
} from '@orchagents/contracts';
import { AGENT_DISPLAY_NAMES } from '../common/agentDisplayNames.js';
import type { IGitService } from '../../../git/common/git.js';
import type { IProfilesService } from '../../../profiles/common/profiles.js';
import type { EngineClient } from '../../../engine/common/engineClient.js';
import { readFile } from 'node:fs/promises';
import * as path from 'node:path';
import { evaluateGuardrails } from '../../../jobs/node/guardrails.js';
import { checkFileRule } from '../../../review/guardrails/common/guardrails.js';
import { AGENT_ORDER } from '../common/scheduler.js';
import type { CommandRunner } from './specMerge.js';

export interface TryRunResult {
  readonly success: boolean;
  readonly failedChecks?: readonly string[];
  readonly failedAudits?: readonly string[];
  readonly failedGate?: string;
  readonly implementer?: { agent: AgentId; accountId: AccountId };
  readonly auditor?: { agent: AgentId; accountId: AccountId; sameAgent: boolean };
  readonly criterionResults: readonly CriterionResult[];
  readonly limited?: { agent: AgentId; accountId: AccountId; resetsAt?: string | null };
}

export interface ISpecJobRunner {
  runTry(
    spec: SpecRun,
    repoPath: string,
    settings: SpecQueueSettings,
    retryMessage?: string,
  ): Promise<TryRunResult>;
  cancel(spec: SpecRun, repoPath: string): Promise<void>;
}

export interface RealSpecJobRunnerDeps {
  git: IGitService;
  profiles?: IProfilesService | undefined;
  engine?: Pick<EngineClient, 'request'> | undefined;
  quota: {
    pickAccount(agent: AgentId): Promise<Result<PickAccountResult>>;
  };
  commandRunner?: CommandRunner | undefined;
  installedAgents?: readonly AgentId[] | undefined;
  jobs?: {
    start(spec: JobSpec, options?: { worktreeRunId?: string; verifiedBy?: 'spec' }): Promise<Result<Job>>;
    get(jobId: JobId): Promise<Result<Job>>;
    cancel(jobId: JobId): Promise<Result<void>>;
    onEvent(listener: (event: OrchEvent) => void): { dispose(): void };
  } | undefined;
  runs?: {
    list(jobId: JobId): Promise<Result<Run[]>>;
    lines?(runId: RunId, afterSeq: number): Promise<Result<RunLine[]>>;
  } | undefined;
  onJobStarted?: ((spec: SpecRun, jobId: JobId) => Promise<void>) | undefined;
}

/**
 * Real job runner executing tries on the engine / fake agent.
 */
export class RealSpecJobRunner implements ISpecJobRunner {
  private readonly activeJobs = new Map<string, JobId>();
  constructor(private readonly deps: RealSpecJobRunnerDeps) {}

  private jobKey(spec: SpecRun): string {
    return `${spec.queueId}:${spec.id}`;
  }

  async runTry(
    spec: SpecRun,
    repoPath: string,
    settings: SpecQueueSettings,
    retryMessage?: string,
  ): Promise<TryRunResult> {
    const installed = this.deps.installedAgents ?? AGENT_ORDER;

    // 1. Pick implementer agent and account (§5)
    let implAgent: AgentId;
    let implAccountId: AccountId;

    if (spec.implementer) {
      implAgent = spec.implementer.agent;
      implAccountId = spec.implementer.accountId;
    } else {
      const preferred = spec.spec.agent !== 'auto' ? (spec.spec.agent as AgentId) : null;
      const candidates = preferred ? [preferred] : AGENT_ORDER.filter((a) => installed.includes(a));

      let chosen: { agent: AgentId; accountId: AccountId } | null = null;
      let limitInfo: { agent: AgentId; accountId: AccountId; resetsAt?: string | null } | null = null;

      for (const agent of candidates) {
        const pickRes = await this.deps.quota.pickAccount(agent);
        if (pickRes.ok) {
          if (pickRes.value.kind === 'account') {
            chosen = { agent, accountId: pickRes.value.accountId };
            break;
          } else if (pickRes.value.kind === 'wait' && !limitInfo) {
            limitInfo = { agent, accountId: 'default' as AccountId, resetsAt: pickRes.value.until };
          }
        }
      }

      if (!chosen) {
        return {
          success: false,
          criterionResults: spec.criteria,
          limited: limitInfo ?? { agent: candidates[0] ?? 'claude', accountId: 'default' as AccountId },
        };
      }

      implAgent = chosen.agent;
      implAccountId = chosen.accountId;
    }

    // 2. Start a real platform job in the spec's persistent worktree (ADR 0013, JOB-02).
    const runId = `spec-${spec.id}`;
    if (!this.deps.jobs) {
      return {
        success: false,
        failedChecks: ['The spec runner has no jobs service.'],
        criterionResults: spec.criteria,
      };
    }
    let body = '';
    try {
      const content = await readFile(path.resolve(repoPath, spec.file), 'utf8');
      body = content.replace(/^---[\s\S]*?---\s*/, '').trim();
    } catch { /* the loaded spec can still run using its title */ }
    const goal = `${retryMessage ? `${retryMessage}\n\n` : ''}${spec.spec.title}${body ? `\n\n${body}` : ''}`;
    const mode = spec.spec.mode;
    let agents = spec.spec.agents;
    if ((mode === 'compare' || mode === 'council') && agents.length < 2) {
      const available: AgentId[] = [];
      for (const agent of AGENT_ORDER.filter((candidate) => installed.includes(candidate))) {
        const picked = await this.deps.quota.pickAccount(agent);
        if (picked.ok && picked.value.kind === 'account') available.push(agent);
        if (available.length === 2) break;
      }
      agents = available;
    }
    if ((mode === 'compare' || mode === 'council') && agents.length < 2) {
      return { success: false, failedChecks: ['Could not find two installed agents with available accounts.'], criterionResults: spec.criteria, implementer: { agent: implAgent, accountId: implAccountId } };
    }
    const jobSpec: JobSpec = mode === 'single'
      ? { mode, goal, repoPath, storyPath: spec.file, checks: [], onLimit: 'switch-account', orchestrator: { agent: implAgent, account: implAccountId }, workers: [implAgent] }
      : mode === 'compare'
        ? { mode, goal, repoPath, storyPath: spec.file, checks: [], onLimit: 'switch-account', combine: true, agents }
        : mode === 'council'
          ? { mode, goal, repoPath, storyPath: spec.file, checks: [], onLimit: 'switch-account', maxRounds: 5, agents }
          : { mode, goal, repoPath, storyPath: spec.file, checks: [], onLimit: 'switch-account', roles: { planner: spec.spec.agents[0] ?? implAgent, coder: spec.spec.agents[1] ?? implAgent, reviewer: spec.spec.agents[2] ?? implAgent } };
    let latestJob: Job | undefined;
    const seenJobs = new Map<JobId, Job>();
    let resolveTerminal: ((job: Job) => void) | undefined;
    const terminal = new Promise<Job>((resolve) => { resolveTerminal = resolve; });
    const unsubscribe = this.deps.jobs.onEvent((event) => {
      if (event.type !== 'job.changed') return;
      seenJobs.set(event.job.id, event.job);
      if (!latestJob || event.job.id !== latestJob.id) return;
      latestJob = event.job;
      if (['done', 'failed', 'cancelled', 'waiting_quota'].includes(event.job.status)) resolveTerminal?.(event.job);
    });
    const started = await this.deps.jobs.start(jobSpec, { worktreeRunId: runId, verifiedBy: 'spec' });
    if (!started.ok) {
      unsubscribe.dispose();
      if (started.error.code === 'account_limited') {
        return { success: false, criterionResults: spec.criteria, limited: { agent: implAgent, accountId: implAccountId } };
      }
      return { success: false, failedChecks: [`Job failed to start: ${started.error.message}`], criterionResults: spec.criteria, implementer: { agent: implAgent, accountId: implAccountId } };
    }
    latestJob = seenJobs.get(started.value.id) ?? started.value;
    this.activeJobs.set(this.jobKey(spec), started.value.id);
    await this.deps.onJobStarted?.(spec, started.value.id);
    const latest = await this.deps.jobs.get(started.value.id);
    if (latest.ok) latestJob = latest.value;
    if (['done', 'failed', 'cancelled', 'waiting_quota'].includes(latestJob.status)) resolveTerminal?.(latestJob);
    const finishedJob = await terminal;
    unsubscribe.dispose();
    this.activeJobs.delete(this.jobKey(spec));
    if (finishedJob.status === 'waiting_quota') {
      return { success: false, criterionResults: spec.criteria, limited: { agent: implAgent, accountId: implAccountId } };
    }
    if (finishedJob.status !== 'done') {
      let engineError: string | undefined;
      let failedAgent = implAgent;
      const runs = await this.deps.runs?.list(finishedJob.id);
      if (runs?.ok) {
        for (const run of runs.value) {
          const lines = await this.deps.runs?.lines?.(run.id, 0);
          if (!lines?.ok) continue;
          const error = lines.value.find((line) => line.kind === 'err')?.text;
          if (error) {
            failedAgent = run.agent;
            engineError = error.split(/\r?\n/, 1)[0]?.trim();
            break;
          }
        }
      }
      const agentName = AGENT_DISPLAY_NAMES[failedAgent];
      const failure = engineError ? `${agentName} couldn't run: ${engineError}` : `Job ${finishedJob.status}: ${finishedJob.title}`;
      return { success: false, failedChecks: [failure], criterionResults: spec.criteria, implementer: { agent: implAgent, accountId: implAccountId } };
    }

    const branch = await this.deps.git.getDefaultBranch(repoPath);
    if (!branch.ok) return { success: false, failedChecks: [`Failed to find target branch: ${branch.error.message}`], criterionResults: spec.criteria, implementer: { agent: implAgent, accountId: implAccountId } };
    const worktreePath = path.join(repoPath, '.orch', 'wt', runId);
    const targetBranch = branch.value;

    // 4. Verify step: run command checks and guardrails (§6)
    const failedChecks: string[] = [];
    const criterionResults: CriterionResult[] = spec.criteria.map((c) => ({ ...c }));
    const diffResult = await this.deps.git.getDiff(worktreePath, targetBranch);
    const diffForRule = diffResult.ok ? diffResult.value : '';
    const filesResult = await this.deps.git.getChangedFiles(worktreePath, targetBranch);
    if (!filesResult.ok || filesResult.value.length === 0) {
      return {
        success: false,
        failedChecks: ['The agent made no changes.'],
        implementer: { agent: implAgent, accountId: implAccountId },
        criterionResults,
      };
    }

    for (let i = 0; i < spec.spec.done_when.length; i++) {
      const item = spec.spec.done_when[i]!;
      if (item.by === 'check') {
        let checkPassed = true;
        let summary = 'Passed';

        if (item.check.kind === 'command' && this.deps.commandRunner) {
          const matches = item.check.run.match(/(?:[^\s"']+|"[^"]*"|'[^']*')+/g) ?? [];
          const tokens = matches.map((t) => {
            if ((t.startsWith('"') && t.endsWith('"')) || (t.startsWith("'") && t.endsWith("'"))) {
              return t.slice(1, -1);
            }
            return t;
          });
          const cmd = tokens[0] ?? '';
          const args = tokens.slice(1);
          const cmdRes = await this.deps.commandRunner(cmd, args, { cwd: worktreePath });
          if (cmdRes.exitCode !== 0) {
            checkPassed = false;
            summary = `Command failed with code ${cmdRes.exitCode}`;
          }
        }
        if (item.check.kind === 'http') {
          try {
            const response = await fetch(item.check.url, { signal: AbortSignal.timeout(10_000) });
            checkPassed = response.status === item.check.expectStatus;
            summary = checkPassed ? 'Passed' : `Expected HTTP ${item.check.expectStatus}, received ${response.status}`;
          } catch {
            checkPassed = false;
            summary = 'HTTP check failed or timed out';
          }
        }
        if (item.check.kind === 'file_rule') {
          const changed = checkFileRule(diffForRule, item.check);
          checkPassed = changed.status === 'passed';
          summary = changed.summary;
        }

        criterionResults[i] = {
          index: i,
          state: checkPassed ? 'met' : 'not_met',
          summary,
          auditor: null,
        };

        if (!checkPassed) {
          failedChecks.push(item.text);
        }
      }
    }

    // Guardrails (§6)
    const guardrails = evaluateGuardrails(diffForRule, spec.spec.scope);
    if (!guardrails.passed) {
      failedChecks.push('Guardrails failed');
    }

    if (failedChecks.length > 0) {
      return {
        success: false,
        failedChecks,
        implementer: { agent: implAgent, accountId: implAccountId },
        criterionResults,
      };
    }

    // 5. Audit step (§6)
    // Auditor must be a DIFFERENT agent from implementer (§6)
    const otherAgents = AGENT_ORDER.filter((a) => a !== implAgent && installed.includes(a));
    let auditorAgent: AgentId = implAgent;
    let auditorAccountId: AccountId = implAccountId;
    let sameAgent = false;

    let foundOther = false;
    for (const a of otherAgents) {
      const pickRes = await this.deps.quota.pickAccount(a);
      if (pickRes.ok && pickRes.value.kind === 'account') {
        auditorAgent = a;
        auditorAccountId = pickRes.value.accountId;
        sameAgent = false;
        foundOther = true;
        break;
      }
    }

    if (!foundOther) {
      // SQ-13: Only one agent installed -> same agent, fresh session, sameAgent = true
      sameAgent = true;
      auditorAgent = implAgent;
      auditorAccountId = implAccountId;
    }

    const failedAudits: string[] = [];
    const auditLines = spec.spec.done_when.flatMap((item, index) => item.by === 'audit' ? [{ index, text: item.text }] : []);
    if (auditLines.length) {
      const noAnswer = 'The auditor gave no clear answer';
      let parsedResults: Map<number, { met: boolean; reason: string }> | undefined;
      if (this.deps.engine && this.deps.profiles) {
        const env = await this.deps.profiles.sessionEnv(auditorAccountId);
        if (env.ok) {
          const session = await this.deps.engine.request({ op: 'session.start', agent: auditorAgent, cwd: worktreePath, env: env.value, readOnly: true });
          const handle = session.ok ? String((session.value as { session?: unknown })?.session ?? '') : '';
          if (handle) {
            const criteriaText = auditLines.map((line) => `${line.index}: ${line.text}`).join('\n');
            const answer = await this.deps.engine.request({
              op: 'session.send',
              session: handle,
              text: `Review the work in this checkout against each audit line below. Do not change files. Return JSON only, with this shape: {"results":[{"index":<n>,"met":true|false,"reason":"<one line>"}]}. Include one result for every index.\n\nAudit lines:\n${criteriaText}`,
            });
            await this.deps.engine.request({ op: 'session.stop', session: handle });
            if (answer.ok) {
              const output = (answer.value as { output?: unknown } | null)?.output;
              if (typeof output === 'string') {
                try {
                  // Agents often wrap JSON in a code fence or a sentence; take the outermost object.
                  const value = JSON.parse(output.slice(output.indexOf('{'), output.lastIndexOf('}') + 1)) as { results?: unknown };
                  if (Array.isArray(value.results)) {
                    parsedResults = new Map();
                    for (const result of value.results) {
                      if (typeof result === 'object' && result !== null && 'index' in result && 'met' in result && 'reason' in result) {
                        const entry = result as { index: unknown; met: unknown; reason: unknown };
                        if (Number.isInteger(entry.index) && typeof entry.met === 'boolean' && typeof entry.reason === 'string') {
                          parsedResults.set(entry.index as number, { met: entry.met, reason: entry.reason.replace(/[\r\n]+/g, ' ').trim() });
                        }
                      }
                    }
                  }
                } catch { /* missing or malformed JSON is a failed audit */ }
              }
            }
          }
        }
      }
      for (const line of auditLines) {
        const result = parsedResults?.get(line.index);
        const met = result?.met === true;
        criterionResults[line.index] = {
          index: line.index,
          state: met ? 'met' : 'not_met',
          summary: result ? result.reason : noAnswer,
          auditor: { agent: auditorAgent, accountId: auditorAccountId, sameAgent },
        };
        if (!met) failedAudits.push(line.text);
      }
    }

    if (failedAudits.length > 0) {
      return {
        success: false,
        failedAudits,
        implementer: { agent: implAgent, accountId: implAccountId },
        auditor: { agent: auditorAgent, accountId: auditorAccountId, sameAgent },
        criterionResults,
      };
    }

    // 6. After-each gates (§6)
    for (const gate of settings.after_each) {
      if (this.deps.commandRunner) {
        const matches = gate.run.match(/(?:[^\s"']+|"[^"]*"|'[^']*')+/g) ?? [];
        const tokens = matches.map((t) => {
          if ((t.startsWith('"') && t.endsWith('"')) || (t.startsWith("'") && t.endsWith("'"))) {
            return t.slice(1, -1);
          }
          return t;
        });
        const cmd = tokens[0] ?? '';
        const args = tokens.slice(1);
        const res = await this.deps.commandRunner(cmd, args, {
          cwd: worktreePath,
          timeoutMs: gate.timeout_s * 1000,
        });
        if (res.exitCode !== 0) {
          return {
            success: false,
            failedGate: gate.name,
            implementer: { agent: implAgent, accountId: implAccountId },
            auditor: { agent: auditorAgent, accountId: auditorAccountId, sameAgent },
            criterionResults,
          };
        }
      }
    }

    return {
      success: true,
      implementer: { agent: implAgent, accountId: implAccountId },
      auditor: { agent: auditorAgent, accountId: auditorAccountId, sameAgent },
      criterionResults,
    };
  }

  async cancel(spec: SpecRun, repoPath: string): Promise<void> {
    void repoPath;
    const jobId = this.activeJobs.get(this.jobKey(spec)) ?? spec.jobId;
    if (jobId && this.deps.jobs) await this.deps.jobs.cancel(jobId);
  }
}

/**
 * Fast in-process job runner for synthetic queues (e.g. 64 specs).
 */
export class FastSpecJobRunner implements ISpecJobRunner {
  constructor(
    private readonly options: {
      checkFailures?: ReadonlySet<string>;
      gateFailures?: ReadonlySet<string>;
      auditFailures?: ReadonlySet<string>;
      limitedSpecs?: ReadonlySet<string>;
      installedAgents?: readonly AgentId[];
    } = {},
  ) {}

  async runTry(
    spec: SpecRun,
    repoPath: string,
    settings: SpecQueueSettings,
    retryMessage?: string,
  ): Promise<TryRunResult> {
    void repoPath;
    void retryMessage;
    if (this.options.limitedSpecs?.has(spec.id)) {
      return {
        success: false,
        criterionResults: spec.criteria,
        limited: { agent: 'claude', accountId: 'default' as AccountId },
      };
    }

    const implAgent: AgentId =
      spec.implementer?.agent ??
      (spec.spec.agent !== 'auto' ? (spec.spec.agent as AgentId) : 'claude');
    const implAccountId: AccountId = spec.implementer?.accountId ?? ('acct-1' as AccountId);

    const installed = this.options.installedAgents ?? AGENT_ORDER;
    const otherAgents = AGENT_ORDER.filter((a) => a !== implAgent && installed.includes(a));
    const sameAgent = otherAgents.length === 0;
    const auditorAgent = sameAgent ? implAgent : otherAgents[0]!;

    const criterionResults: CriterionResult[] = spec.spec.done_when.map((item, i) => {
      if (item.by === 'check') {
        const failed = this.options.checkFailures?.has(spec.id);
        return {
          index: i,
          state: failed ? 'not_met' : 'met',
          summary: failed ? 'Failed check' : 'Passed',
          auditor: null,
        };
      } else {
        const failed = this.options.auditFailures?.has(spec.id);
        return {
          index: i,
          state: failed ? 'not_met' : 'met',
          summary: failed ? 'Audit not met' : 'Audit met',
          auditor: {
            agent: auditorAgent,
            accountId: 'acct-auditor' as AccountId,
            sameAgent,
          },
        };
      }
    });

    const hasFailedCheck = criterionResults.some(
      (c, i) => spec.spec.done_when[i]!.by === 'check' && c.state === 'not_met',
    );
    if (hasFailedCheck) {
      return {
        success: false,
        failedChecks: ['Failed check'],
        implementer: { agent: implAgent, accountId: implAccountId },
        criterionResults,
      };
    }

    const hasFailedAudit = criterionResults.some(
      (c, i) => spec.spec.done_when[i]!.by === 'audit' && c.state === 'not_met',
    );
    if (hasFailedAudit) {
      return {
        success: false,
        failedAudits: ['Audit criterion not met'],
        implementer: { agent: implAgent, accountId: implAccountId },
        auditor: { agent: auditorAgent, accountId: 'acct-auditor' as AccountId, sameAgent },
        criterionResults,
      };
    }

    for (const gate of settings.after_each) {
      if (this.options.gateFailures?.has(gate.name) || this.options.gateFailures?.has(spec.id)) {
        return {
          success: false,
          failedGate: gate.name,
          implementer: { agent: implAgent, accountId: implAccountId },
          auditor: { agent: auditorAgent, accountId: 'acct-auditor' as AccountId, sameAgent },
          criterionResults,
        };
      }
    }

    return {
      success: true,
      implementer: { agent: implAgent, accountId: implAccountId },
      auditor: { agent: auditorAgent, accountId: 'acct-auditor' as AccountId, sameAgent },
      criterionResults,
    };
  }

  async cancel(spec: SpecRun, repoPath: string): Promise<void> {
    void spec;
    void repoPath;
  }
}
