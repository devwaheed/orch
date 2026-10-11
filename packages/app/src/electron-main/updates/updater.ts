/**
 * Auto-update policy (S5-03, LOCKED REL-01, REL-02).
 *
 * Pure logic only: the electron-updater wiring lives in `electronUpdater.ts`, and
 * the clock and the active-job check arrive as injected ports, so this can be
 * tested with fakes and never touches the network or Electron.
 *
 * - REL-01: channels `beta` and `latest`; betas are `1.0.0-beta.N`. The channel
 *   follows the running app's version: a prerelease runs on `beta`, otherwise
 *   `latest`.
 * - REL-02: checked at start and every 6 hours; installed on next restart, never
 *   while a job is active. `autoInstallOnAppQuit` is therefore off and main asks
 *   `installIfIdle()` at quit.
 */

/** REL-02: the update check interval (6 hours). */
export const UPDATE_CHECK_INTERVAL_MS = 6 * 60 * 60 * 1000;

/** REL-01: the release channels. */
export type UpdateChannel = 'beta' | 'latest';

/** The GitHub Releases feed the updater reads. `owner`/`repo` come from the release decision, not from here. */
export interface UpdateFeed {
  readonly provider: 'github';
  readonly owner: string;
  readonly repo: string;
}

/** The clock the schedule uses. Same shape as the host supervisor's clock, so the fakes are interchangeable. */
export interface UpdateClock {
  now(): number;
  /** Schedule `fn` after `ms`. Returns a cancel function. */
  setTimer(fn: () => void, ms: number): () => void;
}

/**
 * The slice of electron-updater the policy uses. The adapter in `electronUpdater.ts`
 * wraps the real `autoUpdater`; tests supply a fake.
 */
export interface AutoUpdaterPort {
  configure(options: { readonly autoDownload: boolean; readonly autoInstallOnAppQuit: boolean }): void;
  setChannel(channel: UpdateChannel): void;
  setFeedURL(feed: UpdateFeed): void;
  onUpdateAvailable(listener: () => void): void;
  onUpdateDownloaded(listener: (version: string) => void): void;
  onError(listener: (error: unknown) => void): void;
  checkForUpdates(): Promise<void>;
  downloadUpdate(): Promise<void>;
  quitAndInstall(): void;
}

/**
 * REL-01: a prerelease app version (`1.0.0-beta.N`) is updated from the `beta`
 * channel; a release version from `latest`. Versions that do not parse as a
 * three-part semver are treated as `latest`.
 */
export function channelForVersion(version: string): UpdateChannel {
  return isPrerelease(version) ? 'beta' : 'latest';
}

/** True when a semver string carries a prerelease part (after the first `-`). */
export function isPrerelease(version: string): boolean {
  const match = /^v?(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?/.exec(version.trim());
  return match !== null && match[4] !== undefined && match[4] !== '';
}

export interface AutoUpdateOptions {
  /** The running app's version; decides the channel (REL-01). */
  readonly currentVersion: string;
  readonly feed: UpdateFeed;
  readonly updater: AutoUpdaterPort;
  readonly clock: UpdateClock;
  /** Asks the core host whether a job is running (REL-02). Fails safe to `true`. */
  readonly isJobActive: () => Promise<boolean>;
  /** Tells the window an update is ready to install on next restart. */
  readonly notifyReady: () => void;
  readonly onError?: (error: unknown) => void;
}

/**
 * The auto-update policy. `start()` checks at once and then every 6 hours; a
 * downloaded update is marked ready and the window is told. `installIfIdle()`
 * is called while quitting and installs only when a job is not active.
 */
export class AutoUpdateService {
  private readonly updater: AutoUpdaterPort;
  private ready = false;
  private cancelTimer: (() => void) | null = null;
  private disposed = false;

  constructor(private readonly options: AutoUpdateOptions) {
    this.updater = options.updater;
    // REL-02: main controls installation; electron-updater must not install on quit by itself.
    this.updater.configure({ autoDownload: false, autoInstallOnAppQuit: false });
    this.updater.setChannel(channelForVersion(options.currentVersion));
    this.updater.setFeedURL(options.feed);
    this.updater.onUpdateAvailable(() => {
      void this.download();
    });
    this.updater.onUpdateDownloaded(() => {
      this.markReady();
    });
    this.updater.onError((error) => {
      this.report(error);
    });
  }

  /** True once an update has been downloaded and is waiting for a restart. */
  get isReady(): boolean {
    return this.ready;
  }

  /** REL-02: check now, then every 6 hours. */
  start(): void {
    void this.check();
    this.schedule();
  }

  /**
   * REL-02: called while quitting. Installs and restarts only when an update is
   * ready and the core host reports no active job. Returns whether it installed.
   */
  async installIfIdle(): Promise<boolean> {
    if (this.disposed || !this.ready) return false;
    if (await this.options.isJobActive()) return false;
    if (this.disposed) return false;
    this.updater.quitAndInstall();
    return true;
  }

  dispose(): void {
    this.disposed = true;
    this.cancelTimer?.();
    this.cancelTimer = null;
  }

  private schedule(): void {
    this.cancelTimer = this.options.clock.setTimer(() => {
      this.cancelTimer = null;
      void this.check().finally(() => {
        if (!this.disposed) this.schedule();
      });
    }, UPDATE_CHECK_INTERVAL_MS);
  }

  private async check(): Promise<void> {
    if (this.disposed) return;
    try {
      await this.updater.checkForUpdates();
    } catch (error) {
      this.report(error);
    }
  }

  private async download(): Promise<void> {
    if (this.disposed) return;
    try {
      await this.updater.downloadUpdate();
    } catch (error) {
      this.report(error);
    }
  }

  private markReady(): void {
    if (this.disposed || this.ready) return;
    this.ready = true;
    this.options.notifyReady();
  }

  private report(error: unknown): void {
    this.options.onError?.(error);
  }
}
