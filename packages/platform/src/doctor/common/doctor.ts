/**
 * Doctor types shared by the checks and the service. Plain TypeScript.
 * Starting processes is limited to adapters, git, shells and the engine host
 * (tools/depcruise.cjs), so the doctor receives a ProcessRunner instead of spawning.
 */
import { createServiceId } from '@orch/base';
import type { IDoctorService } from '@orch/contracts';

export interface RunOptions {
  cwd?: string;
  /** Merged over the process environment by the runner. */
  env?: Readonly<Record<string, string>>;
}

/** What happened when the runner tried to start a command. */
export type ProcessOutcome =
  | { readonly kind: 'ran'; readonly exitCode: number; readonly stdout: string; readonly stderr: string }
  /** The command is not on PATH. */
  | { readonly kind: 'not_found' }
  /** The command was found but could not be started (permissions, bad binary, …). */
  | { readonly kind: 'did_not_start' };

export interface ProcessRunner {
  /** argv[0] is the command. Never a shell string. */
  run(argv: readonly string[], options?: RunOptions): Promise<ProcessOutcome>;
}

export const IDoctorServiceId = createServiceId<IDoctorService>('doctor');
