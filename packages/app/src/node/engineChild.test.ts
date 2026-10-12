import { describe, expect, it } from 'vitest';
import type { OrchEvent } from '@orchagents/contracts';
import { EngineChild } from './engineChild.js';

describe('EngineChild with an engine Electron hands over', () => {
  it('reports the engine ready to the window, since no supervisor here will', async () => {
    const health: OrchEvent[] = [];
    const engine = new EngineChild(null, (e) => health.push(e));
    let deliver: (message: unknown) => void = () => undefined;
    engine.attachPort({ postMessage: () => undefined, on: (_event, listener) => void (deliver = listener) });
    deliver({ type: 'engine.ready', engineVersion: '7.5.6' });
    await engine.whenReady();
    expect(health).toEqual([{ type: 'engine.health', state: 'ready' }]);
  });
});
