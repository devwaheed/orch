import {
  AccountId,
  AgentId,
  JobMode,
  JobSpec,
  LimitPolicy,
} from '@orchagents/contracts';
import { ExitCode } from '../../common/exitCodes.js';
import type { CliServices } from '../client.js';

export interface RunCommandOptions {
  check?: string[] | undefined;
  webCheck?: string[] | undefined;
  allow?: string[] | undefined;
  orchestrator?: string | undefined;
  onLimit?: string | undefined;
  workers?: string | undefined;
  mode?: string | undefined;
  agents?: string | undefined;
  combine?: boolean | undefined;
  rounds?: string | undefined;
  planner?: string | undefined;
  coder?: string | undefined;
  reviewer?: string | undefined;
  json?: boolean | undefined;
}

const AGENT_HELP = 'claude, codex, gemini, opencode, agy';

function parseAgent(raw: string, label: string, output: (msg: string) => void): AgentId | null {
  const parsed = AgentId.safeParse(raw.trim());
  if (!parsed.success) {
    output(`Invalid ${label} agent '${raw}'. Supported agents: ${AGENT_HELP}.`);
    return null;
  }
  return parsed.data;
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

  const modeRaw = (options.mode ?? 'single').trim();
  const modeParsed = JobMode.safeParse(modeRaw);
  if (!modeParsed.success) {
    output(`Invalid mode '${modeRaw}'. Allowed: single, compare, council, autoloop.`);
    return ExitCode.InvalidUsage;
  }
  const mode = modeParsed.data;

  // Each mode accepts only the flags its `orch run` command line prints.
  if (mode !== 'compare' && mode !== 'council' && options.agents !== undefined) {
    output('--agents only applies to compare and council jobs.');
    return ExitCode.InvalidUsage;
  }
  if (mode !== 'compare' && options.combine === true) {
    output('--combine only applies to compare jobs.');
    return ExitCode.InvalidUsage;
  }
  if (mode !== 'council' && options.rounds !== undefined) {
    output('--rounds only applies to council jobs.');
    return ExitCode.InvalidUsage;
  }
  if (mode !== 'autoloop' && (options.planner !== undefined || options.coder !== undefined || options.reviewer !== undefined)) {
    output('--planner, --coder and --reviewer only apply to autoloop jobs.');
    return ExitCode.InvalidUsage;
  }

  // Parse on-limit policy
  const onLimitRaw = options.onLimit ?? 'switch-account';
  const limitParsed = LimitPolicy.safeParse(onLimitRaw);
  if (!limitParsed.success) {
    output(`Invalid on-limit policy '${onLimitRaw}'. Allowed: switch-account, switch-agent, ask.`);
    return ExitCode.InvalidUsage;
  }

  const checkCommands = options.check ?? [];
  const webChecks = options.webCheck ?? [];
  for (const address of webChecks) {
    let valid = false;
    try {
      const parsed = new URL(address);
      valid = parsed.protocol === 'http:' || parsed.protocol === 'https:';
    } catch {
      valid = false;
    }
    if (!valid) {
      output('--web-check needs an http(s) address, e.g. http://localhost:3000.');
      return ExitCode.InvalidUsage;
    }
  }
  const allowedGlobs = options.allow ?? [];
  const checks = [
    ...checkCommands.map((run) => ({ kind: 'command' as const, run })),
    ...webChecks.map((url) => ({ kind: 'http' as const, url, expectStatus: 200 })),
    ...(allowedGlobs.length > 0 ? [{ kind: 'file_rule' as const, allow: allowedGlobs }] : []),
  ];
  const base = {
    goal: trimmedGoal,
    repoPath: process.cwd(),
    checks,
    onLimit: limitParsed.data,
  };

  let candidate: unknown;

  if (mode === 'compare' || mode === 'council') {
    const agentNames = (options.agents ?? '')
      .split(',')
      .map((name) => name.trim())
      .filter((name) => name.length > 0);
    const agents: AgentId[] = [];
    for (const name of agentNames) {
      const agent = parseAgent(name, '--agents', output);
      if (agent === null) return ExitCode.InvalidUsage;
      agents.push(agent);
    }
    if (agents.length < 2) {
      output('--agents needs at least two agents, e.g. --agents claude,codex.');
      return ExitCode.InvalidUsage;
    }

    if (mode === 'compare') {
      candidate = { ...base, mode: 'compare', agents, combine: options.combine === true };
    } else {
      const roundsRaw = options.rounds ?? '5';
      const rounds = Number(roundsRaw);
      if (!Number.isInteger(rounds) || rounds < 1 || rounds > 10) {
        output(`--rounds needs a whole number from 1 to 10, not '${roundsRaw}'.`);
        return ExitCode.InvalidUsage;
      }
      candidate = { ...base, mode: 'council', agents, maxRounds: rounds };
    }
  } else if (mode === 'autoloop') {
    if (options.planner === undefined || options.coder === undefined || options.reviewer === undefined) {
      output('Autoloop jobs need --planner, --coder and --reviewer.');
      return ExitCode.InvalidUsage;
    }
    const planner = parseAgent(options.planner, '--planner', output);
    if (planner === null) return ExitCode.InvalidUsage;
    const coder = parseAgent(options.coder, '--coder', output);
    if (coder === null) return ExitCode.InvalidUsage;
    const reviewer = parseAgent(options.reviewer, '--reviewer', output);
    if (reviewer === null) return ExitCode.InvalidUsage;
    candidate = { ...base, mode: 'autoloop', roles: { planner, coder, reviewer } };
  } else {
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
      output(`Invalid orchestrator agent '${agentStr}'. Supported agents: ${AGENT_HELP}.`);
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
          output(`Invalid worker agent '${part}'. Supported agents: ${AGENT_HELP}.`);
          return ExitCode.InvalidUsage;
        }
        parsedWorkers.push(parsed.data);
      }
      if (parsedWorkers.length > 0) {
        workerAgents = parsedWorkers;
      }
    }

    candidate = {
      ...base,
      mode: 'single',
      orchestrator: {
        agent: agentParsed.data,
        account: accountChoice,
      },
      workers: workerAgents,
    };
  }

  const parsedSpec = JobSpec.safeParse(candidate);
  if (!parsedSpec.success) {
    const issue = parsedSpec.error.issues[0];
    const where = issue?.path.length ? ` (${issue.path.join('.')})` : '';
    output(`Invalid ${mode} job${where}: ${issue?.message ?? 'the job could not be built'}.`);
    return ExitCode.InvalidUsage;
  }

  const startResult = await services.jobs.start(parsedSpec.data);
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
