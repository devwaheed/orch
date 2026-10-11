/**
 * The electron-updater adapter (S5-03, ARC-05).
 *
 * `electron-updater` is loaded at runtime with `createRequire` (never bundled),
 * so Vite keeps it in node_modules alongside the native modules and this file
 * still type-checks against its published types. The real `autoUpdater` is
 * wrapped into the small `AutoUpdaterPort` the policy uses, so the policy is
 * tested without Electron, a network, or the real updater.
 */
import { createRequire } from 'node:module';
import type { AppUpdater } from 'electron-updater';
import type { AutoUpdaterPort, UpdateChannel, UpdateFeed } from './updater.js';

/** Loads electron-updater's singleton `autoUpdater`. Only call from the packaged main process. */
export function loadAutoUpdater(): AppUpdater {
  const requireFromMain = createRequire(__filename);
  const { autoUpdater } = requireFromMain('electron-updater') as typeof import('electron-updater');
  return autoUpdater;
}

/** Wraps the real `autoUpdater` as the port the policy drives. */
export function createElectronUpdaterPort(updater: AppUpdater): AutoUpdaterPort {
  return {
    configure(options): void {
      updater.autoDownload = options.autoDownload;
      updater.autoInstallOnAppQuit = options.autoInstallOnAppQuit;
    },
    setChannel(channel: UpdateChannel): void {
      updater.channel = channel;
    },
    setFeedURL(feed: UpdateFeed): void {
      updater.setFeedURL({ provider: 'github', owner: feed.owner, repo: feed.repo });
    },
    onUpdateAvailable(listener: () => void): void {
      updater.on('update-available', () => listener());
    },
    onUpdateDownloaded(listener: (version: string) => void): void {
      updater.on('update-downloaded', (event) => listener(event.version));
    },
    onError(listener: (error: unknown) => void): void {
      updater.on('error', (error) => listener(error));
    },
    async checkForUpdates(): Promise<void> {
      await updater.checkForUpdates();
    },
    async downloadUpdate(): Promise<void> {
      await updater.downloadUpdate();
    },
    quitAndInstall(): void {
      updater.quitAndInstall();
    },
  };
}
