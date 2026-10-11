/**
 * Registers the New job route (/jobs/new). The ⌘N command and shortcut already
 * navigate to this path (workbench.main.ts, WorkbenchShell).
 */
import { workbenchRegistry } from '../../services/registry.js';
import { NewJobPage } from './components/NewJobPage.js';
import { newJobStrings } from './strings.js';

workbenchRegistry.registerRoute({
  id: 'newjob.route',
  path: '/jobs/new',
  title: newJobStrings.route.name,
  component: NewJobPage,
});
