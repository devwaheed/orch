import { ExitCode } from '../../common/exitCodes.js';
import { formatAgentAccount, formatStatus, formatTable, formatTimestampTime } from '../../common/format.js';
import type { CliServices } from '../client.js';

export async function sessionsCommand(
  services: CliServices,
  options: { resumable?: boolean | undefined; json?: boolean | undefined },
  output: (msg: string) => void,
): Promise<number> {
  const filter = options.resumable ? 'resumable' : 'all';
  const result = await services.sessions.list(filter);
  if (!result.ok) {
    output(
      `Error: ${result.error.message}${result.error.fix ? `\nFix: ${result.error.fix}` : ''}`,
    );
    return ExitCode.ProblemFound;
  }

  const sessions = result.value;

  if (options.json) {
    output(JSON.stringify(sessions, null, 2));
    return ExitCode.Success;
  }

  if (sessions.length === 0) {
    output('No sessions found.');
    return ExitCode.Success;
  }

  const headers = ['SESSION', 'JOB', 'AGENT@ACCOUNT', 'STATUS', 'LAST', 'WORKTREE'];
  const rows = sessions.map((s) => {
    return [
      s.id,
      s.title,
      formatAgentAccount(s.agent, s.accountId),
      formatStatus(s.status),
      formatTimestampTime(s.lastActivityAt),
      s.worktree ?? '—',
    ];
  });

  output(formatTable(headers, rows));
  return ExitCode.Success;
}
