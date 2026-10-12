/**
 * Notification service (UI-06).
 * Native notifications only while the window is not focused, for:
 * - an account available again (account_available)
 * - a spec needs you (spec_needs_you)
 * - a job verified (job_verified)
 * - the engine keeps stopping (engine_stopping)
 */
import { Emitter, type Event, type IDisposable } from '@orchagents/base';
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
}

export class NotificationService implements IDisposable {
  private notifications: NotificationItem[] = [];
  private readonly onNotificationAddedEmitter = new Emitter<NotificationItem>();
  readonly onNotificationAdded: Event<NotificationItem> = this.onNotificationAddedEmitter.event;

  private isFocusedOverride: (() => boolean) | null = null;
  private bridgeOverride: OrchBridge | null = null;

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
    return this.notifications.filter((n) => !n.read).length;
  }

  getNotifications(): readonly NotificationItem[] {
    return this.notifications;
  }

  markAllRead(): void {
    for (const item of this.notifications) {
      item.read = true;
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
    };

    this.notifications.unshift(item);
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
