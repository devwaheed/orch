/**
 * Native desktop notification manager (UI-06).
 * Shows native notifications only when the main window is not focused.
 *
 * Listens for:
 * - run.attention (limit_ask)
 * - spec.changed into needs_you
 * - quota.available
 * - job verified (review.changed with verdict: verified)
 * - engine keeps stopping (the engine host supervisor gives up: state failed)
 */
import { Notification, MessageChannelMain, type MessagePortMain } from 'electron';
import type { OrchEvent } from '@orch/contracts';
import { ChannelClient, MessagePortTransport, type MessagePortLike } from '@orch/platform/channels/common';
import { NOTIFICATION_STRINGS } from './notificationStrings.js';
import type { HostHealth } from './hosts.js';

export interface Notifier {
  show(title: string, body: string): void;
}

export const electronNotifier: Notifier = {
  show(title: string, body: string): void {
    if (Notification.isSupported()) {
      new Notification({ title, body }).show();
    }
  },
};

export interface NotificationServiceOptions {
  readonly isWindowFocused: () => boolean;
  readonly notifier?: Notifier;
}

export class NotificationService {
  private client: ChannelClient | null = null;
  private unsubscribeEvents: (() => void) | null = null;
  private readonly notifier: Notifier;
  private readonly isWindowFocused: () => boolean;
  private disposed = false;
  private readonly specsNeedingYou = new Set<string>();

  constructor(options: NotificationServiceOptions) {
    this.isWindowFocused = options.isWindowFocused;
    this.notifier = options.notifier ?? electronNotifier;
  }

  /** Connect to core host over a message port and subscribe to events. */
  connect(postToCore: (port: MessagePortMain) => boolean): boolean {
    if (this.disposed) return false;
    this.disconnect();

    const channel = new MessageChannelMain();
    const connected = postToCore(channel.port1);
    if (!connected) return false;

    const transport = new MessagePortTransport(channel.port2 as unknown as MessagePortLike);
    const client = new ChannelClient(transport);
    this.client = client;

    this.unsubscribeEvents = client.events.subscribe((event) => {
      this.handleEvent(event);
    });

    return true;
  }

  /** Handles OrchEvent from the core host. */
  handleEvent(event: OrchEvent): void {
    if (this.disposed) return;
    if (this.isWindowFocused()) return;

    switch (event.type) {
      case 'run.attention': {
        if (event.reason === 'limit_ask') {
          this.notifier.show(
            NOTIFICATION_STRINGS.runAttentionLimitAsk.title,
            NOTIFICATION_STRINGS.runAttentionLimitAsk.body(event.runId),
          );
        }
        break;
      }

      case 'spec.changed': {
        // spec.changed repeats while a spec sits in needs_you; notify once per stop.
        if (event.spec.state !== 'needs_you') {
          this.specsNeedingYou.delete(event.spec.id);
        } else if (!this.specsNeedingYou.has(event.spec.id)) {
          this.specsNeedingYou.add(event.spec.id);
          this.notifier.show(
            NOTIFICATION_STRINGS.specNeedsYou.title,
            NOTIFICATION_STRINGS.specNeedsYou.body(event.spec.id),
          );
        }
        break;
      }

      case 'quota.available': {
        this.notifier.show(
          NOTIFICATION_STRINGS.quotaAvailable.title,
          NOTIFICATION_STRINGS.quotaAvailable.body(event.accountId),
        );
        break;
      }

      case 'review.changed': {
        if (event.review.verdict === 'verified') {
          this.notifier.show(
            NOTIFICATION_STRINGS.jobVerified.title,
            NOTIFICATION_STRINGS.jobVerified.body(event.review.title),
          );
        }
        break;
      }

      default:
        break;
    }
  }

  /** Handles supervisor HostHealth updates (e.g. engine keeps stopping). */
  handleHostHealth(health: HostHealth): void {
    if (this.disposed) return;
    if (health.host === 'engine' && health.state === 'failed') {
      if (this.isWindowFocused()) return;
      this.notifier.show(
        NOTIFICATION_STRINGS.engineKeepsStopping.title,
        NOTIFICATION_STRINGS.engineKeepsStopping.body,
      );
    }
  }

  disconnect(): void {
    if (this.unsubscribeEvents) {
      this.unsubscribeEvents();
      this.unsubscribeEvents = null;
    }
    if (this.client) {
      this.client.dispose();
      this.client = null;
    }
  }

  dispose(): void {
    this.disposed = true;
    this.disconnect();
  }
}
