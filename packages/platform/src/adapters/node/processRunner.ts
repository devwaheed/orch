/**
 * The real process runner (ARC-05: execa). It serves both the doctor's ProcessRunner
 * and the accounts' IAccountProcessRunner, so every start goes through one place.
 *
 * - Commands are argument arrays. No shell is ever used.
 * - The environment is the base environment (handed in by the app entry, because
 *   platform code never reads process.env) with the command's own env added on top.
 * - Interactive runs inherit the user's terminal, so an agent's own login can prompt.
 * - Windows command lookup (PATHEXT) is done by execa.
 * - Neither method throws.
 */
import { execa } from 'execa';
import type { CommandSpec } from '@orchagents/contracts';
import type { IAccountProcessRunner, ProcessRun } from '../../accounts/common/accounts.js';
import type { ProcessOutcome, ProcessRunner, RunOptions } from '../../doctor/common/doctor.js';

export interface ProcessRunnerOptions {
  /** The environment every command starts with (the app's process.env, copied by the entry). */
  readonly baseEnv: Readonly<Record<string, string>>;
}

/** The fields execa and Node put on a failed start or a non-zero exit. */
interface SpawnFailure {
  readonly code?: unknown;
  readonly exitCode?: unknown;
  readonly signal?: unknown;
  readonly stdout?: unknown;
  readonly stderr?: unknown;
}

function asText(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

function failureOf(error: unknown): SpawnFailure {
  return typeof error === 'object' && error !== null ? (error as SpawnFailure) : {};
}

function isCommandNotFound(failure: SpawnFailure): boolean {
  return (
    failure.code === 'ENOENT' ||
    failure.exitCode === 127 ||
    failure.code === 'ERR_EXECUTABLE_NOT_FOUND' ||
    /is not recognized as an internal or external command/i.test(asText(failure.stderr))
  );
}

export interface ProcessRunners {
  readonly doctor: ProcessRunner;
  readonly accounts: IAccountProcessRunner;
}

/** Builds the runner pair. Both halves share one base environment. */
export function createProcessRunners(options: ProcessRunnerOptions): ProcessRunners {
  const baseEnv = { ...options.baseEnv };
  const envFor = (extra: Readonly<Record<string, string>> | undefined): Record<string, string> => ({
    ...baseEnv,
    ...(extra ?? {}),
  });

  const doctor: ProcessRunner = {
    async run(argv: readonly string[], runOptions?: RunOptions): Promise<ProcessOutcome> {
      const [file, ...args] = argv;
      if (file === undefined) return { kind: 'did_not_start' };
      try {
        const result = await execa(file, args, {
          env: envFor(runOptions?.env),
          extendEnv: false,
          ...(runOptions?.cwd !== undefined ? { cwd: runOptions.cwd } : {}),
          stdin: 'ignore',
        });
        return { kind: 'ran', exitCode: result.exitCode ?? 0, stdout: asText(result.stdout), stderr: asText(result.stderr) };
      } catch (error) {
        const failure = failureOf(error);
        if (isCommandNotFound(failure)) {
          return { kind: 'not_found' };
        }
        if (typeof failure.exitCode === 'number') {
          return { kind: 'ran', exitCode: failure.exitCode, stdout: asText(failure.stdout), stderr: asText(failure.stderr) };
        }
        return { kind: 'did_not_start' };
      }
    },
  };

  const accounts: IAccountProcessRunner = {
    async run(spec: CommandSpec, runOptions: { readonly interactive: boolean }): Promise<ProcessRun | null> {
      const [file, ...args] = spec.argv;
      if (file === undefined) return null;
      const shared = {
        env: envFor(spec.env),
        extendEnv: false,
        ...(spec.cwd !== undefined ? { cwd: spec.cwd } : {}),
      };
      try {
        if (runOptions.interactive) {
          const result = await execa(file, args, { ...shared, stdio: 'inherit' });
          return { exitCode: result.exitCode ?? 0, stdout: '' };
        }
        const result = await execa(file, args, { ...shared, stdin: 'ignore' });
        return { exitCode: result.exitCode ?? 0, stdout: asText(result.stdout), stderr: asText(result.stderr) };
      } catch (error) {
        const failure = failureOf(error);
        if (isCommandNotFound(failure)) return null;
        if (typeof failure.exitCode === 'number') {
          return { exitCode: failure.exitCode, stdout: asText(failure.stdout), stderr: asText(failure.stderr) };
        }
        // Ended by a signal: the process ran but has no exit code.
        if (failure.signal !== undefined && failure.signal !== null) {
          return { exitCode: null, stdout: asText(failure.stdout) };
        }
        // Not found, or could not start at all.
        return null;
      }
    },
  };

  return { doctor, accounts };
}
