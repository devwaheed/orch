import { describe, expect, it } from 'vitest';
import { appCliArgv } from './cliArgv.js';

describe('app CLI argv', () => {
  it('drops the executable and bundled script paths for the CLI parser', () => {
    expect(appCliArgv(['/Applications/orch.app/Contents/MacOS/orch', '/path/app.asar/dist/orch.js', 'accounts', '--json']))
      .toEqual(['node', 'orch', 'accounts', '--json']);
  });
});
