import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { AccountId, type OrchEvent } from '@orchagents/contracts';
import {
  NotificationService,
  useNotificationStore,
  type NotificationReason,
} from '../src/browser/services/notifications.js';

describe('NotificationService (UI-06)', () => {
  let service: NotificationService;

  beforeEach(() => {
    service = new NotificationService();
    useNotificationStore.getState().clear();
  });

  afterEach(() => {
    service.dispose();
    if (typeof window !== 'undefined') {
      delete (window as unknown as { orch?: unknown }).orch;
    }
  });

  it('records notifications in internal log with unread state', async () => {
    service.setFocusDetector(() => true); // Window is focused

    const sent = await service.requestNotification({
      reason: 'account_available',
      title: 'Account Available',
      body: 'Your Claude account is ready',
    });

    // UI-06: Native notifications only while the window is NOT focused
    expect(sent).toBe(false);
    expect(service.unreadCount).toBe(1);

    const items = service.getNotifications();
    expect(items).toHaveLength(1);
    expect(items[0]?.reason).toBe('account_available');
    expect(items[0]?.title).toBe('Account Available');
    expect(items[0]?.read).toBe(false);
  });

  it('requests native notification via bridge when window is not focused', async () => {
    service.setFocusDetector(() => false); // Window is NOT focused

    const requestNotificationMock = vi.fn().mockResolvedValue(undefined);
    service.setBridge({
      connect: async () => undefined,
      app: {
        version: '1.0.0',
        os: 'macos',
        demo: false,
        openExternal: vi.fn(),
        showItemInFolder: vi.fn(),
        chooseFolder: async () => null,
        onUpdateReady: () => () => undefined,
        onOpenProject: () => () => undefined,
        cliCommand: { offered: false, install: async () => undefined, uninstall: async () => undefined, machineCheckFinished: async () => undefined },
        onReportProblem: () => () => undefined, onOpenHelp: () => () => undefined,
        openNewIssue: async () => undefined,
        restartEngine: async () => undefined,
        requestNotification: requestNotificationMock,
      },
    });

    const sent = await service.requestNotification({
      reason: 'job_verified',
      title: 'Job Verified',
      body: 'All tests passed',
    });

    expect(sent).toBe(true);
    expect(requestNotificationMock).toHaveBeenCalledWith({
      title: 'Job Verified',
      body: 'All tests passed',
    });
    expect(service.unreadCount).toBe(1);
  });

  it('marks all notifications as read', async () => {
    service.setFocusDetector(() => true);

    await service.requestNotification({
      reason: 'spec_needs_you',
      title: 'Spec needs you',
      body: 'Review required',
    });
    await service.requestNotification({
      reason: 'engine_stopping',
      title: 'Engine stopping',
      body: 'Daemon stopped unexpectedly',
    });

    expect(service.unreadCount).toBe(2);
    service.markAllRead();
    expect(service.unreadCount).toBe(0);

    for (const item of service.getNotifications()) {
      expect(item.read).toBe(true);
    }
  });

  it('fires onNotificationAdded when a notification is requested', async () => {
    service.setFocusDetector(() => true);
    const listener = vi.fn();
    service.onNotificationAdded(listener);

    const reason: NotificationReason = 'spec_needs_you';
    await service.requestNotification({
      reason,
      title: 'Title',
      body: 'Body',
    });

    expect(listener).toHaveBeenCalledTimes(1);
    expect(listener).toHaveBeenCalledWith(
      expect.objectContaining({
        reason: 'spec_needs_you',
        title: 'Title',
        body: 'Body',
        read: false,
      }),
    );
  });

  it('maps UI-06 events into a capped, newest-first in-app list', () => {
    service.handleEvent({ type: 'quota.available', accountId: AccountId.parse('codex-team') });
    service.handleEvent({ type: 'spec.changed', spec: { id: '42', state: 'needs_you' } } as OrchEvent);
    service.handleEvent({ type: 'review.changed', review: { verdict: 'verified', title: 'Ready job' } } as OrchEvent);
    expect(service.getNotifications().map((item) => item.reason)).toEqual(['job_verified', 'spec_needs_you', 'account_available']);
    expect(service.getNotifications()[1]?.specId).toBe('42');
    for (let i = 0; i < 55; i++) service.handleEvent({ type: 'quota.available', accountId: AccountId.parse(`codex-team-${i}`) });
    expect(service.getNotifications()).toHaveLength(50);
  });
});
