/**
 * Registers the Specs area: its route. The activity bar item (PRD-06) and the ⌘2 shortcut
 * (UI-05) are provided by the shell.
 */
import type { IDisposable } from '@orchagents/base';
import { workbenchRegistry } from '../../services/registry.js';
import { SpecsScreen } from './components/SpecsScreen.js';
import { specStrings as S } from './strings.js';

export function registerSpecsContribution(): IDisposable[] {
  const route = workbenchRegistry.registerRoute({
    id: 'specs',
    path: '/specs',
    title: S.title,
    component: SpecsScreen,
  });
  return [route];
}