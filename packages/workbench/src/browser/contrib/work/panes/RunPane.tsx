/** An agent pane: header, paused-by-limit slot, output, and the message box for one run. */
import type { RunId } from '@orch/contracts';
import { useAccountsStore } from '../../../services/stores/accounts.js';
import { useRunsStore } from '../../../services/stores/work.js';
import { useRunCatchUp } from '../hooks/useRunCatchUp.js';
import { useRunCommands } from '../hooks/useRunCommands.js';
import { agentDisplayName, whereLabel } from '../model/paneModel.js';
import { agentBadge, runStatusView } from '../model/statusModel.js';
import { AgentTile, StatusPill } from '../components/Badges.js';
import { workStrings } from '../strings.js';
import { Icon } from '../../../../../../../design/icons/Icon.js';
import { PausedLimitSlot } from './PausedLimitSlot.js';
import { RunActions } from './RunActions.js';
import { RunOutput } from './RunOutput.js';
import { MessageBox } from './MessageBox.js';
import styles from './panes.module.css';

export function RunPane({ runId }: { readonly runId: RunId }) {
  const run = useRunsStore((s) => s.runs.find((r) => r.id === runId));
  const agentInfo = useAccountsStore((s) => s.agents.find((a) => a.id === run?.agent));
  const account = useAccountsStore((s) => s.accounts.find((a) => a.id === run?.accountId));
  const loadError = useRunCatchUp(runId);
  const commands = useRunCommands(runId);

  if (!run) return null;

  const agentName = agentDisplayName(run.agent, agentInfo?.displayName);
  const accountName = account?.name ?? run.accountId;
  const status = runStatusView(run.status);
  const error = commands.error ?? loadError;

  return (
    <div className={styles.runPane}>
      <header className={styles.paneHeader}>
        <AgentTile badge={agentBadge(run.agent)} size="large" />
        <div className={styles.headerMain}>
          <div className={styles.titleLine}>
            <h2 className={styles.paneTitle}>{run.task}</h2>
            <StatusPill view={status} />
          </div>
          <div className={styles.metaLine}>
            <span>{`${agentName} · ${accountName}`}</span>
            <span className={styles.mono}>
              <Icon name="branch" size={11} weight={2} />
              {whereLabel({ readOnly: run.readOnly, worktree: run.worktree })}
            </span>
            <span className={styles.mono}>
              <Icon name="history" size={11} weight={2} />
              {run.sessionId ?? workStrings.panes.noSession}
            </span>
          </div>
        </div>
        <RunActions run={run} commands={commands} />
      </header>

      {error ? (
        <p role="alert" className={styles.error}>
          <span>{error.message}</span>
          {error.fix ? <span>{error.fix}</span> : null}
        </p>
      ) : null}

      <PausedLimitSlot runId={run.id} status={run.status} />

      <RunOutput runId={run.id} working={run.status === 'running'} />

      <MessageBox run={run} agentName={agentName} commands={commands} />
    </div>
  );
}
