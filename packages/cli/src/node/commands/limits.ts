import { ExitCode } from '../../common/exitCodes.js';
import { formatTable, formatTimestampTime } from '../../common/format.js';
import type { CliServices } from '../client.js';

export async function limitsCommand(
  services: CliServices,
  options: { json?: boolean | undefined },
  output: (msg: string) => void,
): Promise<number> {
  const result = await services.quota.windows();
  if (!result.ok) {
    output(
      `Error: ${result.error.message}${result.error.fix ? `\nFix: ${result.error.fix}` : ''}`,
    );
    return ExitCode.ProblemFound;
  }

  const windows = result.value;

  if (options.json) {
    output(JSON.stringify(windows, null, 2));
    return ExitCode.Success;
  }

  if (windows.length === 0) {
    output('No limits recorded.');
    return ExitCode.Success;
  }

  const headers = ['ACCOUNT', 'WINDOW', 'USED', 'RESETS', 'SOURCE'];
  const rows = windows.map((w) => {
    const dashIdx = w.accountId.indexOf('-');
    const accountDisplay =
      dashIdx !== -1
        ? `${w.accountId.slice(0, dashIdx)}@${w.accountId.slice(dashIdx + 1)}`
        : w.accountId;
    return [
      accountDisplay,
      w.window,
      `${Math.round(w.usedPct)}%`,
      formatTimestampTime(w.resetsAt),
      w.source,
    ];
  });

  output(formatTable(headers, rows));
  return ExitCode.Success;
}
