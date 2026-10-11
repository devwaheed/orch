/** The header actions for a run, chosen by its status (model/paneModel.ts runActions). */
import type { Run } from '@orch/contracts';
import { Icon } from '../../../../../../../design/icons/Icon.js';
import type { IconName } from '../../../../../../../design/icons/icons.js';
import { useWorkbenchStore } from '../../../services/workbenchStore.js';
import { openRunShell } from '../runShell.js';
import type { RunCommands } from '../hooks/useRunCommands.js';
import { type RunActionId, runActionIsDestructive, runActionLabel, runActions } from '../model/paneModel.js';
import styles from './panes.module.css';

const ICON: Record<RunActionId, IconName> = {
  pause: 'pause',
  stop: 'stop',
  shell: 'terminal',
  review: 'review',
  continue: 'history',
  startNow: 'play',
};

export function RunActions({ run, commands }: { readonly run: Run; readonly commands: RunCommands }) {
  const actions = runActions(run.status, run.worktree !== null);

  const perform = (action: RunActionId) => {
    switch (action) {
      case 'pause':
      case 'stop':
      case 'startNow':
        void commands.run(action);
        return;
      case 'shell':
        openRunShell(run);
        return;
      case 'review':
        useWorkbenchStore.getState().setActiveArea('review');
        return;
      case 'continue':
        // Opens Sessions; selecting this run's session is wired in S3 (Sessions).
        useWorkbenchStore.getState().setActiveArea('sessions');
        return;
      default:
        return assertNever(action);
    }
  };

  return (
    <div className={styles.actions}>
      {actions.map((action) => (
        <button
          key={action}
          type="button"
          title={runActionLabel(action)}
          className={`${styles.action} ${runActionIsDestructive(action) ? styles.actionDestructive : ''}`}
          onClick={() => perform(action)}
        >
          <Icon name={ICON[action]} size={13} weight={1.9} />
          {runActionLabel(action)}
        </button>
      ))}
    </div>
  );
}

function assertNever(value: never): never {
  throw new Error(`Unhandled run action: ${String(value)}`);
}
