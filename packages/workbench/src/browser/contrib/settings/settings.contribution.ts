/**
 * Registers the Settings area: its route.
 */
import type { IDisposable } from '@orchagents/base';
import { workbenchRegistry } from '../../services/registry.js';
import { SettingsScreen } from './components/SettingsScreen.js';
import { settingsStrings as S } from './strings.js';

export function registerSettingsContribution(): IDisposable[] {
  const route = workbenchRegistry.registerRoute({
    id: 'settings',
    path: '/settings',
    title: S.title,
    component: SettingsScreen,
  });
  return [route];
}
