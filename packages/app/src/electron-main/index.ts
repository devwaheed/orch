/**
 * Electron main process (ADR 0002, ADR 0006). It owns the app lifecycle, the
 * window, and the three utility-process hosts. It does not carry UI traffic: on
 * each window's request it hands the window a MessagePort to the core host, and
 * from then on the window talks to the core host directly.
 */
import { existsSync } from 'node:fs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { execFile as nodeExecFile } from 'node:child_process';
import { promisify } from 'node:util';
import { createRequire } from 'node:module';
import { homedir } from 'node:os';
import { isAbsolute, join } from 'node:path';
import { app, dialog, ipcMain, Menu, MessageChannelMain, screen, shell, type BrowserWindow, type IpcMainEvent } from 'electron';
import { createMainWindow } from './mainWindow.js';
import { HostSupervisor, REAL_CLOCK, type HostSpec } from './hosts.js';
import { forkUtilityHost } from './utilityProcess.js';
import { loadWindowState, saveWindowState } from './windowState.js';
import { displayKey, planRestore, rememberBounds, type DisplayInfo, type WindowState } from './windowBounds.js';
import { isSafeExternalUrl } from './windowSecurity.js';
import { AutoUpdateService } from './updates/updater.js';
import { ORCH_RELEASES, githubFeedFromPublishConfig, loadPublishConfig } from './updates/feed.js';
import { UPDATE_READY_CHANNEL } from './updates/channels.js';
import { createCoreJobMonitor, type CoreJobMonitor } from './updates/coreJobs.js';
import { createElectronUpdaterPort, loadAutoUpdater } from './updates/electronUpdater.js';
import { NotificationService } from './notifications.js';
import { cliModeArgs, runCliMode } from './cliMode.js';
import { buildNewIssueUrl } from './issueUrl.js';
import { osFromPlatform } from '../electron-preload/api.js';
import { createCliCommand } from './cliCommand.js';

/** Bundle output folder (dist/). Every entry is built next to this file. */
const DIST = __dirname;
/** The workbench's Vite build (packages/workbench). Until it exists, a placeholder page loads. */
const WORKBENCH_INDEX = join(DIST, '..', '..', 'workbench', 'dist', 'index.html');
const PLACEHOLDER_PAGE = join(DIST, 'placeholder.html');

/** electron-builder's config, for its `publish` block (S5-03). Absent in a packaged app. */
const ELECTRON_BUILDER_CONFIG = join(__dirname, '..', 'electron-builder.config.cjs');
const requireFromMain = createRequire(__filename);

const ORCH_ROOT = join(homedir(), '.orch');
const cliCommand = createCliCommand({
  platform: process.platform,
  packaged: app.isPackaged,
  ...(process.env.APPIMAGE ? { appImage: process.env.APPIMAGE } : {}),
  resourcesPath: process.resourcesPath,
  home: homedir(),
  ...(process.env.PATH ? { pathValue: process.env.PATH } : {}),
  runAdmin: async (script) => {
    try {
      await promisify(nodeExecFile)('/usr/bin/osascript', ['-e', script]);
    } catch (error) {
      if (String((error as NodeJS.ErrnoException & { stderr?: string }).stderr ?? '').includes('User canceled')) {
        const cancelled = new Error('User cancelled the administrator prompt.') as NodeJS.ErrnoException;
        cancelled.code = 'USER_CANCELLED';
        throw cancelled;
      }
      throw error;
    }
  },
});
const FIRST_MACHINE_CHECK_FILE = 'cli-command-offer.json';
const UTILITY_ENTRIES = {
  core: join(DIST, 'core-host.cjs'),
  engine: join(DIST, 'engine-host.cjs'),
  // PTY host (S2-06): ptyHost.ts is built as pty-host.cjs when it exists. Until then it is not started.
  pty: join(DIST, 'pty-host.cjs'),
} as const;

const hostSpecs: HostSpec[] = [
  { name: 'core', launch: () => forkUtilityHost('core', UTILITY_ENTRIES.core, []) },
  { name: 'engine', launch: () => forkUtilityHost('engine', UTILITY_ENTRIES.engine, []) },
];
if (existsSync(UTILITY_ENTRIES.pty)) {
  hostSpecs.push({ name: 'pty', launch: () => forkUtilityHost('pty', UTILITY_ENTRIES.pty, []) });
}

function wireEngineChannel(): void {
  const core = supervisors.get('core');
  const engine = supervisors.get('engine');
  if (!core || !engine) return;
  if (core.health.state !== 'ready' || engine.health.state !== 'ready') return;
  const channel = new MessageChannelMain();
  const sentCore = core.post({ type: 'orch.engine.port' }, [channel.port1]);
  const sentEngine = engine.post({ type: 'orch.engine.port' }, [channel.port2]);
  if (!sentCore || !sentEngine) {
    channel.port1.close();
    channel.port2.close();
  }
}

