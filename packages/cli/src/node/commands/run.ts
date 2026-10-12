import {
  AccountId,
  AgentId,
  LimitPolicy,
  type JobSpec,
} from '@orchagents/contracts';
import { ExitCode } from '../../common/exitCodes.js';
import type { CliServices } from '../client.js';

export interface RunCommandOptions {
  check?: string[] | undefined;
  orchestrator?: string | undefined;
  onLimit?: string | undefined;
  workers?: string | undefined;
  json?: boolean | undefined;
}

export async function runCommand(
  services: CliServices,
  goal: string,
  options: RunCommandOptions,
  output: (msg: string) => void,
): Promise<number> {
  const trimmedGoal = goal.trim();
  if (trimmedGoal.length === 0) {
    output('Goal cannot be empty.');
    return ExitCode.InvalidUsage;
  }
  if (trimmedGoal.length > 20_000) {
    output('Goal exceeds maximum length of 20,000 characters.');
    return ExitCode.InvalidUsage;
  }

  // Parse orchestrator
  const orchestratorRaw = (options.orchestrator ?? 'claude').trim();
  let agentStr = orchestratorRaw;
  let accountChoice: 'auto' | AccountId = 'auto';

  if (orchestratorRaw.includes('@')) {
    const atIdx = orchestratorRaw.indexOf('@');
    agentStr = orchestratorRaw.slice(0, atIdx);
    const acctPart = orchestratorRaw.slice(atIdx + 1).trim();
    if (acctPart && acctPart !== 'auto') {
      const fullAccountId = acctPart.startsWith(`${agentStr}-`)
        ? acctPart
        : `${agentStr}-${acctPart}`;
      const parsedAcct = AccountId.safeParse(fullAccountId);
      if (!parsedAcct.success) {
        output(`Invalid orchestrator account '${acctPart}'.`);
        return ExitCode.InvalidUsage;
      }
      accountChoice = parsedAcct.data;
    }
  }

  const agentParsed = AgentId.safeParse(agentStr);
  if (!agentParsed.success) {
    output(`Invalid orchestrator agent '${agentStr}'. Supported agents: claude, codex, gemini, opencode, agy.`);
    return ExitCode.InvalidUsage;
  }

  // Parse on-limit policy
  const onLimitRaw = options.onLimit ?? 'switch-account';
  const limitParsed = LimitPolicy.safeParse(onLimitRaw);
  if (!limitParsed.success) {
    output(`Invalid on-limit policy '${onLimitRaw}'. Allowed: switch-account, switch-agent, ask.`);
    return ExitCode.InvalidUsage;
  }

  // Parse workers
  let workerAgents: AgentId[] = [agentParsed.data];
  if (options.workers) {
    const parts = options.workers.split(',').map((w) => w.trim()).filter((w) => w.length > 0);
    const parsedWorkers: AgentId[] = [];
    for (const part of parts) {
      const parsed = AgentId.safeParse(part);
      if (!parsed.success) {
        output(`Invalid worker agent '${part}'. Supported agents: claude, codex, gemini, opencode, agy.`);
        return ExitCode.InvalidUsage;
      }
      parsedWorkers.push(parsed.data);
    }
    if (parsedWorkers.length > 0) {
      workerAgents = parsedWorkers;
    }
  }

  const checkCommands = options.check ?? [];
  const spec: JobSpec = {
    mode: 'single',
    goal: trimmedGoal,
    repoPath: process.cwd(),
    checks: checkCommands.map((run) => ({ kind: 'command', run })),
    onLimit: limitParsed.data,
    orchestrator: {
      agent: agentParsed.data,
      account: accountChoice,
    },
    workers: workerAgents,
  };

  const startResult = await services.jobs.start(spec);
  if (!startResult.ok) {
    output(
      `Error: ${startResult.error.message}${startResult.error.fix ? `\nFix: ${startResult.error.fix}` : ''}`,
    );
    return ExitCode.ProblemFound;
  }

  const job = startResult.value;
  if (options.json) {
    output(JSON.stringify(job, null, 2));
    return ExitCode.Success;
  }

  output(`✓ started job ${job.id} · ${job.title}`);
  return ExitCode.Success;
}
