/** Registers the Work route (default). Loaded by workbench.main.ts. */
import { workbenchRegistry } from '../../services/registry.js';
import { WorkView } from './WorkView.js';
import { shellStrings } from '../../parts/strings.js';
import { getWorkServices } from './workServices.js';
import { AccountId, RunId } from '@orchagents/contracts';
import { useWorkbenchStore } from '../../services/workbenchStore.js';

export const WORK_ROUTE_PATH = '/work';

workbenchRegistry.registerRoute({
  id: 'work',
  path: WORK_ROUTE_PATH,
  title: shellStrings.activityBar.work.name,
  component: WorkView,
  default: true,
});

workbenchRegistry.registerCommand({
  id: 'work.demoResume',
  title: 'Resume s-91e0 on Codex · Team',
  hint: 'session',
  icon: 'swap',
  order: 0,
  action: async () => {
    const services = getWorkServices();
    if (services) {
      await services.runs.resumeOn(RunId.parse('r-04'), AccountId.parse('codex-team'));
    }
    useWorkbenchStore.getState().closePalette();
  },
});
