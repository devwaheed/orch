import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { cliModeArgs } from './cliMode.js';

describe('AppImage CLI startup (INS-03)', () => {
  it('runs the bundled CLI entry with the remaining arguments when --cli is first', () => {
    expect(cliModeArgs(['/m/orch', '--cli', 'accounts', '--json'], '/m/app.asar')).toEqual([
      join('/m/app.asar', 'dist', 'orch.js'),
      'accounts',
      '--json',
    ]);
  });

  it('leaves normal app startup alone', () => {
    expect(cliModeArgs(['/m/orch'], '/m/app.asar')).toBeNull();
  });
});
