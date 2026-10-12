/**
 * Runs an agent's own sign-in in a PTY-host terminal, so agents that need a terminal
 * (Gemini CLI, Antigravity) can prompt, and the Add account dialog shows it. The exit
 * code is kept for the sign-in checks.
 */
import { ok } from '@orchagents/base';
import type { CommandSpec, OrchEvent, Os, Result, ShellId } from '@orchagents/contracts';
import type { Event } from '@orchagents/base';
import type { ISignInTerminal } from '@orchagents/platform/src/accounts/node/accountsService.js';

export interface SignInShells {
  readonly onEvent: Event<OrchEvent>;
  openCommand(argv: readonly string[], env: Readonly<Record<string, string>>, cwd: string, cols: number, rows: number): Promise<Result<ShellId>>;
}

export function createSignInTerminal(shells: () => SignInShells, os: Os, home: string): ISignInTerminal {
  return {
    async open(spec: CommandSpec, cols: number, rows: number) {
      let shellId: string | null = null;
      // An exit can arrive before openCommand returns the id (a login that fails at once).
      const early = new Map<string, number | null>();
      let resolveExit: (code: number | null) => void = () => undefined;
      const exited = new Promise<number | null>((resolve) => {
        resolveExit = resolve;
      });
      const subscription = shells().onEvent((event) => {
        if (event.type !== 'shell.exited') return;
        if (shellId === null) early.set(event.shellId, event.code);
        else if (event.shellId === shellId) {
          subscription.dispose();
          resolveExit(event.code);
        }
      });
      // Windows: agents install as .cmd shims, which only cmd.exe can start. The argv is fixed by the adapter.
      const argv = os === 'windows' ? ['cmd.exe', '/d', '/c', ...spec.argv] : spec.argv;
      const opened = await shells().openCommand(argv, spec.env, spec.cwd ?? home, cols, rows);
      if (!opened.ok) {
        subscription.dispose();
        return opened;
      }
      shellId = opened.value;
      if (early.has(shellId)) {
        subscription.dispose();
        resolveExit(early.get(shellId) ?? null);
      }
      return ok({ shellId: opened.value, exited });
    },
  };
}
