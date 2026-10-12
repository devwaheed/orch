import { describe, expect, it } from 'vitest';
import { Emitter, ok } from '@orchagents/base';
import type { OrchEvent, ShellId } from '@orchagents/contracts';
import { createSignInTerminal } from './signInTerminal.js';

function fakeShells(exitBeforeReply: boolean) {
  const emitter = new Emitter<OrchEvent>();
  const opened: { argv: readonly string[]; env: Readonly<Record<string, string>>; cwd: string }[] = [];
  const shellId = 'sh-1' as ShellId;
  return {
    opened,
    exit: (code: number | null) => emitter.fire({ type: 'shell.exited', shellId, code }),
    shells: {
      onEvent: emitter.event,
      async openCommand(argv: readonly string[], env: Readonly<Record<string, string>>, cwd: string) {
        opened.push({ argv, env, cwd });
        if (exitBeforeReply) emitter.fire({ type: 'shell.exited', shellId, code: 1 });
        return ok(shellId);
      },
    },
  };
}

describe('createSignInTerminal', () => {
  it('starts the login in the profile env and reports its exit code', async () => {
    const fake = fakeShells(false);
    const terminal = createSignInTerminal(() => fake.shells, 'macos', '/home/u');
    const result = await terminal.open({ argv: ['codex', 'login'], env: { CODEX_HOME: '/p' } }, 80, 24);
    if (!result.ok) throw new Error('open failed');
    expect(fake.opened).toEqual([{ argv: ['codex', 'login'], env: { CODEX_HOME: '/p' }, cwd: '/home/u' }]);
    fake.exit(0);
    await expect(result.value.exited).resolves.toBe(0);
  });

  it('keeps an exit that arrives before the shell id, and wraps Windows shims in cmd.exe', async () => {
    const fake = fakeShells(true);
    const terminal = createSignInTerminal(() => fake.shells, 'windows', 'C:\\Users\\u');
    const result = await terminal.open({ argv: ['agy'], env: {} }, 80, 24);
    if (!result.ok) throw new Error('open failed');
    await expect(result.value.exited).resolves.toBe(1);
    expect(fake.opened[0]?.argv).toEqual(['cmd.exe', '/d', '/c', 'agy']);
  });
});
