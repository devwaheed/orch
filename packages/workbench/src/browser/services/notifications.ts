/**
 * Notification service (UI-06).
 * Native notifications only while the window is not focused, for:
 * - an account available again (account_available)
 * - a spec needs you (spec_needs_you)
 * - a job verified (job_verified)
 * - the engine keeps stopping (engine_stopping)
 */
import { Emitter, type Event, type IDisposable } from '@orchagents/base';
import type { OrchEvent } from '@orchagents/contracts';
import { create } from 'zustand';
import { getOrchBridge, type OrchBridge } from './orchClient.js';

export type NotificationReason =
  | 'account_available'
  | 'spec_needs_you'
  | 'job_verified'
  | 'engine_stopping';

export interface NotificationItem {
  id: string;
  reason: NotificationReason;
  title: string;
  body: string;
  timestamp: number;
  read: boolean;
  icon: 'users' | 'listOrdered' | 'review' | 'alert';
  target: 'accounts' | 'specs' | 'review' | 'none';
  specId?: string;
}

interface NotificationState {
  items: NotificationItem[];
  add(item: NotificationItem): void;
  markAllRead(): void;
  clear(): void;
}

export const useNotificationStore = create<NotificationState>()((set) => ({
  items: [],
  add: (item) => set((state) => ({ items: [item, ...state.items].slice(0, 50) })),
  markAllRead: () => set((state) => ({ items: state.items.map((item) => ({ ...item, read: true })) })),
  clear: () => set({ items: [] }),
}));

export class NotificationService implements IDisposable {
  private readonly onNotificationAddedEmitter = new Emitter<NotificationItem>();
  readonly onNotificationAdded: Event<NotificationItem> = this.onNotificationAddedEmitter.event;

  private isFocusedOverride: (() => boolean) | null = null;
  private bridgeOverride: OrchBridge | null = null;
  private readonly specsNeedingYou = new Set<string>();

  setFocusDetector(detector: () => boolean): void {
    this.isFocusedOverride = detector;
  }

  setBridge(bridge: OrchBridge | null): void {
    this.bridgeOverride = bridge;
  }

  isWindowFocused(): boolean {
    if (this.isFocusedOverride) {
      return this.isFocusedOverride();
    }
    if (typeof document !== 'undefined' && typeof document.hasFocus === 'function') {
      return document.hasFocus();
    }
    return true;
  }

  get unreadCount(): number {
    return useNotificationStore.getState().items.filter((n) => !n.read).length;
  }

  getNotifications(): readonly NotificationItem[] {
    return useNotificationStore.getState().items;
  }

  markAllRead(): void {
    useNotificationStore.getState().markAllRead();
  }

  clear(): void {
    useNotificationStore.getState().clear();
  }

  handleEvent(event: OrchEvent): void {
    const add = (reason: NotificationReason, title: string, body: string, icon: NotificationItem['icon'], target: NotificationItem['target'], specId?: string) => {
      const item: NotificationItem = { id: `notif-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`, reason, title, body, timestamp: Date.now(), read: false, icon, target, ...(specId ? { specId } : {}) };
      useNotificationStore.getState().add(item);
      this.onNotificationAddedEmitter.fire(item);
    };
    switch (event.type) {
      case 'quota.available':
        add('account_available', 'Account available again', `Account ${event.accountId} is available to run jobs again.`, 'users', 'accounts');
        break;
      case 'spec.changed':
        if (event.spec.state !== 'needs_you') this.specsNeedingYou.delete(event.spec.id);
        else if (!this.specsNeedingYou.has(event.spec.id)) {
          this.specsNeedingYou.add(event.spec.id);
          add('spec_needs_you', 'Spec needs you', `Spec ${event.spec.id} stopped after its retries and needs you.`, 'listOrdered', 'specs', event.spec.id);
        }
        break;
      case 'review.changed':
        if (event.review.verdict === 'verified') add('job_verified', 'Job verified', `"${event.review.title}" was verified and is ready to review.`, 'review', 'review');
        break;
      case 'engine.health':
        if (event.state === 'failed') add('engine_stopping', 'Engine alert', 'The engine keeps stopping. Check orch doctor or restart.', 'alert', 'none');
        break;
      default: break;
    }
  }

  async requestNotification(options: {
    reason: NotificationReason;
    title: string;
    body: string;
  }): Promise<boolean> {
    const item: NotificationItem = {
      id: `notif-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      reason: options.reason,
      title: options.title,
      body: options.body,
      timestamp: Date.now(),
      read: false,
      icon: options.reason === 'account_available' ? 'users' : options.reason === 'spec_needs_you' ? 'listOrdered' : options.reason === 'job_verified' ? 'review' : 'alert',
      target: options.reason === 'account_available' ? 'accounts' : options.reason === 'spec_needs_you' ? 'specs' : options.reason === 'job_verified' ? 'review' : 'none',
    };

    useNotificationStore.getState().add(item);
    this.onNotificationAddedEmitter.fire(item);

    // UI-06: Native notifications ONLY while the window is not focused
    if (this.isWindowFocused()) {
      return false;
    }

    const bridge = this.bridgeOverride ?? getOrchBridge();
    if (bridge.app.requestNotification) {
      await bridge.app.requestNotification({ title: options.title, body: options.body });
      return true;
    }

    if (typeof Notification !== 'undefined' && Notification.permission === 'granted') {
      new Notification(options.title, { body: options.body });
      return true;
    }

    return false;
  }

  dispose(): void {
    this.onNotificationAddedEmitter.dispose();
  }
}

export const notificationService = new NotificationService();
