import { describe, expect, it, vi } from 'vitest';
import {
  AutoUpdateService,
  UPDATE_CHECK_INTERVAL_MS,
  channelForVersion,
  isPrerelease,
  type AutoUpdaterPort,
  type UpdateChannel,
} from './updater.js';
import type { UpdateFeed } from './updater.js';

const FEED: UpdateFeed = { provider: 'github', owner: 'orch', repo: 'orch' };

/** A clock that only runs timers when the test advances it. */
function fakeClock() {
  let now = 0;
  const timers: Array<{ at: number; fn: () => void; cancelled: boolean }> = [];
  return {
    clock: {
      now: () => now,
      setTimer: (fn: () => void, ms: number) => {
        const timer = { at: now + ms, fn, cancelled: false };
        timers.push(timer);
        return () => {
          timer.cancelled = true;
        };
      },
    },
    advance(ms: number) {
      now += ms;
      for (const timer of timers) {
        if (!timer.cancelled && timer.at <= now) {
          timer.cancelled = true;
          timer.fn();
        }
      }
    },
  };
}

const flush = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));

class FakeUpdater implements AutoUpdaterPort {
  configured: { autoDownload: boolean; autoInstallOnAppQuit: boolean } | null = null;
  channel: UpdateChannel | null = null;
  feed: UpdateFeed | null = null;
  checkCalls = 0;
  downloadCalls = 0;
  quitCalls = 0;
  private available: (() => void) | null = null;
  private downloaded: ((version: string) => void) | null = null;
  private errored: ((error: unknown) => void) | null = null;

  configure(options: { autoDownload: boolean; autoInstallOnAppQuit: boolean }): void {
    this.configured = options;
  }
  setChannel(channel: UpdateChannel): void {
    this.channel = channel;
  }
  setFeedURL(feed: UpdateFeed): void {
    this.feed = feed;
  }
  onUpdateAvailable(listener: () => void): void {
    this.available = listener;
  }
  onUpdateDownloaded(listener: (version: string) => void): void {
    this.downloaded = listener;
  }
  onError(listener: (error: unknown) => void): void {
    this.errored = listener;
  }
  async checkForUpdates(): Promise<void> {
    this.checkCalls += 1;
  }
  async downloadUpdate(): Promise<void> {
    this.downloadCalls += 1;
  }
  quitAndInstall(): void {
    this.quitCalls += 1;
  }

  emitAvailable(): void {
    this.available?.();
  }
  emitDownloaded(version: string): void {
    this.downloaded?.(version);
  }
  emitError(error: unknown): void {
    this.errored?.(error);
  }
}

function makeService(options: {
  version?: string;
  updater: FakeUpdater;
  clock: ReturnType<typeof fakeClock>;
  isJobActive?: () => Promise<boolean>;
  notifyReady?: () => void;
  onError?: (error: unknown) => void;
}): AutoUpdateService {
  return new AutoUpdateService({
    currentVersion: options.version ?? '1.0.0',
    feed: FEED,
    updater: options.updater,
    clock: options.clock.clock,
    isJobActive: options.isJobActive ?? (async () => false),
    notifyReady: options.notifyReady ?? (() => undefined),
    ...(options.onError ? { onError: options.onError } : {}),
  });
}

describe('REL-01 update channel', () => {
  it('a beta version updates from the beta channel, a release from latest', () => {
    expect(channelForVersion('1.0.0-beta.1')).toBe('beta');
    expect(channelForVersion('1.0.0-beta.42')).toBe('beta');
    expect(channelForVersion('1.0.0')).toBe('latest');
    expect(channelForVersion('2.3.4')).toBe('latest');
  });

  it('detects prereleases', () => {
    expect(isPrerelease('1.0.0-beta.1')).toBe(true);
    expect(isPrerelease('1.0.0')).toBe(false);
    expect(isPrerelease('not-a-version')).toBe(false);
  });
});

describe('REL-02 schedule', () => {
  it('checks at start and every six hours', async () => {
    const clock = fakeClock();
    const updater = new FakeUpdater();
    const service = makeService({ updater, clock });

    service.start();
    expect(updater.checkCalls).toBe(1);

    clock.advance(UPDATE_CHECK_INTERVAL_MS);
    expect(updater.checkCalls).toBe(2);

    await flush();
    clock.advance(UPDATE_CHECK_INTERVAL_MS);
    expect(updater.checkCalls).toBe(3);

    service.dispose();
  });

  it('stops checking after dispose', async () => {
    const clock = fakeClock();
    const updater = new FakeUpdater();
    const service = makeService({ updater, clock });
    service.start();
    service.dispose();

    clock.advance(UPDATE_CHECK_INTERVAL_MS * 3);
    await flush();
    expect(updater.checkCalls).toBe(1);
  });
});

describe('REL-02 download and ready', () => {
  it('downloads a newer beta and tells the window it is ready', async () => {
    const clock = fakeClock();
    const updater = new FakeUpdater();
    const notifyReady = vi.fn();
    const service = makeService({ version: '1.0.0-beta.1', updater, clock, notifyReady });

    service.start();
    expect(updater.channel).toBe('beta');
    expect(updater.feed).toEqual(FEED);
    expect(updater.configured).toEqual({ autoDownload: false, autoInstallOnAppQuit: false });

    updater.emitAvailable();
    await flush();
    expect(updater.downloadCalls).toBe(1);

    updater.emitDownloaded('1.0.0-beta.2');
    expect(service.isReady).toBe(true);
    expect(notifyReady).toHaveBeenCalledTimes(1);
  });

  it('reports updater errors without throwing', () => {
    const clock = fakeClock();
    const updater = new FakeUpdater();
    const onError = vi.fn();
    const service = makeService({ updater, clock, onError });
    service.start();

    const failure = new Error('network down');
    updater.emitError(failure);
    expect(onError).toHaveBeenCalledWith(failure);
  });
});

describe('REL-02 install on restart', () => {
  it('does nothing when no update is ready', async () => {
    const clock = fakeClock();
    const updater = new FakeUpdater();
    const service = makeService({ updater, clock });
    await expect(service.installIfIdle()).resolves.toBe(false);
    expect(updater.quitCalls).toBe(0);
  });

  it('never installs while a job is active', async () => {
    const clock = fakeClock();
    const updater = new FakeUpdater();
    let active = true;
    const service = makeService({ updater, clock, isJobActive: async () => active });
    service.start();
    updater.emitDownloaded('1.0.0-beta.2');

    await expect(service.installIfIdle()).resolves.toBe(false);
    expect(updater.quitCalls).toBe(0);

    active = false;
    await expect(service.installIfIdle()).resolves.toBe(true);
    expect(updater.quitCalls).toBe(1);
  });
});
