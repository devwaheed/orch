/**
 * Connects the terminal dock to the data layer: one controller per window, fed by
 * shell.output and shell.exited from the events channel.
 */
import type { OrchEvent } from '@orch/contracts';
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
