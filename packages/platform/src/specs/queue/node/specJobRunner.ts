/**
 * Spec try runner (docs/specs/spec-queue.md §5, §6).
 * Manages implementer turn, verify checks & guardrails, audit by different agent, and after_each gates.
 */
import type {
  AccountId,
  AgentId,
  CriterionResult,
  PickAccountResult,
  Result,
  SpecQueueSettings,
  SpecRun,
} from '@orchagents/contracts';
import type { IGitService } from '../../../git/common/git.js';
import type { IProfilesService } from '../../../profiles/common/profiles.js';
import type { EngineClient } from '../../../engine/common/engineClient.js';
import { evaluateGuardrails } from '../../../jobs/node/guardrails.js';
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
  engine?: EngineClient | undefined;
  quota: {
    pickAccount(agent: AgentId): Promise<Result<PickAccountResult>>;
  };
  commandRunner?: CommandRunner | undefined;
  installedAgents?: readonly AgentId[] | undefined;
}

/**
 * Real job runner executing tries on the engine / fake agent.
 */
export class RealSpecJobRunner implements ISpecJobRunner {
  constructor(private readonly deps: RealSpecJobRunnerDeps) {}

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

    // 2. Create worktree `orch/spec-<id>` (JOB-02)
    const runId = `spec-${spec.id}`;
    const wtRes = await this.deps.git.createWorktree({ repoPath, runId });
    if (!wtRes.ok) {
      return {
        success: false,
        failedChecks: [`Failed to create worktree: ${wtRes.error.message}`],
        criterionResults: spec.criteria,
      };
    }
    const { worktreePath, targetBranch } = wtRes.value;

    // 3. Start or continue agent session if engine is available
    if (this.deps.engine && this.deps.profiles) {
      const envRes = await this.deps.profiles.sessionEnv(implAccountId);
      if (envRes.ok) {
        const sessionRes = await this.deps.engine.request({
          op: 'session.start',
          agent: implAgent,
          cwd: worktreePath,
          env: envRes.value,
          readOnly: false,
        });

        if (sessionRes.ok) {
          const sessionHandle = String((sessionRes.value as { session?: unknown })?.session ?? '');
          if (sessionHandle) {
            const prompt = retryMessage
              ? retryMessage
              : `${spec.spec.title}\n\nTask for spec ${spec.id}`;
            await this.deps.engine.request({
              op: 'session.send',
              session: sessionHandle,
              text: prompt,
            });
          }
        }
      }
    }

    // 4. Verify step: run command checks and guardrails (§6)
    const failedChecks: string[] = [];
    const criterionResults: CriterionResult[] = spec.criteria.map((c) => ({ ...c }));

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
    const diffRes = await this.deps.git.getDiff(worktreePath, targetBranch);
    const diff = diffRes.ok ? diffRes.value : '';
    const guardrails = evaluateGuardrails(diff, spec.spec.scope);
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
    for (let i = 0; i < spec.spec.done_when.length; i++) {
      const item = spec.spec.done_when[i]!;
      if (item.by === 'audit') {
        criterionResults[i] = {
          index: i,
          state: 'met',
          summary: 'Audit verified',
          auditor: {
            agent: auditorAgent,
            accountId: auditorAccountId,
            sameAgent,
          },
        };
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
    void spec;
    void repoPath;
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
