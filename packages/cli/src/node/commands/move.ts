/**
 * `orch move <run> --to <agent@account>` (CLI-01, CLI-02, CLI-03).
 *
 * Move a run to another account now. Maps exactly to IRunsService.resumeOn(runId, accountId)
 * (contract comment: "Paused-by-limit card: move to another account now").
 */
import { AccountId, RunId } from '@orch/contracts';
import { ExitCode } from '../../common/exitCodes.js';
import { formatAgentAccount } from '../../common/format.js';
import type { CliServices } from '../client.js';
import { accountIdFromChoice } from './resume.js';

export interface MoveCommandOptions {
  to?: string | undefined;
  json?: boolean | undefined;
}

function errorLines(error: { message: string; fix?: string | undefined }): string {
  return `Error: ${error.message}${error.fix ? `\nFix: ${error.fix}` : ''}`;
}

export async function moveCommand(
  services: Pick<CliServices, 'runs'>,
  runArg: string,
  options: MoveCommandOptions,
  output: (msg: string) => void,
): Promise<number> {
  if (!options.to) {
    output(
      errorLines({
        message: 'Missing required option --to.',
        fix: 'Use --to agent@account, such as codex@team. Run orch accounts to see them.',
      }),
    );
    return ExitCode.InvalidUsage;
  }

  const parsedRunId = RunId.safeParse(runArg);
  if (!parsedRunId.success) {
    output(
      errorLines({
        message: `${runArg} is not a run id.`,
        fix: 'Use an id from orch ps, such as r-02.',
      }),
    );
    return ExitCode.InvalidUsage;
  }
  const runId = parsedRunId.data;

  const parsedAccountId = AccountId.safeParse(accountIdFromChoice(options.to));
  if (!parsedAccountId.success) {
    output(
      errorLines({
        message: `${options.to} is not an account.`,
        fix: 'Use agent@account, such as codex@team. Run orch accounts to see them.',
      }),
    );
    return ExitCode.InvalidUsage;
  }
  const accountId = parsedAccountId.data;

  const result = await services.runs.resumeOn(runId, accountId);
  if (!result.ok) {
    output(errorLines(result.error));
    return result.error.code === 'validation_failed' ? ExitCode.InvalidUsage : ExitCode.ProblemFound;
  }

  if (options.json) {
    output(JSON.stringify(result.value, null, 2));
    return ExitCode.Success;
  }

  const moved = result.value;
  output(`✓ moved ${moved.id} to ${formatAgentAccount(moved.agent, moved.accountId)}`);
  return ExitCode.Success;
}
