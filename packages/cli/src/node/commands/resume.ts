/**
 * `orch resume <session> [--to <agent@account>] [--fork]` (CLI-01, SES-01..SES-03).
 *
 * With no flag: a limited session shows the four options (design/prototype/
 * Terminal.dc.html) when a person is at the terminal, and otherwise takes the
 * default option. `--to` hands off to that account, or to that agent when it
 * is a different agent. `--fork` forks.
 */
import { createInterface } from 'node:readline/promises';
import {
  AccountId,
  SessionId,
  type ResumeMode,
  type ResumeOption,
  type ResumeRequest,
  type Session,
} from '@orch/contracts';
import { ExitCode } from '../../common/exitCodes.js';
import { formatAgentAccount } from '../../common/format.js';
import type { CliServices } from '../client.js';

export interface ResumeCommandOptions {
  to?: string | undefined;
  fork?: boolean | undefined;
  json?: boolean | undefined;
}

/** Asks one question at the terminal and returns the answer, or null when there is no terminal to answer. */
export type AskQuestion = (question: string) => Promise<string | null>;

/** The menu rows in artboard order: 1 continue, 2 hand off to account, 3 hand off to agent, 4 fork. */
const MENU_MODES: readonly ResumeMode[] = ['same', 'account', 'agent', 'fork'];

/** `codex@team` becomes `codex-team`. An id already in account form is returned as it is. */
export function accountIdFromChoice(choice: string): string {
  const at = choice.indexOf('@');
  return at === -1 ? choice.trim() : `${choice.slice(0, at)}-${choice.slice(at + 1)}`.trim();
}

/** The same rule as the platform's defaultResumeMode, restated here because the CLI imports only contracts. */
export function defaultMode(options: readonly ResumeOption[]): ResumeMode | null {
  const by = (mode: ResumeMode) => options.find((o) => o.mode === mode);
  const same = by('same');
  const account = by('account');
  if (same?.waitsUntil && account?.available) return 'account';
  if (same?.available) return 'same';
  return options.find((o) => o.available)?.mode ?? null;
}

