/**
 * Electron main process (ADR 0002, ADR 0006). It owns the app lifecycle, the
 * window, and the three utility-process hosts. It does not carry UI traffic: on
 * each window's request it hands the window a MessagePort to the core host, and
 * from then on the window talks to the core host directly.
 */
import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { isAbsolute, join } from 'node:path';
import { app, ipcMain, MessageChannelMain, screen, shell, type BrowserWindow, type IpcMainEvent } from 'electron';
import { createMainWindow } from './mainWindow.js';
import { HostSupervisor, REAL_CLOCK, type HostSpec } from './hosts.js';
import { forkUtilityHost } from './utilityProcess.js';
import { loadWindowState, saveWindowState } from './windowState.js';
import { displayKey, planRestore, rememberBounds, type DisplayInfo, type WindowState } from './windowBounds.js';
import { isSafeExternalUrl } from './windowSecurity.js';

/** Bundle output folder (dist/). Every entry is built next to this file. */
const DIST = __dirname;
/** The workbench's Vite build (packages/workbench). Until it exists, a placeholder page loads. */
const WORKBENCH_INDEX = join(DIST, '..', '..', 'workbench', 'dist', 'index.html');
const PLACEHOLDER_PAGE = join(DIST, 'placeholder.html');

const ORCH_ROOT = join(homedir(), '.orch');
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

const supervisors = new Map(
  hostSpecs.map((spec) => [
    spec.name,
    new HostSupervisor(spec, REAL_CLOCK, (health) => {
      console.log(`[orch] host ${health.host} ${health.state}${health.message ? `: ${health.message}` : ''}`);
      if (health.state === 'ready' && (health.host === 'core' || health.host === 'engine')) {
        wireEngineChannel();
      }
    }),
  ]),
);

let mainWindow: BrowserWindow | null = null;
let windowState: WindowState = { version: 1, displays: {} };

const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  app.on('second-instance', () => focusWindow());
  void app.whenReady().then(start);
}

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
  });
  mainWindow.on('closed', () => {
    mainWindow = null;
  });
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
    event.returnValue = { version: app.getVersion() };
  });
  ipcMain.handle('orch:open-external', (event, url: unknown) => {
    if (!fromWindow(event) || typeof url !== 'string' || !isSafeExternalUrl(url)) return;
    void shell.openExternal(url);
  });
  ipcMain.handle('orch:show-item', (event, path: unknown) => {
    if (!fromWindow(event) || typeof path !== 'string' || !isAbsolute(path)) return;
    shell.showItemInFolder(path);
  });
}

async function start(): Promise<void> {
  windowState = await loadWindowState(ORCH_ROOT);
  registerIpc();
  for (const supervisor of supervisors.values()) supervisor.start();
  openWindow();
  app.on('activate', () => {
    if (!mainWindow) openWindow();
  });
}

app.on('window-all-closed', () => {
  // macOS keeps the app running until quit; the other systems quit with the window.
  if (process.platform !== 'darwin') app.quit();
});

app.on('before-quit', () => {
  for (const supervisor of supervisors.values()) supervisor.dispose();
});
