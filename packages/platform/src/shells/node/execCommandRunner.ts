/**
 * The real CommandRunner (spec-queue §6/§7): it runs verify checks, after_each
 * gates and the SaaS Factory status script. Process spawning is limited to
 * adapters, git, shells and the engine host (ARC), so platform code that must
 * run a command gets this runner. Commands are argument arrays; no shell is
 * ever used. It never throws: a failed start counts as a non-zero exit.
 */
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileP = promisify(execFile);

export interface ExecRunOptions {
  readonly cwd?: string;
  readonly timeoutMs?: number;
  /** Extra environment on top of the base environment, e.g. ELECTRON_RUN_AS_NODE. */
  readonly env?: Readonly<Record<string, string>> | undefined;
}

export type ExecCommandRunner = (
  cmd: string,
  args: readonly string[],
  options?: ExecRunOptions | undefined,
) => Promise<{ exitCode: number; stdout: string; stderr: string }>;

export interface ExecCommandRunnerOptions {
  /**
   * The environment every command starts with (the app's base env, handed in by
   * the app entry because platform code never reads process.env).
   */
  readonly baseEnv?: Readonly<Record<string, string>> | undefined;
}

/** The fields Node's execFile rejects with on a failed start, timeout or non-zero exit. */
interface ExecFailure {
  readonly code?: unknown;
  readonly exitCode?: unknown;
  readonly stdout?: unknown;
  readonly stderr?: unknown;
  readonly message?: unknown;
}

export function createExecCommandRunner(options: ExecCommandRunnerOptions = {}): ExecCommandRunner {
  const baseEnv = options.baseEnv;
  return async (cmd, args, runOptions = {}) => {
    const env =
      baseEnv !== undefined || runOptions.env !== undefined
        ? { ...(baseEnv ?? {}), ...(runOptions.env ?? {}) }
        : undefined;
    try {
      const result = await execFileP(cmd, [...args], {
        ...(runOptions.cwd !== undefined ? { cwd: runOptions.cwd } : {}),
        ...(runOptions.timeoutMs !== undefined ? { timeout: runOptions.timeoutMs } : {}),
        ...(env !== undefined ? { env } : {}),
      });
      return { exitCode: 0, stdout: result.stdout, stderr: result.stderr };
    } catch (error) {
      const failure = (typeof error === 'object' && error !== null ? error : {}) as ExecFailure;
      // No exit code means the command could not start at all (ENOENT) or was
      // killed (timeout); both count as a failed run: 127, "command not found".
      const exitCode = typeof failure.exitCode === 'number'
        ? failure.exitCode
        : typeof failure.code === 'number'
          ? failure.code
          : 127;
      const stdout = typeof failure.stdout === 'string' ? failure.stdout : '';
      const stderr =
        typeof failure.stderr === 'string' && failure.stderr !== ''
          ? failure.stderr
          : typeof failure.message === 'string'
            ? `${cmd}: ${failure.message}`
            : cmd;
      return { exitCode, stdout, stderr };
    }
  };
}