/** Local HH:MM for a reset time, as the prototype shows it ("15:00"). */
export function clockOf(iso: string): string {
  const d = new Date(iso);
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

function shortAccount(session: Pick<Session, 'agent' | 'accountId'>): string {
  return formatAgentAccount(session.agent, session.accountId);
}

/** The four lines of the prototype's resume prompt (Terminal.dc.html), with its wording. */
export function menuLines(session: Session, options: readonly ResumeOption[], defaultNumber: number): string[] {
  const byMode = (mode: ResumeMode) => options.find((o) => o.mode === mode);
  const same = byMode('same');
  const account = byMode('account');
  const agent = byMode('agent');
  const fork = byMode('fork');
  const rows: string[] = [];
  if (same?.waitsUntil) {
    rows.push(`! ${shortAccount(session)} is limited until ${clockOf(same.waitsUntil)}`);
  }
  const row = (n: number, text: string, note: string, option: ResumeOption | undefined): string => {
    if (!option?.available) return `  ${n}) ${text.padEnd(42)}unavailable: ${option?.description ?? ''}`;
    return note ? `  ${n}) ${text.padEnd(42)}${note}` : `  ${n}) ${text}`;
  };
  rows.push(
    row(
      1,
      same?.waitsUntil ? `wait and continue ${session.id} at ${clockOf(same.waitsUntil)}` : `continue ${session.id}`,
      'full history',
      same,
    ),
  );
  const accountTarget = account?.target ?? null;
  const agentTarget = agent?.target ?? null;
  rows.push(
    row(
      2,
      `hand off to ${accountTarget ? formatAgentAccount(session.agent, accountTarget) : 'another account'} now`,
      'same worktree + summary',
      account,
    ),
  );
  rows.push(
    row(
      3,
      `hand off to ${agentTarget ? formatAgentAccount(agentTarget.split('-')[0] ?? '', agentTarget) : 'another agent'} now`,
      'summary + job plan',
      agent,
    ),
  );
  rows.push(row(4, 'fork into a new worktree', '', fork));
  rows.push(`  choose [${defaultNumber}]: `);
  return rows;
}

function errorLines(error: { message: string; fix?: string | undefined }): string {
  return `Error: ${error.message}${error.fix ? `\nFix: ${error.fix}` : ''}`;
}

export async function resumeCommand(
  services: Pick<CliServices, 'sessions'>,
  sessionArg: string,
  options: ResumeCommandOptions,
  output: (msg: string) => void,
  ask?: AskQuestion,
): Promise<number> {
  const parsedId = SessionId.safeParse(sessionArg);
  if (!parsedId.success) {
    output(`Error: ${sessionArg} is not a session id.\nFix: Use an id from orch sessions, such as s-91e0.`);
    return ExitCode.InvalidUsage;
  }
  const sessionId = parsedId.data;

  const got = await services.sessions.get(sessionId);
  if (!got.ok) {
    output(errorLines(got.error));
    return ExitCode.ProblemFound;
  }
  const session = got.value;

  let request: ResumeRequest;
  if (options.fork) {
    request = { mode: 'fork', sessionId };
  } else if (options.to !== undefined) {
    const to = AccountId.safeParse(accountIdFromChoice(options.to));
    if (!to.success) {
      output(`Error: ${options.to} is not an account.\nFix: Use agent@account, such as codex@team. Run orch accounts to see them.`);
      return ExitCode.InvalidUsage;
    }
    const agent = to.data.split('-')[0];
    request = agent === session.agent ? { mode: 'account', sessionId, to: to.data } : { mode: 'agent', sessionId, to: to.data };
  } else {
    const optionsRes = await services.sessions.resumeOptions(sessionId);
    if (!optionsRes.ok) {
      output(errorLines(optionsRes.error));
      return ExitCode.ProblemFound;
    }
    const list = optionsRes.value;
    let chosen: ResumeMode | null = defaultMode(list);
    const sameWaits = list.find((o) => o.mode === 'same')?.waitsUntil;
    if (sameWaits && ask) {
      const defaultNumber = chosen ? MENU_MODES.indexOf(chosen) + 1 : 1;
      const lines = menuLines(session, list, defaultNumber);
      for (const line of lines.slice(0, -1)) output(line);
      const answer = await ask(lines[lines.length - 1] ?? `  choose [${defaultNumber}]: `);
      if (answer === null) {
        output('No option chosen. Nothing was resumed.');
        return ExitCode.InvalidUsage;
      }
      const number = answer.trim() === '' ? defaultNumber : Number(answer.trim());
      const picked = Number.isInteger(number) ? MENU_MODES[number - 1] : undefined;
      if (!picked) {
        output('Pick a number from 1 to 4.');
        return ExitCode.InvalidUsage;
      }
      chosen = picked;
    }
    if (!chosen) {
      output(errorLines({ message: `No resume option is available for ${sessionId}.`, fix: 'Start a new job instead.' }));
      return ExitCode.ProblemFound;
    }
    switch (chosen) {
      case 'same':
      case 'fork':
        request = { mode: chosen, sessionId };
        break;
      case 'account':
      case 'agent': {
        const target = list.find((o) => o.mode === chosen)?.target ?? null;
        if (!target) {
          output(errorLines({ message: `No account can take ${sessionId} right now.`, fix: 'Wait for an account to have room, or pass --to.' }));
          return ExitCode.ProblemFound;
        }
        request = { mode: chosen, sessionId, to: target };
        break;
      }
    }
  }

  const result = await services.sessions.resume(request);
  if (!result.ok) {
    output(errorLines(result.error));
    return result.error.code === 'validation_failed' ? ExitCode.InvalidUsage : ExitCode.ProblemFound;
  }

  if (options.json) {
    output(JSON.stringify(result.value, null, 2));
    return ExitCode.Success;
  }
  const started = result.value;
  if (started.id === session.id) {
    if (started.status === 'paused') {
      output(`✓ ${session.id} waits for ${shortAccount(started)} to reset, then continues.`);
    } else {
      output(`✓ reopened ${session.agent} session ${session.id} on ${shortAccount(started)} · worktree ${started.worktree ?? '—'} intact`);
    }
  } else {
    output(`✓ started ${started.id} on ${shortAccount(started)} in ${started.worktree ?? '—'}`);
  }
  return ExitCode.Success;
}

/** Reads one line from the terminal. The caller passes this only when stdin is a terminal. */
export async function askInTerminal(question: string): Promise<string | null> {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  try {
    return await rl.question(question);
  } finally {
    rl.close();
  }
}
