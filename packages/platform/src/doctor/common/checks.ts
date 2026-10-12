/**
 * Pure pass / warn / fail rules for each doctor check. The node service gathers
 * the facts (command output, pings, folder states); these functions decide.
 * Plain TypeScript; no Node APIs.
 */
import type { AgentId, DoctorCheck, Result } from '@orchagents/contracts';
import { DOCTOR_COPY } from './strings.js';
import { formatVersion, parseVersion, satisfiesRange } from './versionRange.js';
import type { ProcessOutcome } from './doctor.js';

/** The command ran and exited 0. */
export function commandSucceeded(outcome: ProcessOutcome): outcome is Extract<ProcessOutcome, { kind: 'ran' }> {
  return outcome.kind === 'ran' && outcome.exitCode === 0;
}

export interface AgentVersionInput {
  agent: AgentId;
  name: string;
  command: string;
  testedVersions: string;
  outcome: ProcessOutcome;
}

export function agentVersionCheck(input: AgentVersionInput): DoctorCheck {
  const { agent, name, command, testedVersions, outcome } = input;
  const id = `agent.${agent}`;

  if (outcome.kind === 'not_found') {
    return {
      id,
      agent,
      title: DOCTOR_COPY.agent.notInstalled(name),
      status: 'warn',
      fix: DOCTOR_COPY.agent.notInstalledFix(name, command),
    };
  }
  if (outcome.kind === 'did_not_start' || outcome.exitCode !== 0) {
    return {
      id,
      agent,
      title: DOCTOR_COPY.agent.didNotStart(name),
      status: 'fail',
      fix: DOCTOR_COPY.agent.didNotStartFix(command),
    };
  }

  const version = parseVersion(outcome.stdout) ?? parseVersion(outcome.stderr);
  if (!version) {
    return {
      id,
      agent,
      title: DOCTOR_COPY.agent.unreadableVersion(name),
      status: 'warn',
      fix: DOCTOR_COPY.agent.unreadableVersionFix(name, command),
    };
  }

  const shown = formatVersion(version);
  const inRange = satisfiesRange(version, testedVersions);
  if (inRange === null) {
    return {
      id,
      agent,
      title: DOCTOR_COPY.agent.uncomparableRange(name, shown),
      status: 'warn',
      fix: DOCTOR_COPY.agent.uncomparableRangeFix,
    };
  }
  if (!inRange) {
    return {
      id,
      agent,
      title: DOCTOR_COPY.agent.outOfRange(name, shown, testedVersions),
      status: 'warn',
      fix: DOCTOR_COPY.agent.outOfRangeFix(testedVersions),
    };
  }
  return { id, agent, title: DOCTOR_COPY.agent.installed(name, shown), status: 'pass' };
}

export function gitCheck(outcome: ProcessOutcome): DoctorCheck {
  if (outcome.kind === 'not_found') {
    return { id: 'git', title: DOCTOR_COPY.git.notInstalled, status: 'fail', fix: DOCTOR_COPY.git.notInstalledFix };
  }
  if (!commandSucceeded(outcome)) {
    return { id: 'git', title: DOCTOR_COPY.git.didNotStart, status: 'fail', fix: DOCTOR_COPY.git.didNotStartFix };
  }
  return { id: 'git', title: DOCTOR_COPY.git.installed, status: 'pass' };
}

/** `outcome` is the result of `git worktree list` in a throwaway repo, or 'untested' if that repo could not be made. */
export function worktreeCheck(outcome: ProcessOutcome | 'untested'): DoctorCheck {
  if (outcome === 'untested') {
    return {
      id: 'git.worktrees',
      title: DOCTOR_COPY.worktrees.untested,
      status: 'warn',
      fix: DOCTOR_COPY.worktrees.untestedFix,
    };
  }
  if (!commandSucceeded(outcome)) {
    return {
      id: 'git.worktrees',
      title: DOCTOR_COPY.worktrees.broken,
      status: 'fail',
      fix: DOCTOR_COPY.worktrees.brokenFix,
    };
  }
  return { id: 'git.worktrees', title: DOCTOR_COPY.worktrees.works, status: 'pass' };
}

