/** The header actions for a run, chosen by its status (model/paneModel.ts runActions). */
import type { Run } from '@orchagents/contracts';
import { Icon } from '../../../../../../../design/icons/Icon.js';
import type { IconName } from '../../../../../../../design/icons/icons.js';
import { useWorkbenchStore } from '../../../services/workbenchStore.js';
import { openRunShell } from '../runShell.js';
import type { RunCommands } from '../hooks/useRunCommands.js';
import { type RunActionId, runActionIsDestructive, runActionLabel, runActions } from '../model/paneModel.js';
import { cx } from '../components/cx.js';

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
    <div className="flex flex-wrap gap-1">
      {actions.map((action) => (
        <button
          key={action}
          type="button"
          title={runActionLabel(action)}
          className={cx(
            'flex items-center gap-5px min-h-[30px] px-9px py-5px border border-btnline rounded-sm bg-btn text-sm cursor-pointer',
            'focus-visible:outline-2 focus-visible:outline-focus focus-visible:-outline-offset-2',
            runActionIsDestructive(action) ? 'text-err' : 'text-text2',
          )}
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
