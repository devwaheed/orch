/**
 * Main workbench entry point.
 * Per docs/architecture.md "The window (workbench)".
 * Imports design tokens, fonts, and registers shell contributions.
 */
import '../../../../design/tokens/tokens.css';
import './design/fonts/tokens.css';
import './design/base.css';
import './design/tailwind.css';

import { createRoot, type Root } from 'react-dom/client';
import React from 'react';
import { WorkbenchShell, EMPTY_VIEW_CLASSES, EMPTY_VIEW_TITLE_CLASSES, EMPTY_VIEW_TEXT_CLASSES } from './parts/WorkbenchShell.js';
import { startTerminalService } from './parts/terminal/index.js';
import { workbenchRegistry } from './services/registry.js';
import { useWorkbenchStore } from './services/workbenchStore.js';
import { useThemeStore } from './services/theme.js';
import { useMenuSideStore } from './services/menuSide.js';
import { formatShortcut } from './services/shortcuts.js';
import { connectDataLayer, type DataLayer } from './services/stores/bootstrap.js';
import type { CoreServices } from './services/channelSchemas.js';
import { dataStrings } from './services/dataStrings.js';
import './contrib/newjob/newjob.contribution.js';
import './contrib/work/work.contribution.js';
import './contrib/help/help.contribution.js';
import { registerAccountsContribution, bindAccountsServices } from './contrib/accounts/index.js';
import { registerCliCommandContribution } from './contrib/cliCommand.contribution.js';
import { bindWorkServices } from './contrib/work/index.js';
import { setNewJobServices } from './contrib/newjob/index.js';
import { registerTrustContribution, bindTrustServices } from './contrib/trust/index.js';
import { registerSessionsContribution, bindSessionsServices } from './contrib/sessions/index.js';
import { registerReviewContribution, bindReviewServices } from './contrib/review/index.js';
import { registerSpecsContribution, bindSpecsServices } from './contrib/specs/index.js';
import { registerProductContribution, bindProductServices, notifyProductChanged } from './contrib/product/index.js';
import { registerBugReportContribution, bindBugReportServices, useBugReportUiStore } from './contrib/bugreport/index.js';
import { registerSettingsContribution, bindSettingsServices } from './contrib/settings/index.js';

export { WorkbenchShell } from './parts/WorkbenchShell.js';
export * from './services/index.js';
export { shellStrings } from './parts/strings.js';

export function registerDefaultShellCommands(): void {
  const store = useWorkbenchStore.getState();
  const themeStore = useThemeStore.getState();

  workbenchRegistry.registerCommand({
    id: 'shell.newJob',
    title: 'New spec',
    hint: formatShortcut('newSpec'),
    icon: 'plus',
    order: 1,
    action: () => store.setActiveRoute('/jobs/new'),
  });

  workbenchRegistry.registerCommand({
    id: 'shell.specs',
    title: 'Specs',
    hint: formatShortcut('specs'),
    icon: 'listOrdered',
    order: 2,
    action: () => store.setActiveArea('specs'),
  });

  workbenchRegistry.registerCommand({
    id: 'shell.review',
    title: 'Review changes ready to merge',
    hint: formatShortcut('review'),
    icon: 'review',
    order: 3,
    action: () => store.setActiveArea('review'),
  });

  workbenchRegistry.registerCommand({
    id: 'shell.sessions',
    title: 'Show resumable sessions',
    hint: formatShortcut('sessions'),
    icon: 'history',
    order: 4,
    action: () => store.setActiveArea('sessions'),
  });

  workbenchRegistry.registerCommand({
    id: 'shell.trust',
    title: 'Trust',
    hint: formatShortcut('trust'),
    icon: 'ladder',
    order: 5,
    action: () => store.setActiveArea('trust'),
  });

  workbenchRegistry.registerCommand({
    id: 'shell.accounts',
    title: 'Account settings',
    hint: formatShortcut('accounts'),
    icon: 'users',
    order: 6,
    action: () => store.setActiveArea('accounts'),
  });

  workbenchRegistry.registerCommand({
    id: 'shell.split',
    title: 'Split editor',
    hint: formatShortcut('splitEditor'),
    icon: 'split',
    order: 8,
    action: () => store.toggleSplit(),
  });

  workbenchRegistry.registerCommand({
    id: 'shell.terminal',
    title: 'Toggle terminal',
    hint: formatShortcut('terminal'),
    icon: 'terminal',
    order: 9,
    action: () => store.toggleTerminal(),
  });

  workbenchRegistry.registerCommand({
    id: 'shell.theme',
    title: themeStore.resolvedTheme === 'light' ? 'Switch to dark theme' : 'Switch to light theme',
    icon: themeStore.resolvedTheme === 'light' ? 'moon' : 'sun',
    order: 10,
    action: () => themeStore.toggleTheme(),
  });

  workbenchRegistry.registerCommand({
    id: 'shell.menuSide',
    title: 'Move menu to the other side',
    icon: 'panelRight',
    order: 12,
    action: () => useMenuSideStore.getState().toggleSide(),
  });

  workbenchRegistry.registerCommand({
    id: 'shell.capacity',
    title: 'Toggle capacity panel',
    hint: formatShortcut('capacity'),
    icon: 'panelRight',
    order: 11,
    action: () => store.toggleCapacity(),
  });
}

