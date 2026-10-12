import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import type { DoctorReport, OrchError, Result } from '@orchagents/contracts';
import { createBugReportBundle } from '@orchagents/platform/src/bugreport/node/index.js';
import { ExitCode } from '../../common/exitCodes.js';
import type { CliServices } from '../client.js';

export interface BugReportCommandOptions {
  /** Output directory */
  readonly out?: string | undefined;
  /** Test seam: user home directory */
  readonly home?: string | undefined;
  /** Test seam: current working directory */
  readonly cwd?: string | undefined;
  /** Test seam: clock override */
  readonly now?: (() => Date) | undefined;
}

/**
 * Traverses up from cwd to find an enclosing git repository root (containing a .git folder or file).
 */
export function findEnclosingRepo(startDir: string): string | null {
  let current = path.resolve(startDir);
  while (true) {
    const gitPath = path.join(current, '.git');
    if (fs.existsSync(gitPath)) {
      return current;
    }
    const parent = path.dirname(current);
    if (parent === current) {
      break;
    }
    current = parent;
  }
  return null;
}

/**
 * CLI (BUG-01): `orch bug-report [--out <folder>]`
 * Builds the bundle locally (so it works when the app isn't running),
 * using the doctor over the channel when the core is reachable and the
 * doctor.json error form when it isn't; specs.yaml from the current folder's
 * repo if inside one. Prints the full path of the zip (BUG-02), exit 0;
 * bad --out -> exit 2.
 */
export async function bugReportCommand(
  getServices: () => Promise<CliServices>,
  options: BugReportCommandOptions,
  stdout: (msg: string) => void,
  stderr: (msg: string) => void,
): Promise<number> {
  const home = options.home ?? os.homedir();
  const cwd = options.cwd ?? process.cwd();

  // Validate --out if provided
  if (options.out !== undefined) {
    const resolvedOut = path.resolve(options.out);
    try {
      if (fs.existsSync(resolvedOut)) {
        const stat = fs.statSync(resolvedOut);
        if (!stat.isDirectory()) {
          stderr(`Output path is not a folder: ${resolvedOut}`);
          return ExitCode.InvalidUsage;
        }
      } else {
        // Try creating it to verify validity/permissions
        fs.mkdirSync(resolvedOut, { recursive: true, mode: 0o700 });
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      stderr(`Invalid output folder: ${msg}`);
      return ExitCode.InvalidUsage;
    }
  }

  // Doctor runner: query core host over channel if reachable, otherwise error form
  const runDoctor = async (): Promise<Result<DoctorReport>> => {
    try {
      const services = await getServices();
      return await services.doctor.run();
    } catch {
        const orchErr: OrchError = {
          code: 'engine_unavailable',
          message: 'orch core host is not reachable',
        };
        return { ok: false, error: orchErr };
    }
  };

  const repoPath = findEnclosingRepo(cwd) ?? undefined;

  const result = await createBugReportBundle({
    home,
    outputDir: options.out !== undefined ? path.resolve(options.out) : undefined,
    runDoctor,
    repoPath,
    now: options.now,
  });

  if (!result.ok) {
    stderr(result.error.message);
    return ExitCode.InvalidUsage;
  }

  stdout(result.value);
  return ExitCode.Success;
}
