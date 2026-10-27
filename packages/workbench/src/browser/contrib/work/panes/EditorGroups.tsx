/** The editor area: one group, or two when split (⌘\ and the split button). */
import { usePanesStore } from '../stores/panesStore.js';
import type { PaneId } from '../model/paneState.js';
import { EditorGroup } from './EditorGroup.js';

export function EditorGroups() {
  const split = usePanesStore((s) => s.split);
  const panes: readonly PaneId[] = split ? ['A', 'B'] : ['A'];
  return (
    <div className="flex flex-auto flex-wrap items-stretch min-w-0 min-h-0">
      {panes.map((pane) => (
        <EditorGroup key={pane} pane={pane} />
      ))}
    </div>
  );
}
