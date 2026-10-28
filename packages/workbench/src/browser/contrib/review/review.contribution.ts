/**
 * Registers the Review area: its route. The activity bar item (with its "ready" badge),
 * the "/review" route and the ⌘2 shortcut (UI-05) are already provided by the shell.
 */
import type { IDisposable } from '@orchagents/base';
import { workbenchRegistry } from '../../services/registry.js';
import { ReviewScreen } from './components/ReviewScreen.js';
import { reviewStrings as S } from './strings.js';

export function registerReviewContribution(): IDisposable[] {
  const route = workbenchRegistry.registerRoute({
    id: 'review',
    path: '/review',
    title: S.title,
    component: ReviewScreen,
  });
  return [route];
}
