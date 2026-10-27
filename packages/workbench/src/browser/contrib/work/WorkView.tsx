/**
 * The Work route: jobs sidebar on the left, editor groups on the right.
 * Also keeps the shell's split flag and ⌘W in step with the editor groups.
 */
import { useEffect } from 'react';
import { matchesShortcut } from '../../services/shortcuts.js';
import { useWorkbenchStore } from '../../services/workbenchStore.js';
import { JobsSidebar } from './sidebar/JobsSidebar.js';
import { EditorGroups } from './panes/EditorGroups.js';
import { TerminalDock } from '../../parts/terminal/index.js';
import { usePanesStore } from './stores/panesStore.js';

export function WorkView() {
  useDemoPaneSeed();
  useShellSplitSync();
  useCloseTabShortcut();
  return (
    <div className="flex flex-auto min-h-0 min-w-0 in-data-[menu-side=right]:flex-row-reverse">
      <JobsSidebar />
      <div className="flex flex-1 flex-col min-w-0 min-h-0">
        <EditorGroups />
        <TerminalDock />
      </div>
    </div>
  );
}

/** A renderer reload or theme reload must start from the same demo tabs and active runs. */
function useDemoPaneSeed(): void {
  useEffect(() => {
    if (window.orch?.app.demo === true) {
      usePanesStore.getState().dispatch({ type: 'resetDemo' });
    }
  }, []);
}

/**
 * ⌘\ and the palette's "Split editor" toggle the shell's splitOpen flag. The groups
 * apply it when they can split (two tabs needed), and write back what they show.
 */
function useShellSplitSync(): void {
  const shellSplit = useWorkbenchStore((s) => s.splitOpen);
  const split = usePanesStore((s) => s.split);

  useEffect(() => {
    usePanesStore.getState().dispatch({ type: 'setSplit', split: shellSplit });
  }, [shellSplit]);

  // Reads the store, not the render value: the effect above may have just changed it.
  useEffect(() => {
    const current = usePanesStore.getState().split;
    if (useWorkbenchStore.getState().splitOpen !== current) {
      useWorkbenchStore.setState({ splitOpen: current });
    }
  }, [split, shellSplit]);
}

/** ⌘W closes the active tab of the group that has focus (UI-05). */
function useCloseTabShortcut(): void {
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (!matchesShortcut(event, 'closeTab')) return;
      const state = usePanesStore.getState();
      const runId = state.focused === 'A' ? state.activeA : state.activeB;
      if (!runId) return;
      event.preventDefault();
      state.dispatch({ type: 'close', pane: state.focused, runId });
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);
}