let mainWindow: BrowserWindow | null = null;
let requestedRepo: string | undefined;
let windowState: WindowState = { version: 1, displays: {} };
/** S5-03 auto-update. Null in development, where updates are disabled. */
let updates: AutoUpdateService | null = null;
/** Main's own channel to the core host, for the active-job check at quit. */
let jobMonitor: CoreJobMonitor | null = null;
/** UI-06 native notifications while the window is not focused. */
let notifications: NotificationService | null = null;
/** Set once before-quit has decided whether to install; the next quit proceeds. */
let quitConfirmed = false;

const supervisors = new Map(
  hostSpecs.map((spec) => [
    spec.name,
    new HostSupervisor(spec, REAL_CLOCK, (health) => {
      console.log(`[orch] host ${health.host} ${health.state}${health.message ? `: ${health.message}` : ''}`);
      notifications?.handleHostHealth(health);
      if (health.host === 'core' && health.state === 'ready') {
        const core = supervisors.get('core');
        if (core) notifications?.connect((port) => core.post(null, [port]));
      }
      if (health.state === 'ready' && (health.host === 'core' || health.host === 'engine')) {
        wireEngineChannel();
      }
    }),
  ]),
);

function pageToLoad(): string {
  return existsSync(WORKBENCH_INDEX) ? WORKBENCH_INDEX : PLACEHOLDER_PAGE;
}

function displayInfos(): { all: DisplayInfo[]; primary: DisplayInfo } {
  const toInfo = (display: Electron.Display): DisplayInfo => ({
    key: displayKey(display.bounds, display.scaleFactor),
    workArea: display.workArea,
  });
  return { all: screen.getAllDisplays().map(toInfo), primary: toInfo(screen.getPrimaryDisplay()) };
}

function rememberWindow(win: BrowserWindow): void {
  const display = screen.getDisplayMatching(win.getBounds());
  const info: DisplayInfo = { key: displayKey(display.bounds, display.scaleFactor), workArea: display.workArea };
  const maximized = win.isMaximized();
  const bounds = maximized ? win.getNormalBounds() : win.getBounds();
  windowState = rememberBounds(windowState, info, bounds, maximized);
  void saveWindowState(ORCH_ROOT, windowState);
}

