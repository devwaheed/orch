import { describe, expect, it, vi } from 'vitest';
import { BRIDGE_CHANNELS, ORCH_PORT_MESSAGE, createOrchApi, osFromPlatform, type BridgeIpc, type PageWindow } from './api.js';

type Listener = (event: { ports: readonly unknown[] }, ...args: unknown[]) => void;

/** A fake ipcRenderer that records sends and lets the test deliver replies. */
function fakeIpc(version: unknown = { version: '1.2.3' }) {
  const listeners = new Map<string, Set<Listener>>();
  const sent: string[] = [];
  const invoked: Array<{ channel: string; args: unknown[] }> = [];
  const ipc: BridgeIpc<unknown> = {
    send: (channel) => sent.push(channel),
    sendSync: (channel) => (channel === BRIDGE_CHANNELS.appInfo ? version : undefined),
    invoke: async (channel, ...args) => {
      invoked.push({ channel, args });
      return undefined;
    },
    on: (channel, listener) => {
      const set = listeners.get(channel) ?? new Set<Listener>();
      set.add(listener as Listener);
      listeners.set(channel, set);
    },
    removeListener: (channel, listener) => {
      listeners.get(channel)?.delete(listener as Listener);
    },
  };
  const deliver = (channel: string, event: { ports: readonly unknown[] } = { ports: [] }, ...args: unknown[]) => {
    for (const listener of listeners.get(channel) ?? []) listener(event, ...args);
  };
  return { ipc, sent, invoked, deliver, listeners };
}

/** A fake page window that records the messages the bridge posts to it. */
function fakePage() {
  const posted: Array<{ message: unknown; origin: string; transfer: readonly unknown[] }> = [];
  const page: PageWindow = {
    postMessage: (message, origin, transfer) => posted.push({ message, origin, transfer }),
  };
  return { page, posted };
}

