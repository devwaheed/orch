import { describe, expect, it, vi } from 'vitest';
import { runCliMode } from './cliMode.js';

describe('AppImage CLI startup', () => {
  it('runs the remaining arguments through the CLI when --cli is first', async () => {
    const run = vi.fn(async () => 3);

    await expect(runCliMode(['/path/orch.AppImage', '--cli', 'accounts', '--json'], run)).resolves.toBe(3);

    expect(run).toHaveBeenCalledWith(['node', 'orch', 'accounts', '--json']);
  });

  it('leaves normal app startup alone', async () => {
    const run = vi.fn(async () => 0);
    await expect(runCliMode(['/path/orch.AppImage'], run)).resolves.toBeNull();
    expect(run).not.toHaveBeenCalled();
  });
});
