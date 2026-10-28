import { describe, expect, it } from 'vitest';
import { coreHostEnv } from './coreHostEnv.js';

describe('coreHostEnv', () => {
  it('uses the PATH resolved in Electron main for command checks', () => {
    expect(coreHostEnv({ PATH: '/usr/bin:/bin' }, ['--orch-resolved-path', '/opt/homebrew/bin:/usr/bin:/bin'])).toEqual({
      PATH: '/opt/homebrew/bin:/usr/bin:/bin',
    });
  });

  it('keeps Windows PATH casing when overriding the inherited path', () => {
    expect(coreHostEnv({ Path: 'C:\\Windows\\System32' }, ['--orch-resolved-path', 'C:\\Node;C:\\Windows\\System32'])).toEqual({
      Path: 'C:\\Node;C:\\Windows\\System32',
    });
  });
});
