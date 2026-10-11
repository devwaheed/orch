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

    const mockBridge: OrchBridge = {
      connect: async () => new MessageChannel().port1,
      app: {
        version: '1.2.3',
        os: 'macos',
        openExternal: openExternalMock,
        showItemInFolder: showItemMock,
        onUpdateReady: updateReadyMock,
        requestNotification: requestNotifMock,
      },
    };

    const client = new OrchClient(mockBridge);
    expect(client.version).toBe('1.2.3');
    expect(client.os).toBe('macos');

    await client.openExternal('https://example.com');
    expect(openExternalMock).toHaveBeenCalledWith('https://example.com');

    await client.showItemInFolder('/path/to/item');
    expect(showItemMock).toHaveBeenCalledWith('/path/to/item');

    const cb = vi.fn();
    client.onUpdateReady(cb);
    expect(updateReadyMock).toHaveBeenCalledWith(cb);

    await client.requestNotification('Title', 'Body');
    expect(requestNotifMock).toHaveBeenCalledWith({ title: 'Title', body: 'Body' });

    const port = await client.connect();
    expect(port).toBeDefined();
  });

  it('fallback bridge provides dev default values', async () => {
    expect(fallbackBridge.app.version).toBe('0.0.0-dev');
    expect(['macos', 'linux', 'windows']).toContain(fallbackBridge.app.os);

    const port = await fallbackBridge.connect();
    expect(port).toBeDefined();

    const client = new OrchClient(fallbackBridge);
    expect(client.version).toBe('0.0.0-dev');
  });
});
