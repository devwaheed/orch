import { describe, expect, it, vi } from 'vitest';
import {
  OrchClient,
  fallbackBridge,
  type OrchBridge,
} from '../src/browser/services/orchClient.js';

describe('OrchClient (The preload bridge)', () => {
  it('delegates to the provided bridge', async () => {
    const openExternalMock = vi.fn().mockResolvedValue(undefined);
    const showItemMock = vi.fn().mockResolvedValue(undefined);
    const requestNotifMock = vi.fn().mockResolvedValue(undefined);
    const updateReadyMock = vi.fn().mockReturnValue(() => undefined);
    const reportProblemMock = vi.fn().mockReturnValue(() => undefined);
    const openNewIssueMock = vi.fn().mockResolvedValue(undefined);
    const restartEngineMock = vi.fn().mockResolvedValue(undefined);

    const mockBridge: OrchBridge = {
      connect: async () => undefined,
      app: {
        version: '1.2.3',
        os: 'macos', demo: false,
        home: '/Users/test',
        openExternal: openExternalMock,
        showItemInFolder: showItemMock,
        chooseFolder: async () => null,
        onUpdateReady: updateReadyMock,
        onOpenProject: () => () => undefined,
        cliCommand: { offered: false, install: async () => undefined, uninstall: async () => undefined, machineCheckFinished: async () => undefined },
        onReportProblem: reportProblemMock,
        openNewIssue: openNewIssueMock,
        restartEngine: restartEngineMock,
        requestNotification: requestNotifMock,
      },
    };

    const client = new OrchClient(mockBridge);
    expect(client.version).toBe('1.2.3');
    expect(client.os).toBe('macos');
    expect(client.home).toBe('/Users/test');

    await client.openExternal('https://example.com');
    expect(openExternalMock).toHaveBeenCalledWith('https://example.com');

    await client.showItemInFolder('/path/to/item');
    expect(showItemMock).toHaveBeenCalledWith('/path/to/item');

    const cb = vi.fn();
    client.onUpdateReady(cb);
    expect(updateReadyMock).toHaveBeenCalledWith(cb);

    const reportCb = vi.fn();
    client.onReportProblem(reportCb);
    expect(reportProblemMock).toHaveBeenCalledWith(reportCb);

    await client.openNewIssue();
    expect(openNewIssueMock).toHaveBeenCalledTimes(1);

    await client.restartEngine();
    expect(restartEngineMock).toHaveBeenCalledTimes(1);

    await client.requestNotification('Title', 'Body');
    expect(requestNotifMock).toHaveBeenCalledWith({ title: 'Title', body: 'Body' });

    await expect(client.connect()).resolves.toBeUndefined();
  });

  it('fallback bridge provides dev default values', async () => {
    expect(fallbackBridge.app.version).toBe('0.0.0-dev');
    expect(fallbackBridge.app.home).toBe('');
    expect(fallbackBridge.app.cliCommand.offered).toBe(false);
    await expect(fallbackBridge.app.cliCommand.machineCheckFinished(false)).resolves.toBeUndefined();
    expect(['macos', 'linux', 'windows']).toContain(fallbackBridge.app.os);

    await expect(fallbackBridge.connect()).resolves.toBeUndefined();

    const client = new OrchClient(fallbackBridge);
    expect(client.version).toBe('0.0.0-dev');
    expect(client.home).toBe('');
  });
});