describe('window.orch (preload bridge)', () => {
  it('exposes exactly connect and app', () => {
    const { ipc } = fakeIpc();
    const api = createOrchApi(ipc, 'darwin', fakePage().page);
    expect(Object.keys(api).sort()).toEqual(['app', 'connect']);
    expect(Object.keys(api.app).sort()).toEqual(['chooseFolder', 'cliCommand', 'demo', 'home', 'onOpenProject', 'onReportProblem', 'onToggleMenuSide', 'onUpdateReady', 'openExternal', 'openNewIssue', 'os', 'restartEngine', 'showItemInFolder', 'version']);
  });

  it('reports the app version, home folder, and the OS in orch terms', () => {
    const { ipc } = fakeIpc({ version: '0.4.0', home: '/Users/test' });
    const api = createOrchApi(ipc, 'win32', fakePage().page);
    expect(api.app.version).toBe('0.4.0');
    expect(api.app.home).toBe('/Users/test');
    expect(api.app.os).toBe('windows');
    expect(api.app.demo).toBe(false);
  });

  it('exposes demo mode from the app info sent by main', () => {
    const { ipc } = fakeIpc({ version: '0.4.0', demo: true });
    expect(createOrchApi(ipc, 'darwin', fakePage().page).app.demo).toBe(true);
  });

  it('maps Node platform names to orch OS names', () => {
    expect(osFromPlatform('darwin')).toBe('macos');
    expect(osFromPlatform('win32')).toBe('windows');
    expect(osFromPlatform('linux')).toBe('linux');
  });

  it('connect hands the core host port to the page and resolves', async () => {
    const { ipc, sent, deliver } = fakeIpc();
    const { page, posted } = fakePage();
    const api = createOrchApi(ipc, 'linux', page);
    const port = { name: 'core-port' };
    const pending = api.connect();
    expect(sent).toEqual([BRIDGE_CHANNELS.requestPort]);
    deliver(BRIDGE_CHANNELS.port, { ports: [port] });
    await expect(pending).resolves.toBeUndefined();
    expect(posted).toEqual([{ message: ORCH_PORT_MESSAGE, origin: '*', transfer: [port] }]);
  });

  it('connect rejects when the core host is unavailable', async () => {
    const { ipc, deliver } = fakeIpc();
    const api = createOrchApi(ipc, 'linux', fakePage().page);
    const pending = api.connect();
    deliver(BRIDGE_CHANNELS.portUnavailable);
    await expect(pending).rejects.toThrow('The core host is not available.');
  });

  it('answers concurrent connects in order', async () => {
    const { ipc, deliver } = fakeIpc();
    const { page, posted } = fakePage();
    const api = createOrchApi(ipc, 'linux', page);
    const first = api.connect();
    const second = api.connect();
    deliver(BRIDGE_CHANNELS.port, { ports: ['one'] });
    deliver(BRIDGE_CHANNELS.port, { ports: ['two'] });
    await expect(first).resolves.toBeUndefined();
    await expect(second).resolves.toBeUndefined();
    expect(posted.map((p) => p.transfer)).toEqual([['one'], ['two']]);
  });

  it('forwards openExternal and showItemInFolder to the main process', async () => {
    const { ipc, invoked } = fakeIpc();
    const api = createOrchApi(ipc, 'linux', fakePage().page);
    await api.app.openExternal('https://example.com');
    await api.app.showItemInFolder('/Users/me/repo');
    expect(invoked).toEqual([
      { channel: BRIDGE_CHANNELS.openExternal, args: ['https://example.com'] },
      { channel: BRIDGE_CHANNELS.showItem, args: ['/Users/me/repo'] },
    ]);
  });

  it('forwards openNewIssue and restartEngine to the main process', async () => {
    const { ipc, invoked } = fakeIpc();
    const api = createOrchApi(ipc, 'linux', fakePage().page);
    await api.app.openNewIssue();
    await api.app.restartEngine();
    expect(invoked).toEqual([
      { channel: BRIDGE_CHANNELS.openNewIssue, args: [] },
      { channel: BRIDGE_CHANNELS.restartEngine, args: [] },
    ]);
  });

  it('onUpdateReady subscribes and unsubscribes', () => {
    const { ipc, listeners, deliver } = fakeIpc();
    const api = createOrchApi(ipc, 'linux', fakePage().page);
    const callback = vi.fn();
    const unsubscribe = api.app.onUpdateReady(callback);
    deliver(BRIDGE_CHANNELS.updateReady);
    expect(callback).toHaveBeenCalledTimes(1);
    unsubscribe();
    deliver(BRIDGE_CHANNELS.updateReady);
    expect(callback).toHaveBeenCalledTimes(1);
    expect(listeners.get(BRIDGE_CHANNELS.updateReady)?.size).toBe(0);
  });

  it('onOpenProject forwards a repo path and unsubscribes', () => {
    const { ipc, listeners, deliver } = fakeIpc();
    const api = createOrchApi(ipc, 'linux', fakePage().page);
    const callback = vi.fn();
    const unsubscribe = api.app.onOpenProject(callback);
    deliver(BRIDGE_CHANNELS.openProject, { ports: [] }, '/repo');
    expect(callback).toHaveBeenCalledWith('/repo');
    unsubscribe();
    deliver(BRIDGE_CHANNELS.openProject, { ports: [] }, '/other');
    expect(callback).toHaveBeenCalledTimes(1);
    expect(listeners.get(BRIDGE_CHANNELS.openProject)?.size).toBe(0);
  });

  it('exposes CLI install actions and validates the machine check boolean in main', async () => {
    const { ipc, invoked } = fakeIpc({ version: '1.0', cliOffered: true });
    const api = createOrchApi(ipc, 'darwin', fakePage().page);
    expect(api.app.cliCommand.offered).toBe(true);
    await api.app.cliCommand.install();
    await api.app.cliCommand.uninstall();
    await api.app.cliCommand.machineCheckFinished(false);
    expect(invoked).toEqual([
      { channel: BRIDGE_CHANNELS.cliInstall, args: [] },
      { channel: BRIDGE_CHANNELS.cliUninstall, args: [] },
      { channel: BRIDGE_CHANNELS.cliMachineCheckFinished, args: [false] },
    ]);
  });

  it('onReportProblem subscribes and unsubscribes', () => {
    const { ipc, listeners, deliver } = fakeIpc();
    const api = createOrchApi(ipc, 'linux', fakePage().page);
    const callback = vi.fn();
    const unsubscribe = api.app.onReportProblem(callback);
    deliver(BRIDGE_CHANNELS.reportProblem);
    expect(callback).toHaveBeenCalledTimes(1);
    unsubscribe();
    deliver(BRIDGE_CHANNELS.reportProblem);
    expect(callback).toHaveBeenCalledTimes(1);
    expect(listeners.get(BRIDGE_CHANNELS.reportProblem)?.size).toBe(0);
  });
});

describe('preload entry', () => {
  it('exposes the bridge as window.orch through contextBridge', async () => {
    const exposeInMainWorld = vi.fn();
    vi.resetModules();
    vi.doMock('electron', () => ({
      contextBridge: { exposeInMainWorld },
      ipcRenderer: {
        on: () => undefined,
        removeListener: () => undefined,
        send: () => undefined,
        sendSync: () => ({ version: '0.0.0' }),
        invoke: async () => undefined,
      },
    }));
    await import('./index.js');
    expect(exposeInMainWorld).toHaveBeenCalledTimes(1);
    const [key, api] = exposeInMainWorld.mock.calls[0] as [string, { connect: unknown; app: object }];
    expect(key).toBe('orch');
    expect(Object.keys(api).sort()).toEqual(['app', 'connect']);
    vi.doUnmock('electron');
  });
});
