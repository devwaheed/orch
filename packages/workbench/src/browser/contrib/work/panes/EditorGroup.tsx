/** One editor group: its tab strip (and the split button on the left group), then the active run pane. */
import type { RunId } from '@orchagents/contracts';
import { Icon } from '../../../../../../../design/icons/Icon.js';
import { useRunsStore } from '../../../services/stores/work.js';
import { agentBadge, runStatusView } from '../model/statusModel.js';
import { runTabTitle } from '../model/paneModel.js';
import type { PaneId } from '../model/paneState.js';
import { usePanesStore } from '../stores/panesStore.js';
import { AgentTile, StatusDot } from '../components/Badges.js';
import { cx } from '../components/cx.js';
import { workStrings } from '../strings.js';
import { RunPane } from './RunPane.js';

const FOCUS_RING = 'focus-visible:outline-2 focus-visible:outline-focus focus-visible:-outline-offset-2';

export function EditorGroup({ pane }: { readonly pane: PaneId }) {
  const tabs = usePanesStore((s) => (pane === 'A' ? s.tabsA : s.tabsB));
  const activeId = usePanesStore((s) => (pane === 'A' ? s.activeA : s.activeB));
  const split = usePanesStore((s) => s.split);
  const dispatch = usePanesStore((s) => s.dispatch);

  return (
    <section
      aria-label={workStrings.panes.groupLabel(pane === 'A' ? 1 : 2)}
      className="flex flex-col grow shrink basis-[380px] min-w-0 border-r border-line min-h-0"
      onPointerDown={() => dispatch({ type: 'focus', pane })}
    >
      <div className="flex items-stretch bg-chrome2 border-b border-line min-h-tab-h">
        <div className="flex flex-auto min-w-0 overflow-x-auto">
          {tabs.map((runId) => (
            <EditorTab key={runId} runId={runId} pane={pane} active={runId === activeId} />
          ))}
        </div>
        {pane === 'A' ? (
          <button
            type="button"
            className={cx(
              'flex items-center justify-center w-[38px] border-y-0 border-r-0 border-l border-line2 cursor-pointer',
              split ? 'text-text bg-sel' : 'bg-transparent text-muted',
              FOCUS_RING,
            )}
            aria-label={split ? workStrings.panes.splitClose : workStrings.panes.splitOpen}
            title={split ? workStrings.panes.splitClose : workStrings.panes.splitOpen}
            aria-pressed={split}
            onClick={() => dispatch({ type: 'toggleSplit' })}
          >
            <Icon name="split" size={15} weight={1.8} />
          </button>
        ) : null}
      </div>

      {activeId ? (
        <RunPane key={activeId} runId={activeId} />
      ) : (
        <div className="flex flex-auto flex-col items-center justify-center gap-3 p-9 text-muted2 text-center">
          <Icon name="terminal" size={28} weight={1.6} />
          <span>{workStrings.panes.emptyText}</span>
        </div>
      )}
    </section>
  );
}

interface EditorTabProps {
  readonly runId: RunId;
  readonly pane: PaneId;
  readonly active: boolean;
}

function EditorTab({ runId, pane, active }: EditorTabProps) {
  const run = useRunsStore((s) => s.runs.find((r) => r.id === runId));
  const dispatch = usePanesStore((s) => s.dispatch);
  if (!run) return null;
  const status = runStatusView(run.status);
  return (
    <div className={cx('flex items-center border-r border-line2', active && 'bg-term shadow-[inset_0_2px_0_var(--focus)]')}>
      <button
        type="button"
        className={cx(
          'flex items-center gap-7px h-tab-h py-0 pl-5 pr-2 border-0 bg-transparent text-sm whitespace-nowrap cursor-pointer',
          active ? 'text-text' : 'text-muted2',
          FOCUS_RING,
        )}
        aria-pressed={active}
        title={run.task}
        onClick={() => dispatch({ type: 'select', pane, runId })}
      >
        <AgentTile badge={agentBadge(run.agent)} size="tiny" />
        <span className="font-mono text-2xs">{run.id}</span>
        <span className="truncate max-w-[180px]">{runTabTitle(run.id, run.task, window.orch?.app.demo === true)}</span>
        <StatusDot view={status} />
      </button>
      <button
        type="button"
        className={cx('flex items-center justify-center w-[26px] h-[26px] mr-2 border-0 rounded-sm bg-transparent text-faint cursor-pointer', FOCUS_RING)}
        aria-label={workStrings.panes.closeTab(run.id)}
        onClick={() => dispatch({ type: 'close', pane, runId })}
      >
        <Icon name="close" size={11} weight={2.4} />
      </button>
    </div>
  );
}
