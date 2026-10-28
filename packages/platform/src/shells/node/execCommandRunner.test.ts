import { describe, expect, it } from 'vitest';
import * as path from 'node:path';
import { createExecCommandRunner } from './execCommandRunner.js';

describe('createExecCommandRunner', () => {
  it('uses the supplied PATH and preserves argv arguments for quoted command checks', async () => {
    const run = createExecCommandRunner({ baseEnv: { PATH: path.dirname(process.execPath) } });
    const result = await run('node', ['-e', 'process.exit(1)']);
    expect(result.exitCode).toBe(1);
  });
});
