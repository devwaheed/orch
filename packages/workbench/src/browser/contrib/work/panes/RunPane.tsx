/** An agent pane: header, paused-by-limit slot, output, and the message box for one run. */
import { useMemo } from 'react';
import type { RunId } from '@orchagents/contracts';
import { useAccountsStore } from '../../../services/stores/accounts.js';
import { useJobsStore, useRunsStore } from '../../../services/stores/work.js';
import { useSpecsStore } from '../../../services/stores/specs.js';
import { useRunCatchUp } from '../hooks/useRunCatchUp.js';
import { useRunCommands } from '../hooks/useRunCommands.js';
import { agentDisplayName, whereLabel } from '../model/paneModel.js';
import { buildSpecJobMap } from '../model/sidebarModel.js';
import { agentBadge, runStatusView } from '../model/statusModel.js';
import { AgentTile, StatusPill } from '../components/Badges.js';
import { workStrings } from '../strings.js';
import { Icon } from '../../../../../../../design/icons/Icon.js';
import { PausedLimitSlot } from './PausedLimitSlot.js';
import { PlanApprovalSlot } from './PlanApprovalSlot.js';
import { SpecFixSlot } from './SpecFixSlot.js';
import { RunActions } from './RunActions.js';
import { RunOutput } from './RunOutput.js';
import { MessageBox } from './MessageBox.js';

export function RunPane({ runId }: { readonly runId: RunId }) {
  const run = useRunsStore((s) => s.runs.find((r) => r.id === runId));
  const job = useJobsStore((s) => s.jobs.find((j) => j.id === run?.jobId));
  const queues = useSpecsStore((s) => s.queues);
  const agentInfo = useAccountsStore((s) => s.agents.find((a) => a.id === run?.agent));
  const account = useAccountsStore((s) => s.accounts.find((a) => a.id === run?.accountId));
  const loadError = useRunCatchUp(runId);
  const commands = useRunCommands(runId);

  const spec = useMemo(() => {
    if (!job) return undefined;
    return buildSpecJobMap(queues)(job);
  }, [job, queues]);

  if (!run) return null;

  const agentName = agentDisplayName(run.agent, agentInfo?.displayName);
  const accountName = account?.name ?? run.accountId;
  const status = runStatusView(run.status);
  const error = commands.error ?? loadError;
  const title = spec ? `${spec.id} · ${spec.spec.title} · try ${spec.attempt ?? 1}` : run.task;

  return (
    <div className="flex flex-col flex-auto min-h-0">
      <header className="flex flex-wrap items-center gap-4 px-6 py-5 border-b border-line2 bg-chrome">
        <AgentTile badge={agentBadge(run.agent)} size="large" />
        <div className="grow shrink basis-[200px] min-w-0 flex flex-col gap-1px">
          <div className="flex items-center gap-3 min-w-0">
            <h2 className="m-0 text-md font-semibold truncate">{title}</h2>
            <StatusPill view={status} />
          </div>
          <div className="flex flex-wrap gap-x-5 gap-y-1 text-muted2 text-11px">
            <span>{`${agentName} · ${accountName}`}</span>
            <span className="inline-flex items-center gap-1 font-mono">
              <Icon name="branch" size={11} weight={2} />
              {whereLabel({ readOnly: run.readOnly, worktree: run.worktree })}
            </span>
            <span className="inline-flex items-center gap-1 font-mono">
              <Icon name="history" size={11} weight={2} />
              {run.sessionId ?? workStrings.panes.noSession}
            </span>
          </div>
        </div>
        <RunActions run={run} commands={commands} />
      </header>

      {error ? (
        <p role="alert" className="flex flex-col gap-1 mx-6 mt-5 mb-0 p-4 rounded-lg border border-err-line bg-err-bg text-err-strong text-xs">
          <span>{error.message}</span>
          {error.fix ? <span>{error.fix}</span> : null}
        </p>
      ) : null}

      <PausedLimitSlot run={run} />

      <PlanApprovalSlot jobId={run.jobId} />

      <SpecFixSlot run={run} />

      <RunOutput runId={run.id} working={run.status === 'running'} />

      <MessageBox run={run} agentName={agentName} commands={commands} />
    </div>
  );
}
