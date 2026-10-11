import { describe, expect, it } from 'vitest';
import { BRIDGE_CHANNELS } from '../../electron-preload/api.js';
import { UPDATE_READY_CHANNEL } from './channels.js';

describe('S5-03 update-ready signal', () => {
  it('uses the channel the preload bridge listens on', () => {
    expect(UPDATE_READY_CHANNEL).toBe(BRIDGE_CHANNELS.updateReady);
  });
});
