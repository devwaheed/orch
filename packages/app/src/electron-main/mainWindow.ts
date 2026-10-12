/**
 * The one app window. Security settings follow SEC-02 exactly: context isolation,
 * sandbox, no Node integration, only the bundled page, no remote content, and
 * external links open in the system browser. Minimum size and bounds follow UI-04.
 */
import { BrowserWindow, shell, type Session } from 'electron';
import { WINDOW_MIN_HEIGHT, WINDOW_MIN_WIDTH, type Rect } from './windowBounds.js';
import { isBundledPage, isSafeExternalUrl } from './windowSecurity.js';

export interface MainWindowOptions {
  readonly preloadPath: string;
  readonly pagePath: string;
  readonly bounds: Rect;
  readonly maximized: boolean;
  /** Called when the window moves, resizes, or closes, so the bounds can be saved. */
  readonly onBoundsChanged: (win: BrowserWindow) => void;
  readonly onReady?: (win: BrowserWindow) => void;
}

export function createMainWindow(options: MainWindowOptions): BrowserWindow {
  const win = new BrowserWindow({
    x: options.bounds.x,
    y: options.bounds.y,
    width: options.bounds.width,
    height: options.bounds.height,
    minWidth: WINDOW_MIN_WIDTH,
    minHeight: WINDOW_MIN_HEIGHT,
    show: false,
    webPreferences: {
      preload: options.preloadPath,
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
      nodeIntegrationInWorker: false,
      nodeIntegrationInSubFrames: false,
      webviewTag: false,
      allowRunningInsecureContent: false,
      experimentalFeatures: false,
    },
  });

  if (options.maximized) win.maximize();

  const contents = win.webContents;

  // Deny every permission request (camera, notifications, geolocation...). Native
  // notifications come from the main process, not the page.
  const session: Session = contents.session;
  session.setPermissionRequestHandler((_webContents, _permission, callback) => callback(false));
  session.setPermissionCheckHandler(() => false);

  // Only the bundled page may load in this window. Anything else is refused, and
  // a web link is opened in the system browser instead.
  contents.setWindowOpenHandler(({ url }) => {
    if (isSafeExternalUrl(url)) void shell.openExternal(url);
    return { action: 'deny' };
  });
  contents.on('will-attach-webview', (event) => event.preventDefault());
  const blockNavigation = (event: { preventDefault(): void }, url: string): void => {
    if (isBundledPage(url, options.pagePath)) return;
    event.preventDefault();
    if (isSafeExternalUrl(url)) void shell.openExternal(url);
  };
  contents.on('will-navigate', blockNavigation);
  contents.on('will-redirect', blockNavigation);

  const reportBounds = (): void => options.onBoundsChanged(win);
  win.on('move', reportBounds);
  win.on('resize', reportBounds);
  win.on('close', reportBounds);

  win.once('ready-to-show', () => {
    win.show();
    options.onReady?.(win);
  });
  void win.loadFile(options.pagePath);
  return win;
}
