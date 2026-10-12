/**
 * The bridge the window sees as `window.orch` (docs/architecture.md, "The preload
 * bridge"). Exactly this object and nothing else. Built from a small IPC surface
 * so the shape is testable without Electron.
 */

export type OrchOs = 'macos' | 'linux' | 'windows';

export interface OrchAppApi {
  readonly version: string;
  readonly os: OrchOs;
  readonly demo: boolean;
  readonly home: string;
  openExternal(url: string): Promise<void>;
  showItemInFolder(path: string): Promise<void>;
  /** The title bar project picker: a native folder dialog; null when cancelled. */
  chooseFolder(): Promise<string | null>;
  onUpdateReady(callback: () => void): () => void;
  onOpenProject(callback: (path: string) => void): () => void;
  readonly cliCommand: { readonly offered: boolean; install(): Promise<void>; uninstall(): Promise<void>; machineCheckFinished(cliOnPath: boolean): Promise<void> };
  onReportProblem(callback: () => void): () => void;
  openNewIssue(): Promise<void>;
  restartEngine(): Promise<void>;
}

/**
 * `connect()` asks the main process for a MessagePort to the core host. Electron's
 * contextBridge cannot carry a MessagePort (it arrives as an empty object), so the
 * port is handed to the page with window.postMessage(ORCH_PORT_MESSAGE, [port]).
 * The promise resolves once the page has been sent the port.
 */
export interface OrchApi {
  connect(): Promise<void>;
  readonly app: OrchAppApi;
}

/** The `data` of the window message that carries the core host port. */
export const ORCH_PORT_MESSAGE = 'orch:port';

/** The part of the page's window the bridge posts the port to. */
export interface PageWindow {
  postMessage(message: unknown, targetOrigin: string, transfer: readonly unknown[]): void;
}

/** The part of Electron's ipcRenderer the bridge uses. */
export interface BridgeIpc<Port> {
  send(channel: string): void;
  sendSync(channel: string): unknown;
  invoke(channel: string, ...args: unknown[]): Promise<unknown>;
  on(channel: string, listener: (event: { ports: readonly Port[] }, ...args: unknown[]) => void): void;
  removeListener(channel: string, listener: (event: { ports: readonly Port[] }, ...args: unknown[]) => void): void;
}

/** Maps Node's platform names to orch's Os values (contracts `Os`). */
export function osFromPlatform(platform: string): OrchOs {
  if (platform === 'darwin') return 'macos';
  if (platform === 'win32') return 'windows';
  return 'linux';
}

export const BRIDGE_CHANNELS = {
  requestPort: 'orch:request-port',
  port: 'orch:port',
  portUnavailable: 'orch:port-unavailable',
  appInfo: 'orch:app-info',
  openExternal: 'orch:open-external',
  showItem: 'orch:show-item',
  chooseFolder: 'orch:choose-folder',
  updateReady: 'orch:update-ready',
  openProject: 'orch:open-project',
  cliInstall: 'orch:cli-install',
  cliUninstall: 'orch:cli-uninstall',
  cliMachineCheckFinished: 'orch:cli-machine-check-finished',
  cliOffered: 'orch:cli-offered',
  reportProblem: 'orch:report-problem',
  openNewIssue: 'orch:open-new-issue',
  restartEngine: 'orch:restart-engine',
} as const;

export function createOrchApi<Port>(
  ipc: BridgeIpc<Port>,
  platform: string,
  page: PageWindow,
): OrchApi {
  const waiting: Array<{ resolve: () => void; reject: (error: Error) => void }> = [];

  // The main process answers each request with a port (or a refusal). Requests are
  // answered in order, so the first waiting caller gets the first answer.
  ipc.on(BRIDGE_CHANNELS.port, (event) => {
    const next = waiting.shift();
    if (!next) return;
    const port = event.ports[0];
    if (port !== undefined) {
      page.postMessage(ORCH_PORT_MESSAGE, '*', [port]);
      next.resolve();
    } else {
      next.reject(new Error('The core host is not available.'));
    }
  });
  ipc.on(BRIDGE_CHANNELS.portUnavailable, () => {
    const next = waiting.shift();
    next?.reject(new Error('The core host is not available.'));
  });

  const info = ipc.sendSync(BRIDGE_CHANNELS.appInfo) as { version?: unknown; home?: unknown; cliOffered?: unknown; demo?: unknown } | null;
  const version = typeof info?.version === 'string' ? info.version : '';
  const home = typeof info?.home === 'string' ? info.home : '';

  return {
    connect: () =>
      new Promise<void>((resolve, reject) => {
        waiting.push({ resolve, reject });
        ipc.send(BRIDGE_CHANNELS.requestPort);
      }),
    app: {
      version,
      os: osFromPlatform(platform),
      demo: info?.demo === true,
      home,
      openExternal: async (url: string) => {
        await ipc.invoke(BRIDGE_CHANNELS.openExternal, url);
      },
      showItemInFolder: async (path: string) => {
        await ipc.invoke(BRIDGE_CHANNELS.showItem, path);
      },
      chooseFolder: async () => {
        const chosen = await ipc.invoke(BRIDGE_CHANNELS.chooseFolder);
        return typeof chosen === 'string' ? chosen : null;
      },
      onUpdateReady: (callback: () => void) => {
        const listener = (): void => callback();
        ipc.on(BRIDGE_CHANNELS.updateReady, listener);
        return () => ipc.removeListener(BRIDGE_CHANNELS.updateReady, listener);
      },
      onOpenProject: (callback: (path: string) => void) => {
        const listener = (_event: { ports: readonly Port[] }, path?: unknown): void => {
          if (typeof path === 'string') callback(path);
        };
        ipc.on(BRIDGE_CHANNELS.openProject, listener);
        return () => ipc.removeListener(BRIDGE_CHANNELS.openProject, listener);
      },
      cliCommand: {
        offered: info?.cliOffered === true,
        install: async () => { await ipc.invoke(BRIDGE_CHANNELS.cliInstall); },
        uninstall: async () => { await ipc.invoke(BRIDGE_CHANNELS.cliUninstall); },
        machineCheckFinished: async (cliOnPath: boolean) => { await ipc.invoke(BRIDGE_CHANNELS.cliMachineCheckFinished, cliOnPath); },
      },
      onReportProblem: (callback: () => void) => {
        const listener = (): void => callback();
        ipc.on(BRIDGE_CHANNELS.reportProblem, listener);
        return () => ipc.removeListener(BRIDGE_CHANNELS.reportProblem, listener);
      },
      openNewIssue: async () => {
        await ipc.invoke(BRIDGE_CHANNELS.openNewIssue);
      },
      restartEngine: async () => {
        await ipc.invoke(BRIDGE_CHANNELS.restartEngine);
      },
    },
  };
}
