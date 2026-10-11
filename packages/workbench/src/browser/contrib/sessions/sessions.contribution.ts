/**
 * Registers the Sessions area: its route. The activity bar item (with its resumable
 * badge) and the "Show resumable sessions" palette command are already provided by the shell.
 */
import { workbenchRegistry } from '../../services/registry.js';
import type { IDisposable } from '@orch/base';
import { SessionsScreen } from './components/SessionsScreen.js';
import { sessionsStrings as S } from './strings.js';

export function registerSessionsContribution(): IDisposable[] {
  const route = workbenchRegistry.registerRoute({
    id: 'sessions',
    path: '/sessions',
    title: S.title,
    component: SessionsScreen,
  });
  return [route];
}
