/** Registers the Work route (default). Loaded by workbench.main.ts. */
import { workbenchRegistry } from '../../services/registry.js';
import { WorkView } from './WorkView.js';
import { shellStrings } from '../../parts/strings.js';

export const WORK_ROUTE_PATH = '/work';

workbenchRegistry.registerRoute({
  id: 'work',
  path: WORK_ROUTE_PATH,
  title: shellStrings.activityBar.work.name,
  component: WorkView,
  default: true,
});
