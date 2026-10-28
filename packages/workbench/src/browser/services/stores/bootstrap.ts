/**
 * Starts the data layer: connects to the core host, subscribes to live events
 * BEFORE loading, loads the initial lists, and keeps the shell status in step.
 *
 * Known gap: a list reply that arrives after a newer event for the same object
 * replaces that object with the older copy. The window is one round trip at start.
 */
import type { OrchError, Result } from '@orchagents/contracts';
import { connectCore, type ConnectCoreOptions } from '../orchClient.js';
import { BrowserChannelClient, type BrowserPortLike } from '../channelClient.js';
import { createCoreServices, type CoreServices } from '../channelSchemas.js';
import { applyOrchEvent } from './apply.js';
import { useAccountsStore } from './accounts.js';
import { useJobsStore, useRunsStore } from './work.js';
import { useQuotaStore } from './quota.js';
import { useReviewStore } from './review.js';
import { useSessionsStore } from './sessions.js';
import { startShellStatusSync } from './shellStatus.js';
import { syncActiveProject } from './project.js';
import { dataStrings } from '../dataStrings.js';
import { notificationService, useNotificationStore } from '../notifications.js';

export interface DataLayer {
  readonly services: CoreServices;
  readonly client: BrowserChannelClient;
  /** Stops the event subscription and status sync, and closes the port. */
  dispose(): void;
}

/** Reloads the account list (also after config.changed). Returns the error, if any. */
export async function loadAccounts(services: CoreServices): Promise<OrchError | null> {
  const [agents, accounts] = await Promise.all([services.accounts.listAgents(), services.accounts.list()]);
  if (agents.ok) useAccountsStore.getState().setAgents(agents.value);
  if (accounts.ok) useAccountsStore.getState().setAccounts(accounts.value);
  if (!agents.ok) return agents.error;
  if (!accounts.ok) return accounts.error;
  return null;
}

/** Loads every list that has no event-free source. Returns the first error per area. */
export async function loadInitialState(services: CoreServices): Promise<Record<string, OrchError>> {
  const errors: Record<string, OrchError> = {};

  const accountsError = await loadAccounts(services);
  if (accountsError) errors.accounts = accountsError;

  const windows = await services.quota.windows();
  if (windows.ok) useQuotaStore.getState().setWindows(windows.value);
  else errors.quota = windows.error;

  const spend = await services.quota.spendToday();
  if (spend.ok) useQuotaStore.getState().setSpendToday(spend.value);
  else if (!errors.quota) errors.quota = spend.error;

  const jobs = await services.jobs.list();
  if (jobs.ok) {
    useJobsStore.getState().setJobs(jobs.value);
    syncActiveProject();
    const runLists = await Promise.all(jobs.value.map((job) => services.runs.list(job.id)));
    runLists.forEach((runs, index) => {
      const job = jobs.value[index];
      if (!job) return;
      if (runs.ok) useRunsStore.getState().setRunsForJob(job.id, runs.value);
      else errors.runs = runs.error;
    });
  } else {
    errors.jobs = jobs.error;
  }

  const sessions = await services.sessions.list('all');
  if (sessions.ok) useSessionsStore.getState().setSessions(sessions.value);
  else errors.sessions = sessions.error;

  const review = await services.review.list();
  if (review.ok) useReviewStore.getState().setWorktrees(review.value);
  else errors.review = review.error;

  return errors;
}

/** Wires an already open port to the stores. */
export function startDataLayer(port: BrowserPortLike): DataLayer {
  const client = new BrowserChannelClient(port);
  const services = createCoreServices(client);

  const unsubscribeEvents = client.subscribe((event) => {
    applyOrchEvent(event);
    notificationService.handleEvent(event);
    if (event.type === 'config.changed') {
      void loadAccounts(services);
    }
  });
  if (window.orch?.app.demo === true && useNotificationStore.getState().items.length === 0) {
    const now = Date.now();
    const samples = [
      { id: 'demo-notification-verified', reason: 'job_verified' as const, title: 'Job verified', body: '"Add account settings" was verified and is ready to review.', timestamp: now - 60_000, read: false, icon: 'review' as const, target: 'review' as const },
      { id: 'demo-notification-spec', reason: 'spec_needs_you' as const, title: 'Spec needs you', body: 'Spec S-42 stopped after its retries and needs you.', timestamp: now - 8 * 60_000, read: false, icon: 'listOrdered' as const, target: 'specs' as const, specId: '42' },
      { id: 'demo-notification-account', reason: 'account_available' as const, title: 'Account available again', body: 'Account Team is available to run jobs again.', timestamp: now - 45 * 60_000, read: false, icon: 'users' as const, target: 'accounts' as const },
    ];
    for (const item of samples.reverse()) useNotificationStore.getState().add(item);
  }
  const stopStatusSync = startShellStatusSync();

  void loadInitialState(services);

  return {
    services,
    client,
    dispose() {
      stopStatusSync();
      unsubscribeEvents();
      client.close();
    },
  };
}

/** Connects through the preload bridge, then starts the data layer. Never throws. */
export async function connectDataLayer(options: ConnectCoreOptions = {}): Promise<Result<DataLayer>> {
  try {
    const port = await connectCore(options);
    return { ok: true, value: startDataLayer(port) };
  } catch (error) {
    if (isOrchError(error)) {
      return { ok: false, error };
    }
    return {
      ok: false,
      error: { code: 'internal', message: dataStrings.coreUnavailable.message, fix: dataStrings.coreUnavailable.fix },
    };
  }
}

function isOrchError(value: unknown): value is OrchError {
  return (
    typeof value === 'object' &&
    value !== null &&
    'code' in value &&
    'message' in value &&
    typeof (value as { message: unknown }).message === 'string'
  );
}