export function engineCheck(ping: Result<{ engineVersion: string }>, expectedVersion?: string): DoctorCheck {
  if (!ping.ok) {
    return {
      id: 'engine',
      title: DOCTOR_COPY.engine.notRunning,
      status: 'fail',
      fix: DOCTOR_COPY.engine.notRunningFix,
    };
  }
  const found = ping.value.engineVersion;
  if (expectedVersion !== undefined && found !== expectedVersion) {
    return {
      id: 'engine',
      title: DOCTOR_COPY.engine.versionMismatch(found, expectedVersion),
      status: 'warn',
      fix: DOCTOR_COPY.engine.versionMismatchFix,
    };
  }
  return { id: 'engine', title: DOCTOR_COPY.engine.running, status: 'pass' };
}

export interface IsolationInput {
  agent: AgentId;
  name: string;
  /** false when the agent has no who-am-I command: it cannot be checked automatically */
  supported: boolean;
  /** Masked identities of the two throwaway accounts; null when not confirmed. */
  first: string | null;
  second: string | null;
}

/**
 * Compares the masked identities. Masking keeps only the first character and the
 * domain, so two different accounts can look the same here; that is reported as
 * a shared sign-in, the safe side.
 */
export function isolationCheck(input: IsolationInput): DoctorCheck {
  const { agent, name } = input;
  const id = `isolation.${agent}`;
  if (!input.supported) {
    return {
      id,
      agent,
      title: DOCTOR_COPY.isolation.unsupported(name),
      status: 'warn',
      fix: DOCTOR_COPY.isolation.unsupportedFix(name),
    };
  }
  if (input.first === null || input.second === null) {
    return {
      id,
      agent,
      title: DOCTOR_COPY.isolation.unconfirmed(name),
      status: 'fail',
      fix: DOCTOR_COPY.isolation.unconfirmedFix(name),
    };
  }
  if (input.first === input.second) {
    return {
      id,
      agent,
      title: DOCTOR_COPY.isolation.shared(name),
      status: 'fail',
      fix: DOCTOR_COPY.isolation.sharedFix(name),
    };
  }
  return { id, agent, title: DOCTOR_COPY.isolation.verified(name), status: 'pass' };
}

export function signInFailedCheck(agent: AgentId, name: string, fix: string | undefined): DoctorCheck {
  return {
    id: `isolation.${agent}`,
    agent,
    title: DOCTOR_COPY.isolation.signInNotDone(name),
    status: 'fail',
    fix: fix ?? DOCTOR_COPY.isolation.signInNotDoneFix,
  };
}

export interface SkillsInput {
  agent: AgentId;
  name: string;
  /** Whether the user's shared skills folder exists. ACC-09: no link is made without it. */
  sharedExists: boolean;
  /** Whether the profile's link is a link to the shared folder; 'untested' when the test profile could not be made. */
  linked: boolean | 'untested';
}

export function skillsCheck(input: SkillsInput): DoctorCheck {
  const { agent, name } = input;
  const id = `skills.${agent}`;
  if (input.linked === 'untested') {
    return { id, agent, title: DOCTOR_COPY.skills.untested(name), status: 'warn', fix: DOCTOR_COPY.skills.untestedFix };
  }
  if (!input.sharedExists) {
    return { id, agent, title: DOCTOR_COPY.skills.nothingToShare(name), status: 'pass' };
  }
  if (!input.linked) {
    return {
      id,
      agent,
      title: DOCTOR_COPY.skills.notVisible(name),
      status: 'fail',
      fix: DOCTOR_COPY.skills.notVisibleFix,
    };
  }
  return { id, agent, title: DOCTOR_COPY.skills.visible(name), status: 'pass' };
}

export function diskCheck(freeBytes: number | null, minFreeBytes: number): DoctorCheck {
  if (freeBytes === null) {
    return { id: 'disk', title: DOCTOR_COPY.disk.unmeasured, status: 'warn', fix: DOCTOR_COPY.disk.unmeasuredFix };
  }
  if (freeBytes < minFreeBytes) {
    return { id: 'disk', title: DOCTOR_COPY.disk.notEnough, status: 'fail', fix: DOCTOR_COPY.disk.notEnoughFix };
  }
  return { id: 'disk', title: DOCTOR_COPY.disk.enough, status: 'pass' };
}
