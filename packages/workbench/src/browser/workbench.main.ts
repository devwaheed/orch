/**
 * Main workbench entry point.
 * Per docs/architecture.md "The window (workbench)".
 * Imports design tokens, fonts, and registers shell contributions.
 */
import '../../../../design/tokens/tokens.css';
import './design/fonts/tokens.css';

import { createRoot } from 'react-dom/client';
import React from 'react';
import { WorkbenchShell } from './parts/WorkbenchShell.js';
import { workbenchRegistry } from './services/registry.js';
import { useWorkbenchStore } from './services/workbenchStore.js';
import { useThemeStore } from './services/theme.js';
import { formatShortcut } from './services/shortcuts.js';

export { WorkbenchShell } from './parts/WorkbenchShell.js';
export * from './services/index.js';
export { shellStrings } from './parts/strings.js';

export function registerDefaultShellCommands(): void {
  const store = useWorkbenchStore.getState();
  const themeStore = useThemeStore.getState();

  workbenchRegistry.registerCommand({
    id: 'shell.newJob',
    title: 'New job',
    hint: formatShortcut('newJob'),
    icon: 'plus',
    order: 1,
    action: () => store.setActiveRoute('/jobs/new'),
  });

  workbenchRegistry.registerCommand({
    id: 'shell.review',
    title: 'Review changes ready to merge',
    hint: formatShortcut('review'),
    icon: 'review',
    order: 2,
    action: () => store.setActiveArea('review'),
  });

  workbenchRegistry.registerCommand({
    id: 'shell.sessions',
    title: 'Show resumable sessions',
    hint: formatShortcut('sessions'),
    icon: 'history',
    order: 3,
    action: () => store.setActiveArea('sessions'),
  });

  workbenchRegistry.registerCommand({
    id: 'shell.split',
    title: 'Split editor',
    hint: formatShortcut('splitEditor'),
    icon: 'split',
    order: 4,
    action: () => store.toggleSplit(),
  });

  workbenchRegistry.registerCommand({
    id: 'shell.accounts',
    title: 'Account settings',
    hint: formatShortcut('accounts'),
    icon: 'users',
    order: 5,
    action: () => store.setActiveArea('accounts'),
  });

  workbenchRegistry.registerCommand({
    id: 'shell.terminal',
    title: 'Toggle terminal',
    hint: formatShortcut('terminal'),
    icon: 'terminal',
    order: 6,
    action: () => store.toggleTerminal(),
  });

  workbenchRegistry.registerCommand({
    id: 'shell.theme',
    title: themeStore.resolvedTheme === 'light' ? 'Switch to dark theme' : 'Switch to light theme',
    icon: themeStore.resolvedTheme === 'light' ? 'moon' : 'sun',
    order: 7,
    action: () => themeStore.toggleTheme(),
  });

  workbenchRegistry.registerCommand({
    id: 'shell.capacity',
    title: 'Toggle capacity panel',
    hint: formatShortcut('capacity'),
    icon: 'panelRight',
    order: 8,
    action: () => store.toggleCapacity(),
  });
}

// Register default shell commands immediately
registerDefaultShellCommands();

export function bootstrapWorkbench(container?: HTMLElement | null): () => void {
  const target = container ?? (typeof document !== 'undefined' ? document.getElementById('root') : null);
  if (!target) {
    return () => undefined;
  }
  const root = createRoot(target);
  root.render(React.createElement(WorkbenchShell));
  return () => {
    root.unmount();
  };
}

if (typeof document !== 'undefined') {
  const rootElement = document.getElementById('root');
  if (rootElement) {
    bootstrapWorkbench(rootElement);
  }
}
