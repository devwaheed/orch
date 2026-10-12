/**
 * Connects the terminal dock to the data layer: one controller per window, fed by
 * shell.output and shell.exited from the events channel.
 */
import type { OrchEvent } from '@orchagents/contracts';
import { useWorkbenchStore } from '../../services/workbenchStore.js';
import { TerminalController, type TerminalShells } from './terminalController.js';
import { createXterm } from './xtermAdapter.js';

let active: TerminalController | null = null;

/** Starts the terminal service. Returns a function that stops it. */
export function startTerminalService(
  shells: TerminalShells,
  subscribe: (listener: (event: OrchEvent) => void) => () => void,
): () => void {
  const controller = new TerminalController({
    shells,
    createTerminal: createXterm,
    projectFolder: () => useWorkbenchStore.getState().activeProject,
    onLastTabClosed: () => useWorkbenchStore.setState({ terminalOpen: false }),
  });
  active = controller;
  const unsubscribe = subscribe((event) => {
    if (event.type === 'shell.output' || event.type === 'shell.exited') controller.handleEvent(event);
  });
  if (typeof window !== 'undefined' && window.orch?.app.demo === true) {
    const first = controller.openTab('orch/r-02', 'orch/r-02');
    controller.openTab('main', 'main');
    controller.selectTab(first);
  }
  return () => {
    unsubscribe();
    controller.dispose();
    if (active === controller) active = null;
  };
}

/** The running controller, or null before the data layer is connected. */
export function getTerminalController(): TerminalController | null {
  return active;
}

/**
 * Opens the dock (if hidden) with a new shell tab that starts in `folder`. Returns the
 * tab key, or null before the data layer is connected.
 */
export function openShellIn(folder: string): string | null {
  if (!active) return null;
  useWorkbenchStore.setState({ terminalOpen: true });
  return active.openTab(folder);
}