// Register default shell commands immediately
registerDefaultShellCommands();

window.orch?.app.onOpenHelp(() => workbenchRegistry.runCommand('help.open'));

window.orch?.app.onOpenProject((path) => useWorkbenchStore.getState().setActiveProject(path));

/** Shown when the core host can't be reached (dataStrings.coreUnavailable). Replaces the window. */
function CoreUnavailable() {
  return React.createElement(
    'div',
    { className: EMPTY_VIEW_CLASSES, role: 'alert' },
    React.createElement('span', { className: EMPTY_VIEW_TITLE_CLASSES }, dataStrings.coreUnavailable.message),
    React.createElement('span', { className: EMPTY_VIEW_TEXT_CLASSES }, dataStrings.coreUnavailable.fix),
  );
}

/** Hands the connected core services to every area that calls them. Returns a function that unbinds them. */
function bindAreaServices(services: CoreServices): () => void {
  bindWorkServices(services);
  setNewJobServices(services);
  bindAccountsServices(services);
  bindTrustServices(services);
  bindSessionsServices(services);
  bindReviewServices(services);
  bindSpecsServices(services);
  bindProductServices(services);
  bindBugReportServices(services);
  bindSettingsServices(services);
  return () => {
    bindWorkServices(null);
    setNewJobServices(null);
    bindAccountsServices(null);
    bindTrustServices(null);
    bindSessionsServices(null);
    bindReviewServices(null);
    bindSpecsServices(null);
    bindProductServices(null);
    bindBugReportServices(null);
    bindSettingsServices(null);
  };
}

/**
 * Connects the data layer at start-up. If the core host can't be reached, the window
 * shows the core-unavailable state. Otherwise the areas are bound to the services, then
 * the terminal dock is wired to the shells and events. Returns a function that stops
 * everything it started, in reverse order.
 */
function startWorkbenchData(root: Root): () => void {
  let stopped = false;
  let dataLayer: DataLayer | null = null;
  let stopTerminal: (() => void) | null = null;
  let unbindAreas: (() => void) | null = null;
  let stopProductEvents: (() => void) | null = null;

  void connectDataLayer().then((result) => {
    if (!result.ok) {
      root.render(React.createElement(CoreUnavailable));
      return;
    }
    if (stopped) {
      result.value.dispose();
      return;
    }
    dataLayer = result.value;
    const { services, client } = dataLayer;
    unbindAreas = bindAreaServices(services);
    stopProductEvents = client.subscribe((event) => {
      if (event.type === 'product.changed') notifyProductChanged(event.repoPath);
    });
    stopTerminal = startTerminalService(services.shells, (listener) => client.subscribe(listener));
  });

  return () => {
    stopped = true;
    stopTerminal?.();
    stopProductEvents?.();
    unbindAreas?.();
    dataLayer?.dispose();
  };
}
// Accounts area: route and palette command (S2-08)
registerAccountsContribution();
registerCliCommandContribution();
registerTrustContribution();
registerSessionsContribution();
registerReviewContribution();
registerSpecsContribution();
registerProductContribution();
registerBugReportContribution();
registerSettingsContribution();

window.orch?.app.onReportProblem(() => {
  useBugReportUiStore.getState().openDialog();
});
window.orch?.app.onToggleMenuSide?.(() => useMenuSideStore.getState().toggleSide());

export function bootstrapWorkbench(container?: HTMLElement | null): () => void {
  const target = container ?? (typeof document !== 'undefined' ? document.getElementById('root') : null);
  if (!target) {
    return () => undefined;
  }
  const root = createRoot(target);
  root.render(React.createElement(WorkbenchShell));
  const stopData = startWorkbenchData(root);
  return () => {
    stopData();
    root.unmount();
  };
}

if (typeof document !== 'undefined') {
  const rootElement = document.getElementById('root');
  if (rootElement) {
    bootstrapWorkbench(rootElement);
  }
}
