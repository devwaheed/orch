/**
 * Registers the Trust area: its route. The activity bar item (PRD-06) and the ⌘5 shortcut
 * (UI-05) are provided by the shell.
 */
import type { IDisposable } from '@orchagents/base';
import { workbenchRegistry } from '../../services/registry.js';
import { TrustScreen } from './components/TrustScreen.js';
import { trustStrings as S } from './strings.js';

export function registerTrustContribution(): IDisposable[] {
  const route = workbenchRegistry.registerRoute({
    id: 'trust',
    path: '/trust',
    title: S.title,
    component: TrustScreen,
  });
  return [route];
}
