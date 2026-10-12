/** One editor group: its tab strip (and the split button on the left group), then the active run pane. */
import type { RunId } from '@orchagents/contracts';
import { Icon } from '../../../../../../../design/icons/Icon.js';
import { useRunsStore } from '../../../services/stores/work.js';
import { agentBadge, runStatusView } from '../model/statusModel.js';
import { runTabTitle } from '../model/paneModel.js';
import type { PaneId } from '../model/paneState.js';
import { usePanesStore } from '../stores/panesStore.js';
import { AgentTile, StatusDot } from '../components/Badges.js';
import { workStrings } from '../strings.js';
import { RunPane } from './RunPane.js';
import styles from './panes.module.css';

export function EditorGroup({ pane }: { readonly pane: PaneId }) {
  const tabs = usePanesStore((s) => (pane === 'A' ? s.tabsA : s.tabsB));
  const activeId = usePanesStore((s) => (pane === 'A' ? s.activeA : s.activeB));
  const split = usePanesStore((s) => s.split);
  const dispatch = usePanesStore((s) => s.dispatch);

  return (
    <section
      aria-label={workStrings.panes.groupLabel(pane === 'A' ? 1 : 2)}
      className={styles.group}
      onPointerDown={() => dispatch({ type: 'focus', pane })}
    >
      <div className={styles.tabBar}>
        <div className={styles.tabs}>
          {tabs.map((runId) => (
            <EditorTab key={runId} runId={runId} pane={pane} active={runId === activeId} />
          ))}
        </div>
        {pane === 'A' ? (
          <button
            type="button"
            className={`${styles.splitButton} ${split ? styles.splitButtonOn : ''}`}
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
        <div className={styles.emptyGroup}>
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
    <div className={`${styles.tab} ${active ? styles.tabActive : ''}`}>
      <button
        type="button"
        className={styles.tabSelect}
        aria-pressed={active}
        title={run.task}
        onClick={() => dispatch({ type: 'select', pane, runId })}
      >
        <AgentTile badge={agentBadge(run.agent)} size="tiny" />
        <span className={styles.tabId}>{run.id}</span>
        <span className={styles.tabTask}>{runTabTitle(run.id, run.task, window.orch?.app.demo === true)}</span>
        <StatusDot view={status} />
      </button>
      <button
        type="button"
        className={styles.tabClose}
        aria-label={workStrings.panes.closeTab(run.id)}
        onClick={() => dispatch({ type: 'close', pane, runId })}
      >
        <Icon name="close" size={11} weight={2.4} />
      </button>
    </div>
  );
}
