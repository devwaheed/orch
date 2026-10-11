import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { confirm, isCancel } from '@clack/prompts';
import { ExitCode } from '../../common/exitCodes.js';
import { createCliSocketTransport } from '../socketTransport.js';

export interface UninstallOptions {
  /** The user's home. Defaults to os.homedir(). */
  readonly home?: string;
  /** Skips the @clack/prompts confirmation (CLI-01 `orch uninstall`). */
  readonly yes?: boolean;
  /** Test seam: replaces @clack/prompts. Returns true to remove, false to cancel. */
  readonly confirm?: (message: string) => Promise<boolean>;
}

/** S5-05: the folder uninstall removes (LOCKED SEC-05: ~/.orch/). */
export function orchRoot(home: string): string {
  return path.join(home, '.orch');
}

/** S5-05 / SEC-01: the socket used to detect a running core host. */
export function orchSocketPath(home: string): string {
  if (process.platform === 'win32') {
    return `\\\\.\\pipe\\orch-${os.userInfo().username}`;
  }
  return path.join(orchRoot(home), 'orch.sock');
}

/** S5-05 / SEC-01: the token used to authenticate against the socket. */
export function orchTokenPath(home: string): string {
  return path.join(orchRoot(home), 'token');
}

/**
 * S5-05: stops the uninstall while the core host is running (SEC-05). The
 * running check goes through the local socket (SEC-01): the socket and the
 * token must both exist and answer an authenticated connection.
 */
export async function isCoreHostRunning(home: string): Promise<boolean> {
  const socketPath = orchSocketPath(home);
  const tokenPath = orchTokenPath(home);
  if (!fs.existsSync(socketPath) || !fs.existsSync(tokenPath)) {
    return false;
  }
  let token: string;
  try {
    token = fs.readFileSync(tokenPath, 'utf8').trim();
  } catch {
    return false;
  }
  if (token.length === 0) {
    return false;
  }
  try {
    const transport = await createCliSocketTransport({ socketPath, token });
    transport.close();
    return true;
  } catch {
    return false;
  }
}

const CONFIRM_MESSAGE =
  'Remove ~/.orch and everything in it? Your repos, worktrees and agents’ own folders (~/.claude, ~/.codex, …) are never touched.';

/**
 * S5-05 / SEC-05: uninstalls orch. Confirms (unless --yes), then removes only
 * ~/.orch/, and never touches repos, worktrees outside it, or the agents' own
 * folders. Refuses a ~/.orch that is a symlink pointing elsewhere. Returns the
 * CLI exit code (CLI-02).
 */
export async function uninstallCommand(
  options: UninstallOptions,
  output: (msg: string) => void,
): Promise<number> {
  const home = options.home ?? os.homedir();
  const root = orchRoot(home);

  if (!fs.existsSync(root)) {
    output('No orch installation found at ~/.orch. Nothing to remove.');
    return ExitCode.Success;
  }

  if (fs.lstatSync(root).isSymbolicLink()) {
    output(
      'Refusing to uninstall: ~/.orch is a symbolic link pointing somewhere else. Uninstall only ever removes the real ~/.orch folder.',
    );
    return ExitCode.ProblemFound;
  }

  if (await isCoreHostRunning(home)) {
    output(
      'orch is running, so uninstall will not remove ~/.orch while its database and socket are open.',
    );
    output('Fix: quit orch (and stop `orch serve`), then run `orch uninstall` again.');
    return ExitCode.ProblemFound;
  }

  if (!options.yes) {
    const proceed = options.confirm
      ? await options.confirm(CONFIRM_MESSAGE)
      : await confirm({ message: CONFIRM_MESSAGE, active: 'Remove', inactive: 'Keep' });
    if (isCancel(proceed) || proceed !== true) {
      output('Uninstall cancelled. Nothing was removed.');
      return ExitCode.Success;
    }
  }

  // SEC-05: delete the resolved real folder, never whatever a race could have
  // repointed ~/.orch at.
  let realRoot = root;
  try {
    realRoot = fs.realpathSync(root);
  } catch {
    // The folder vanished between the checks above; treat it as already removed.
    output('orch is already gone. Nothing to remove.');
    return ExitCode.Success;
  }

  try {
    await fs.promises.rm(realRoot, { recursive: true, force: true });
  } catch {
    output(`Failed to remove ${realRoot}. You may need to close other programs using it.`);
    return ExitCode.ProblemFound;
  }

  output(`✓ orch uninstalled. Removed ${realRoot}.`);
  output('Repos, worktrees outside ~/.orch and your agents’ own folders were left untouched.');
  return ExitCode.Success;
}