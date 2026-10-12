import { describe, expect, it } from 'vitest';
import type { OrchEvent } from '@orchagents/contracts';
import { EventsHub } from './coreHostMain.js';

describe('EventsHub', () => {
  it('a window that connects after the engine is ready still learns its health', async () => {
    const hub = new EventsHub();
    hub.fire({ type: 'engine.health', state: 'ready' });
    const seen: OrchEvent[] = [];
    hub.subscribe((e) => seen.push(e));
    await Promise.resolve();
    expect(seen).toEqual([{ type: 'engine.health', state: 'ready' }]);
  });
});
