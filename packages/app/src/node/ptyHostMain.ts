/**
 * Shared start-up for the PTY host, used by the Node child-process entry and
 * the Electron utility-process entry (ADR 0006). Both run the same code; only the
 * port differs.
 */
import { PTY_HOST_READY_TYPE, type ShellHostReady, type ShellPort } from '@orchagents/platform/src/shells/common/shells.js';
import { PtyHost } from '@orchagents/platform/src/shells/node/ptyHost.js';
import type { Os } from '@orchagents/contracts';

export interface PtyHostOptions {
  readonly port: ShellPort;
  readonly baseEnv: Readonly<Record<string, string>>;
  readonly os: Os;
}

export interface RunningPtyHost {
  stop(): Promise<void>;
}

function getDefaultShell(os: Os, baseEnv: Readonly<Record<string, string>>): { shell: string; args: string[] } {
  // The user's shell from the environment (passed in by the app entry)
  // platform code may not read process.env directly
  const userShell = baseEnv.SHELL ?? baseEnv.ComSpec;

  if (os === 'windows') {
    // On Windows, use ConPTY via node-pty with powershell or cmd
    if (userShell && userShell.includes('powershell')) {
      return { shell: userShell, args: ['-NoLogo', '-NoProfile'] };
    }
    return { shell: 'cmd.exe', args: [] };
  }

  // macOS/Linux: use the user's shell
  if (userShell) {
    return { shell: userShell, args: [] };
  }

  // Fallback
  return { shell: '/bin/bash', args: [] };
}

export async function runPtyHost(options: PtyHostOptions): Promise<RunningPtyHost> {
  const { baseEnv, os } = options;
  const { shell, args } = getDefaultShell(os, baseEnv);

  const host = new PtyHost(options.port, {
    defaultShell: shell,
    defaultShellArgs: args,
    baseEnv: { ...baseEnv },
  });

  // Tell the supervisor the host is up, so the restart backoff resets (ENG-07 shape).
  await host.ready;
  options.port.postMessage({ type: PTY_HOST_READY_TYPE } satisfies ShellHostReady);

  return {
    async stop() {
      host.dispose();
    },
  };
}