function openWindow(): void {
  const { all, primary } = displayInfos();
  const plan = planRestore(windowState, all, primary);
  mainWindow = createMainWindow({
    preloadPath: join(DIST, 'preload.cjs'),
    pagePath: pageToLoad(),
    bounds: plan.bounds,
    maximized: plan.maximized,
    onBoundsChanged: (win) => rememberWindow(win),
    onReady: () => sendRequestedRepo(),
    onCrash: async (win) => {
      // BUG-01 owner note: native dialog on render-process-gone
      const choice = await dialog.showMessageBox(win, {
        type: 'error',
        title: 'orch stopped unexpectedly',
        message: 'orch stopped unexpectedly',
        buttons: ['Reload', 'Report a problem'],
        defaultId: 0,
        cancelId: 0,
      });
      win.reload();
      if (choice.response === 1) {
        win.webContents.once('did-finish-load', () => {
          win.webContents.send('orch:report-problem');
        });
      }
    },
  });
  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

function sendRequestedRepo(): void {
  if (!requestedRepo || !mainWindow) return;
  if (mainWindow.webContents.isLoading()) {
    mainWindow.webContents.once('did-finish-load', sendRequestedRepo);
    return;
  }
  mainWindow.webContents.send('orch:open-project', requestedRepo);
  requestedRepo = undefined;
}

function focusWindow(): void {
  if (!mainWindow) {
    openWindow();
    return;
  }
  if (mainWindow.isMinimized()) mainWindow.restore();
  mainWindow.focus();
}

/** The window asks for a port; main creates a channel to the core host and hands one end to each side. */
function handlePortRequest(event: IpcMainEvent): void {
  const win = mainWindow;
  if (!win || event.sender !== win.webContents) return;
  const channel = new MessageChannelMain();
  const sent = supervisors.get('core')?.post(null, [channel.port1]) ?? false;
  if (!sent) {
    event.sender.send('orch:port-unavailable');
    return;
  }
  win.webContents.postMessage('orch:port', null, [channel.port2]);
}

function registerIpc(): void {
  const fromWindow = (event: { readonly sender: unknown }): boolean =>
    mainWindow !== null && event.sender === mainWindow.webContents;

  ipcMain.on('orch:request-port', (event) => {
    if (fromWindow(event)) handlePortRequest(event);
  });
  ipcMain.on('orch:app-info', (event) => {
    if (!fromWindow(event)) {
      event.returnValue = null;
      return;
    }
    event.returnValue = {
      version: app.getVersion(),
      home: homedir(),
      cliOffered: cliCommand.offered,
      demo: process.env.ORCH_DEMO === '1',
    };
  });
  ipcMain.handle('orch:open-external', (event, url: unknown) => {
    if (!fromWindow(event) || typeof url !== 'string' || !isSafeExternalUrl(url)) return;
    void shell.openExternal(url);
  });
  ipcMain.handle('orch:choose-folder', async (event) => {
    if (!fromWindow(event) || !mainWindow) return null;
    const picked = await dialog.showOpenDialog(mainWindow, { properties: ['openDirectory'] });
    return picked.canceled ? null : (picked.filePaths[0] ?? null);
  });
  ipcMain.handle('orch:show-item', (event, path: unknown) => {
    if (!fromWindow(event) || typeof path !== 'string' || !isAbsolute(path)) return;
    shell.showItemInFolder(path);
  });
  ipcMain.handle('orch:open-new-issue', (event) => {
    if (!fromWindow(event)) return;
    const publish = loadPublishConfig((id) => requireFromMain(id), ELECTRON_BUILDER_CONFIG);
    const feed = githubFeedFromPublishConfig(publish) ?? ORCH_RELEASES;
    const url = buildNewIssueUrl({
      feed,
      version: app.getVersion(),
      os: osFromPlatform(process.platform),
    });
    if (isSafeExternalUrl(url)) {
      void shell.openExternal(url);
    }
  });
  ipcMain.handle('orch:restart-engine', (event) => {
    if (!fromWindow(event)) return;
    const engine = supervisors.get('engine');
    if (engine) {
      engine.restart();
    }
  });
  ipcMain.handle('orch:cli-install', async (event) => {
    if (!fromWindow(event) || !cliCommand.offered) return;
    await showCliResult(await cliCommand.install(), 'install');
  });
  ipcMain.handle('orch:cli-uninstall', async (event) => {
    if (!fromWindow(event) || !cliCommand.offered) return;
    await showCliResult(await cliCommand.uninstall(), 'remove');
  });
  ipcMain.handle('orch:cli-machine-check-finished', async (event, cliOnPath: unknown) => {
    if (!fromWindow(event) || typeof cliOnPath !== 'boolean' || !cliCommand.offered) return;
    if (cliOnPath) return;
    const file = join(ORCH_ROOT, FIRST_MACHINE_CHECK_FILE);
    try {
      await readFile(file, 'utf8');
      return;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') return;
    }
    await mkdir(ORCH_ROOT, { recursive: true, mode: 0o700 });
    await writeFile(file, `${JSON.stringify({ shown: true })}\n`, { mode: 0o600 });
    const response = await dialog.showMessageBox(mainWindow!, {
      type: 'question', title: 'Use orch from your terminal?',
      message: 'Adds the orch command so you can run jobs and check status from any terminal.',
      buttons: ['Install orch command', 'Not now'], defaultId: 0, cancelId: 1,
    });
    if (response.response === 0) await showCliResult(await cliCommand.install(), 'install');
  });
}

function setApplicationMenu(): void {
  const appItems: Electron.MenuItemConstructorOptions[] = [];
  if (process.platform === 'darwin') appItems.push({ role: 'about' }, { type: 'separator' });
  if (cliCommand.offered) appItems.push(
    { label: 'Install orch command', click: () => { void cliCommand.install().then((result) => showCliResult(result, 'install')); } },
    { label: 'Uninstall orch command', click: () => { void cliCommand.uninstall().then((result) => showCliResult(result, 'remove')); } },
    { type: 'separator' },
  );
  if (process.platform === 'darwin') appItems.push({ role: 'services' }, { type: 'separator' }, { role: 'hide' }, { role: 'hideOthers' }, { role: 'unhide' }, { type: 'separator' });
  appItems.push({ role: 'quit' });
  const template: Electron.MenuItemConstructorOptions[] = [
    { label: app.name, submenu: appItems },
    { role: 'editMenu' },
    { role: 'viewMenu', submenu: [ { role: 'reload' }, ...(app.isPackaged ? [] : [{ role: 'toggleDevTools' as const }]), { type: 'separator' }, { role: 'resetZoom' }, { role: 'zoomIn' }, { role: 'zoomOut' }, { type: 'separator' }, { role: 'togglefullscreen' } ] },
    { role: 'windowMenu' },
    { label: 'Help', submenu: [{ label: 'Report a problem…', click: () => mainWindow?.webContents.send('orch:report-problem') }] },
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

async function showCliResult(result: Awaited<ReturnType<typeof cliCommand.install>>, action: 'install' | 'remove'): Promise<void> {
  if (result.status === 'cancelled') return;
  if (result.status === 'failure') {
    await dialog.showMessageBox(mainWindow!, { type: 'error', message: action === 'install' ? "Couldn't install the orch command." : "Couldn't remove the orch command.", ...(result.detail ? { detail: result.detail } : {}) });
  } else {
    await dialog.showMessageBox(mainWindow!, { type: 'info', message: action === 'install' ? 'The orch command is installed. Open a new terminal and run orch.' : 'The orch command is removed.', ...(result.pathLine ? { detail: `Add this line to your shell profile, then open a new terminal:\n${result.pathLine}` } : {}) });
  }
}

/** Main's own port to the core host, created once the core host is ready. */
function coreJobMonitor(): CoreJobMonitor | null {
  if (jobMonitor) return jobMonitor;
  const core = supervisors.get('core');
  if (!core || core.health.state !== 'ready') return null;
  jobMonitor = createCoreJobMonitor((port) => core.post(null, [port]));
  return jobMonitor;
}

/**
 * S5-03 auto-update: check at start and every 6 hours (REL-02), download, and tell
 * the window it is ready. The update installs on restart, and only when the core
 * host reports no active job. Disabled in development: electron-updater only works
 * in a packaged app.
 */
function startUpdates(): void {
  if (!app.isPackaged) return;
  try {
    const publish = loadPublishConfig((id) => requireFromMain(id), ELECTRON_BUILDER_CONFIG);
    if (publish === undefined) {
      console.warn('[orch] no electron-builder publish config: using the placeholder release feed.');
    }
    const feed = githubFeedFromPublishConfig(publish) ?? ORCH_RELEASES;
    updates = new AutoUpdateService({
      currentVersion: app.getVersion(),
      feed,
      updater: createElectronUpdaterPort(loadAutoUpdater()),
      clock: REAL_CLOCK,
      isJobActive: async () => {
        const monitor = coreJobMonitor();
        // Fail safe: without a confirmed idle core host, never install.
        return monitor ? monitor.isJobActive() : true;
      },
      notifyReady: () => {
        mainWindow?.webContents.send(UPDATE_READY_CHANNEL);
      },
      onError: (error) => {
        console.warn('[orch] update check failed', error);
      },
    });
    updates.start();
  } catch (error) {
    console.warn('[orch] auto-update is unavailable', error);
  }
}

async function start(): Promise<void> {
  const index = process.argv.indexOf('--open-repo');
  requestedRepo = index >= 0 ? process.argv[index + 1] : undefined;
  process.env.ORCH_INSTALL_KIND = !app.isPackaged
    ? 'dev'
    : process.env.APPIMAGE
      ? 'appimage'
      : process.platform === 'darwin'
        ? 'dmg'
        : process.platform === 'win32'
          ? 'nsis'
          : 'deb';
  windowState = await loadWindowState(ORCH_ROOT);
  setApplicationMenu();
  registerIpc();
  notifications = new NotificationService({
    isWindowFocused: () => mainWindow !== null && mainWindow.isFocused(),
  });
  for (const supervisor of supervisors.values()) supervisor.start();
  openWindow();
  startUpdates();
  app.on('activate', () => {
    if (!mainWindow) openWindow();
  });
}

const cliArgs = cliModeArgs(process.argv, app.getAppPath());
if (cliArgs) {
  void runCliMode(process.execPath, cliArgs).then((exitCode) => process.exit(exitCode));
} else {
  const gotLock = app.requestSingleInstanceLock();
  if (!gotLock) {
    app.quit();
  } else {
    app.on('second-instance', (_event, commandLine) => {
      const index = commandLine.indexOf('--open-repo');
      requestedRepo = index >= 0 ? commandLine[index + 1] : undefined;
      focusWindow();
      sendRequestedRepo();
    });
    void app.whenReady().then(start);
  }

  app.on('window-all-closed', () => {
    // macOS keeps the app running until quit; the other systems quit with the window.
    if (process.platform !== 'darwin') app.quit();
  });

  app.on('before-quit', (event) => {
    // REL-02: hold the quit just long enough to ask the core host whether a job is
    // active. installIfIdle installs only then; otherwise the quit continues and the
    // downloaded update stays ready for the next restart.
    if (quitConfirmed || !updates?.isReady) return;
    event.preventDefault();
    quitConfirmed = true;
    void updates.installIfIdle().then((installed) => {
      if (!installed) app.quit();
    });
  });
}

app.on('will-quit', () => {
  for (const supervisor of supervisors.values()) supervisor.dispose();
  notifications?.dispose();
  notifications = null;
  jobMonitor?.dispose();
  jobMonitor = null;
  updates?.dispose();
  updates = null;
});
