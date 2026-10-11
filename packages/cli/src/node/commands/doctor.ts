import { ExitCode } from '../../common/exitCodes.js';
import type { CliServices } from '../client.js';

export async function doctorCommand(
  services: CliServices,
  options: { json?: boolean | undefined },
  output: (msg: string) => void,
): Promise<number> {
  const result = await services.doctor.run();
  if (!result.ok) {
    output(
      `Error: ${result.error.message}${result.error.fix ? `\nFix: ${result.error.fix}` : ''}`,
    );
    return ExitCode.ProblemFound;
  }

  const report = result.value;

  if (options.json) {
    output(JSON.stringify(report, null, 2));
    const hasProblems = report.checks.some((c) => c.status !== 'pass');
    return hasProblems ? ExitCode.ProblemFound : ExitCode.Success;
  }

  const lines: string[] = [];
  for (const check of report.checks) {
    if (check.status === 'pass') {
      lines.push(`✓ ${check.title}`);
    } else if (check.status === 'warn') {
      lines.push(`! ${check.title}`);
      if (check.fix) {
        lines.push(`  Fix: ${check.fix}`);
      }
    } else {
      lines.push(`✗ ${check.title}`);
      if (check.fix) {
        lines.push(`  Fix: ${check.fix}`);
      }
    }
  }

  output(lines.join('\n'));

  const hasProblems = report.checks.some((c) => c.status === 'fail' || c.status === 'warn');
  return hasProblems ? ExitCode.ProblemFound : ExitCode.Success;
}
