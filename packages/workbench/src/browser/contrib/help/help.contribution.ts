import { workbenchRegistry } from '../../services/registry.js';
import { useWorkbenchStore } from '../../services/workbenchStore.js';
import { formatShortcut } from '../../services/shortcuts.js';
import { HelpScreen, openHelpForArea } from './components/HelpScreen.js';

export function registerHelpContribution(): void {
  workbenchRegistry.registerRoute({ id: 'help', path: '/help', title: 'Help', component: HelpScreen });
  workbenchRegistry.registerCommand({ id: 'help.open', title: 'Open help', hint: formatShortcut('help'), icon: 'book', order: 13, action: () => openHelpForArea(useWorkbenchStore.getState().activeRoute === '/jobs/new' ? 'newjob' : useWorkbenchStore.getState().activeArea) });
}
registerHelpContribution();
