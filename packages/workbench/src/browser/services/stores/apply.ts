/**
 * Routes one OrchEvent to the stores that own it. Every event carries the full
 * object, so each branch replaces or removes rather than patching fields.
 * Events for areas without a store here (shell output, config.changed) are ignored.
 */
import type { OrchEvent } from '@orchagents/contracts';
import { useAccountsStore } from './accounts.js';
import { useEngineStore } from './engine.js';
import { useJobsStore, useRunsStore } from './work.js';
import { useQuotaStore } from './quota.js';
import { useReviewStore } from './review.js';
import { useSessionsStore } from './sessions.js';
import { useSpecsStore } from './specs.js';
import { useConfigErrorsStore } from './config.js';
import { syncActiveProject } from './project.js';

export function applyOrchEvent(event: OrchEvent): void {
  switch (event.type) {
    case 'account.changed':
      useAccountsStore.getState().upsertAccount(event.account);
      return;
    case 'account.removed':
      useAccountsStore.getState().removeAccount(event.accountId);
      return;
    case 'quota.changed':
      useQuotaStore.getState().upsertWindow(event.window);
      return;
    case 'quota.limited':
      useQuotaStore.getState().setLimited(event.accountId, event.resetsAt);
      return;
    case 'quota.available':
      useQuotaStore.getState().clearLimited(event.accountId);
      return;
    case 'job.changed':
      useJobsStore.getState().upsertJob(event.job);
      syncActiveProject();
      return;
    case 'run.changed':
      useRunsStore.getState().upsertRun(event.run);
      return;
    case 'run.line':
      useRunsStore.getState().appendLine(event.line);
      return;
    case 'session.changed':
      useSessionsStore.getState().upsertSession(event.session);
      return;
    case 'review.changed':
      useReviewStore.getState().upsertWorktree(event.review);
      return;
    case 'engine.health':
      useEngineStore.getState().setHealth(event.state, event.message ?? null);
      return;
    case 'spec.changed':
      useSpecsStore.getState().upsertSpec(event.spec);
      return;
    case 'queue.changed':
      useSpecsStore.getState().upsertQueue(event.queue);
      return;
    case 'config.invalid':
      useConfigErrorsStore.getState().setErrors(event.errors);
      return;
    case 'shell.output':
    case 'shell.exited':
    case 'config.changed':
      return;
  }
}
