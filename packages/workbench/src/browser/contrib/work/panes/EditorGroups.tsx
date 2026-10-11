/** The editor area: one group, or two when split (⌘\ and the split button). */
import { usePanesStore } from '../stores/panesStore.js';
import type { PaneId } from '../model/paneState.js';
import { EditorGroup } from './EditorGroup.js';
import styles from './panes.module.css';

export function EditorGroups() {
  const split = usePanesStore((s) => s.split);
  const panes: readonly PaneId[] = split ? ['A', 'B'] : ['A'];
  return (
    <div className={styles.groups}>
      {panes.map((pane) => (
        <EditorGroup key={pane} pane={pane} />
      ))}
    </div>
  );
}
