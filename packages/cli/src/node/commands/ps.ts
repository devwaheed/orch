import type { Job, Run } from '@orch/contracts';
import { ExitCode } from '../../common/exitCodes.js';
import { formatAgentAccount, formatStatus, formatTable } from '../../common/format.js';
import type { CliServices } from '../client.js';

export async function psCommand(
  services: CliServices,
  options: { json?: boolean | undefined },
  output: (msg: string) => void,
): Promise<number> {
  const jobsResult = await services.jobs.list();
  if (!jobsResult.ok) {
    output(
      `Error: ${jobsResult.error.message}${jobsResult.error.fix ? `\nFix: ${jobsResult.error.fix}` : ''}`,
    );
    return ExitCode.ProblemFound;
  }

  const jobs = jobsResult.value;
  const jobMap = new Map<string, Job>();
  for (const job of jobs) {
    jobMap.set(job.id, job);
  }

  const allRuns: Run[] = [];
  for (const job of jobs) {
    const runsResult = await services.runs.list(job.id);
    if (runsResult.ok) {
      allRuns.push(...runsResult.value);
    }
  }

  if (options.json) {
    output(JSON.stringify(allRuns, null, 2));
    return ExitCode.Success;
  }

  if (allRuns.length === 0) {
    output('No active runs.');
    return ExitCode.Success;
  }

  const headers = ['RUN', 'JOB', 'AGENT@ACCOUNT', 'STATUS', 'WORKTREE'];
  const rows = allRuns.map((run) => {
    const job = jobMap.get(run.jobId);
    const jobTitle = job ? job.title : run.jobId;
    const worktreeStr = run.worktree ?? (run.readOnly ? 'main (ro)' : '—');
    return [
      run.id,
      jobTitle,
      formatAgentAccount(run.agent, run.accountId),
      formatStatus(run.status),
      worktreeStr,
    ];
  });

  output(formatTable(headers, rows));
  return ExitCode.Success;
}
