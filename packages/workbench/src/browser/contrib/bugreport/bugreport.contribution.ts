/**
 * Registers Bug Report contributions: command palette command.
 */
import type { IDisposable } from '@orchagents/base';
import { workbenchRegistry } from '../../services/registry.js';
import { useBugReportUiStore } from './stores/bugReportUi.js';
import { BugReportDialog } from './components/BugReportDialog.js';
import { bugReportStrings as S } from './strings.js';

export function registerBugReportContribution(): IDisposable[] {
  const command = workbenchRegistry.registerCommand({
    id: 'bugreport.open',
    title: S.commands.reportProblem,
    icon: 'robot',
    order: 20,
    action: () => {
      useBugReportUiStore.getState().openDialog();
    },
  });
  const dialog = workbenchRegistry.registerOverlay({ id: 'bugreport.dialog', component: BugReportDialog });
  return [command, dialog];
}
