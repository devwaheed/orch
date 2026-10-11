/**
 * Command handlers and registration for orch specs (docs/specs/spec-queue.md §13).
 */
import { type ISpecsService, SpecId, type SpecQueue } from '@orch/contracts';
import type { Command } from 'commander';
import { ExitCode } from '../../common/exitCodes.js';
import type { CliServices } from '../client.js';
import { formatBmadInitReport, formatProblems, formatSpecsTable } from './format.js';

export function getSpecsService(services: CliServices): ISpecsService {
  return services.client.getService<ISpecsService>('specs');
}

async function loadQueueForControl(
  services: CliServices,
  repoPath: string,
  output: (msg: string) => void,
): Promise<SpecQueue | null> {
  const specsService = getSpecsService(services);
  const loadResult = await specsService.load(repoPath);

  if (!loadResult.ok) {
    output(
      `Error: ${loadResult.error.message}${loadResult.error.fix ? `\nFix: ${loadResult.error.fix}` : ''}`,
    );
    return null;
  }

  const { queue, problems } = loadResult.value;
  if (problems.length > 0) {
    output(`Cannot manage queue while problems exist:\n${formatProblems(problems)}`);
    return null;
  }

  if (!queue) {
    output('No spec queue found.');
    return null;
  }

  return queue;
}

/**
 * orch specs: list the queue as in the Specs view, one line per spec.
 */
export async function specsListCommand(
  services: CliServices,
  options: { repo?: string | undefined; json?: boolean | undefined },
  output: (msg: string) => void,
): Promise<number> {
  const repoPath = options.repo ?? process.cwd();
  const specsService = getSpecsService(services);
  const loadResult = await specsService.load(repoPath);

  if (!loadResult.ok) {
    output(
      `Error: ${loadResult.error.message}${loadResult.error.fix ? `\nFix: ${loadResult.error.fix}` : ''}`,
    );
    return ExitCode.ProblemFound;
  }

  const { queue, problems } = loadResult.value;

  if (problems.length > 0) {
    if (options.json) {
      output(JSON.stringify(problems, null, 2));
    } else {
      output(formatProblems(problems));
    }
    return ExitCode.ProblemFound;
  }

  if (!queue) {
    if (options.json) {
      output(JSON.stringify([], null, 2));
    } else {
      output('No spec queue found.');
    }
    return ExitCode.Success;
  }

  if (options.json) {
    output(JSON.stringify(queue.specs, null, 2));
    return ExitCode.Success;
  }

  output(formatSpecsTable(queue));
  return ExitCode.Success;
}

/**
 * orch specs check: load and print problems (§11); exit code 1 if any.
 */
export async function specsCheckCommand(
  services: CliServices,
  options: { repo?: string | undefined; json?: boolean | undefined },
  output: (msg: string) => void,
): Promise<number> {
  const repoPath = options.repo ?? process.cwd();
  const specsService = getSpecsService(services);
  const loadResult = await specsService.load(repoPath);

  if (!loadResult.ok) {
    output(
      `Error: ${loadResult.error.message}${loadResult.error.fix ? `\nFix: ${loadResult.error.fix}` : ''}`,
    );
    return ExitCode.ProblemFound;
  }

  const { queue, problems } = loadResult.value;

  if (options.json) {
    output(JSON.stringify(problems, null, 2));
    return problems.length > 0 ? ExitCode.ProblemFound : ExitCode.Success;
  }

  if (problems.length > 0) {
    output(formatProblems(problems));
    return ExitCode.ProblemFound;
  }

  const count = queue?.specs.length ?? 0;
  output(`✓ No problems found (${count} ${count === 1 ? 'spec' : 'specs'}).`);
  return ExitCode.Success;
}

/**
 * orch specs init: add front matter to stories that lack it (§2), then list what it added.
 */
export async function specsInitCommand(
  services: CliServices,
  options: { repo?: string | undefined; json?: boolean | undefined },
  output: (msg: string) => void,
): Promise<number> {
  const repoPath = options.repo ?? process.cwd();
  const specsService = getSpecsService(services);

  const initResult = await specsService.init(repoPath);
  if (!initResult.ok) {
    output(
      `Error: ${initResult.error.message}${initResult.error.fix ? `\nFix: ${initResult.error.fix}` : ''}`,
    );
    return ExitCode.ProblemFound;
  }

  if (options.json) {
    output(JSON.stringify(initResult.value, null, 2));
    return ExitCode.Success;
  }

  output(formatBmadInitReport(initResult.value));
  return ExitCode.Success;
}

/**
 * orch specs start: start queue execution.
 */
export async function specsStartCommand(
  services: CliServices,
  options: { repo?: string | undefined; json?: boolean | undefined },
  output: (msg: string) => void,
): Promise<number> {
  const repoPath = options.repo ?? process.cwd();
  const queue = await loadQueueForControl(services, repoPath, output);
  if (!queue) {
    return ExitCode.ProblemFound;
  }

  const specsService = getSpecsService(services);
  const res = await specsService.start(queue.id);
  if (!res.ok) {
    output(`Error: ${res.error.message}${res.error.fix ? `\nFix: ${res.error.fix}` : ''}`);
    return ExitCode.ProblemFound;
  }

  if (options.json) {
    output(JSON.stringify({ queueId: queue.id, action: 'start', status: 'started' }, null, 2));
    return ExitCode.Success;
  }

  output(`✓ Spec queue started (${queue.id}).`);
  return ExitCode.Success;
}

/**
 * orch specs pause: pause queue execution.
 */
export async function specsPauseCommand(
  services: CliServices,
  options: { repo?: string | undefined; json?: boolean | undefined },
  output: (msg: string) => void,
): Promise<number> {
  const repoPath = options.repo ?? process.cwd();
  const queue = await loadQueueForControl(services, repoPath, output);
  if (!queue) {
    return ExitCode.ProblemFound;
  }

  const specsService = getSpecsService(services);
  const res = await specsService.pause(queue.id);
  if (!res.ok) {
    output(`Error: ${res.error.message}${res.error.fix ? `\nFix: ${res.error.fix}` : ''}`);
    return ExitCode.ProblemFound;
  }

  if (options.json) {
    output(JSON.stringify({ queueId: queue.id, action: 'pause', status: 'paused' }, null, 2));
    return ExitCode.Success;
  }

  output(
    `✓ Spec queue paused (${queue.id}). Running specs finish; nothing new starts until you resume.`,
  );
  return ExitCode.Success;
}

/**
 * orch specs resume: resume queue execution.
 */
export async function specsResumeCommand(
  services: CliServices,
  options: { repo?: string | undefined; json?: boolean | undefined },
  output: (msg: string) => void,
): Promise<number> {
  const repoPath = options.repo ?? process.cwd();
  const queue = await loadQueueForControl(services, repoPath, output);
  if (!queue) {
    return ExitCode.ProblemFound;
  }

  const specsService = getSpecsService(services);
  const res = await specsService.resume(queue.id);
  if (!res.ok) {
    output(`Error: ${res.error.message}${res.error.fix ? `\nFix: ${res.error.fix}` : ''}`);
    return ExitCode.ProblemFound;
  }

  if (options.json) {
    output(JSON.stringify({ queueId: queue.id, action: 'resume', status: 'resumed' }, null, 2));
    return ExitCode.Success;
  }

  output(`✓ Spec queue resumed (${queue.id}).`);
  return ExitCode.Success;
}

/**
 * orch specs cancel: cancel queue execution.
 */
export async function specsCancelCommand(
  services: CliServices,
  options: { repo?: string | undefined; json?: boolean | undefined },
  output: (msg: string) => void,
): Promise<number> {
  const repoPath = options.repo ?? process.cwd();
  const queue = await loadQueueForControl(services, repoPath, output);
  if (!queue) {
    return ExitCode.ProblemFound;
  }

  const specsService = getSpecsService(services);
  const res = await specsService.cancel(queue.id);
  if (!res.ok) {
    output(`Error: ${res.error.message}${res.error.fix ? `\nFix: ${res.error.fix}` : ''}`);
    return ExitCode.ProblemFound;
  }

  if (options.json) {
    output(
      JSON.stringify({ queueId: queue.id, action: 'cancel', status: 'cancelled' }, null, 2),
    );
    return ExitCode.Success;
  }

  output(`✓ Spec queue cancelled (${queue.id}).`);
  return ExitCode.Success;
}

/**
 * orch specs skip <id>: per spec skip.
 */
export async function specsSkipCommand(
  services: CliServices,
  idStr: string,
  options: { repo?: string | undefined; json?: boolean | undefined },
  output: (msg: string) => void,
): Promise<number> {
  const parsedId = SpecId.safeParse(idStr);
  if (!parsedId.success) {
    output(`Invalid spec id '${idStr}'. Spec id must be 1 to 4 digits.`);
    return ExitCode.InvalidUsage;
  }

  const repoPath = options.repo ?? process.cwd();
  const queue = await loadQueueForControl(services, repoPath, output);
  if (!queue) {
    return ExitCode.ProblemFound;
  }

  const specsService = getSpecsService(services);
  const res = await specsService.skip(queue.id, parsedId.data);
  if (!res.ok) {
    output(`Error: ${res.error.message}${res.error.fix ? `\nFix: ${res.error.fix}` : ''}`);
    return ExitCode.ProblemFound;
  }

  if (options.json) {
    output(
      JSON.stringify(
        { queueId: queue.id, specId: parsedId.data, action: 'skip', status: 'skipped' },
        null,
        2,
      ),
    );
    return ExitCode.Success;
  }

  output(`✓ Spec ${parsedId.data} skipped.`);
  return ExitCode.Success;
}

/**
 * orch specs retry <id>: per spec retry (resets attempt to queued).
 */
export async function specsRetryCommand(
  services: CliServices,
  idStr: string,
  options: { repo?: string | undefined; json?: boolean | undefined },
  output: (msg: string) => void,
): Promise<number> {
  const parsedId = SpecId.safeParse(idStr);
  if (!parsedId.success) {
    output(`Invalid spec id '${idStr}'. Spec id must be 1 to 4 digits.`);
    return ExitCode.InvalidUsage;
  }

  const repoPath = options.repo ?? process.cwd();
  const queue = await loadQueueForControl(services, repoPath, output);
  if (!queue) {
    return ExitCode.ProblemFound;
  }

  const specsService = getSpecsService(services);
  const res = await specsService.retry(queue.id, parsedId.data);
  if (!res.ok) {
    output(`Error: ${res.error.message}${res.error.fix ? `\nFix: ${res.error.fix}` : ''}`);
    return ExitCode.ProblemFound;
  }

  if (options.json) {
    output(
      JSON.stringify(
        { queueId: queue.id, specId: parsedId.data, action: 'retry', status: 'queued' },
        null,
        2,
      ),
    );
    return ExitCode.Success;
  }

  output(`✓ Spec ${parsedId.data} retried (reset to queued).`);
  return ExitCode.Success;
}

/**
 * orch specs move <id> <position>: reorder spec in queue (§10).
 */
export async function specsMoveCommand(
  services: CliServices,
  idStr: string,
  positionStr: string,
  options: { repo?: string | undefined; json?: boolean | undefined },
  output: (msg: string) => void,
): Promise<number> {
  const parsedId = SpecId.safeParse(idStr);
  if (!parsedId.success) {
    output(`Invalid spec id '${idStr}'. Spec id must be 1 to 4 digits.`);
    return ExitCode.InvalidUsage;
  }

  const position = Number.parseInt(positionStr, 10);
  if (Number.isNaN(position) || position < 1 || String(position) !== positionStr.trim()) {
    output(`Invalid position '${positionStr}'. Position must be a positive integer.`);
    return ExitCode.InvalidUsage;
  }

  const repoPath = options.repo ?? process.cwd();
  const queue = await loadQueueForControl(services, repoPath, output);
  if (!queue) {
    return ExitCode.ProblemFound;
  }

  const specsService = getSpecsService(services);
  const res = await specsService.move(queue.id, parsedId.data, position);
  if (!res.ok) {
    output(`Error: ${res.error.message}${res.error.fix ? `\nFix: ${res.error.fix}` : ''}`);
    return ExitCode.ProblemFound;
  }

  if (options.json) {
    output(
      JSON.stringify(
        { queueId: queue.id, specId: parsedId.data, position, action: 'move' },
        null,
        2,
      ),
    );
    return ExitCode.Success;
  }

  output(`✓ Spec ${parsedId.data} moved to position ${position}.`);
  return ExitCode.Success;
}

export function registerSpecsCommands(
  program: Command,
  context: {
    getServices: () => Promise<CliServices>;
    setCode: (code: number) => void;
    stdout: (msg: string) => void;
    stderr: (msg: string) => void;
  },
): void {
  const { getServices, setCode, stdout, stderr } = context;

  const specsCmd = program
    .command('specs')
    .description('List and manage the spec queue')
    .option('--repo <path>', 'Path to repository root')
    .action(async (opts: { repo?: string }) => {
      try {
        const services = await getServices();
        const globalOptions = program.opts<{ json?: boolean }>();
        const code = await specsListCommand(
          services,
          { repo: opts.repo, json: globalOptions.json },
          stdout,
        );
        setCode(code);
      } catch (err) {
        stderr(err instanceof Error ? err.message : String(err));
        setCode(ExitCode.EngineUnavailable);
      }
    });

  specsCmd
    .command('init')
    .description('Add front matter to stories that lack it (§2), then list what it added')
    .option('--repo <path>', 'Path to repository root')
    .action(async (opts: { repo?: string }) => {
      try {
        const services = await getServices();
        const globalOptions = program.opts<{ json?: boolean }>();
        const code = await specsInitCommand(
          services,
          { repo: opts.repo, json: globalOptions.json },
          stdout,
        );
        setCode(code);
      } catch (err) {
        stderr(err instanceof Error ? err.message : String(err));
        setCode(ExitCode.EngineUnavailable);
      }
    });

  specsCmd
    .command('check')
    .description('Load and print problems (§11); exit code 1 if any')
    .option('--repo <path>', 'Path to repository root')
    .action(async (opts: { repo?: string }) => {
      try {
        const services = await getServices();
        const globalOptions = program.opts<{ json?: boolean }>();
        const code = await specsCheckCommand(
          services,
          { repo: opts.repo, json: globalOptions.json },
          stdout,
        );
        setCode(code);
      } catch (err) {
        stderr(err instanceof Error ? err.message : String(err));
        setCode(ExitCode.EngineUnavailable);
      }
    });

  specsCmd
    .command('start')
    .description('Start queue execution')
    .option('--repo <path>', 'Path to repository root')
    .action(async (opts: { repo?: string }) => {
      try {
        const services = await getServices();
        const globalOptions = program.opts<{ json?: boolean }>();
        const code = await specsStartCommand(
          services,
          { repo: opts.repo, json: globalOptions.json },
          stdout,
        );
        setCode(code);
      } catch (err) {
        stderr(err instanceof Error ? err.message : String(err));
        setCode(ExitCode.EngineUnavailable);
      }
    });

  specsCmd
    .command('pause')
    .description('Pause queue execution')
    .option('--repo <path>', 'Path to repository root')
    .action(async (opts: { repo?: string }) => {
      try {
        const services = await getServices();
        const globalOptions = program.opts<{ json?: boolean }>();
        const code = await specsPauseCommand(
          services,
          { repo: opts.repo, json: globalOptions.json },
          stdout,
        );
        setCode(code);
      } catch (err) {
        stderr(err instanceof Error ? err.message : String(err));
        setCode(ExitCode.EngineUnavailable);
      }
    });

  specsCmd
    .command('resume')
    .description('Resume queue execution')
    .option('--repo <path>', 'Path to repository root')
    .action(async (opts: { repo?: string }) => {
      try {
        const services = await getServices();
        const globalOptions = program.opts<{ json?: boolean }>();
        const code = await specsResumeCommand(
          services,
          { repo: opts.repo, json: globalOptions.json },
          stdout,
        );
        setCode(code);
      } catch (err) {
        stderr(err instanceof Error ? err.message : String(err));
        setCode(ExitCode.EngineUnavailable);
      }
    });

  specsCmd
    .command('cancel')
    .description('Cancel queue execution')
    .option('--repo <path>', 'Path to repository root')
    .action(async (opts: { repo?: string }) => {
      try {
        const services = await getServices();
        const globalOptions = program.opts<{ json?: boolean }>();
        const code = await specsCancelCommand(
          services,
          { repo: opts.repo, json: globalOptions.json },
          stdout,
        );
        setCode(code);
      } catch (err) {
        stderr(err instanceof Error ? err.message : String(err));
        setCode(ExitCode.EngineUnavailable);
      }
    });

  specsCmd
    .command('skip <id>')
    .description('Skip a spec in the queue')
    .option('--repo <path>', 'Path to repository root')
    .action(async (id: string, opts: { repo?: string }) => {
      try {
        const services = await getServices();
        const globalOptions = program.opts<{ json?: boolean }>();
        const code = await specsSkipCommand(
          services,
          id,
          { repo: opts.repo, json: globalOptions.json },
          stdout,
        );
        setCode(code);
      } catch (err) {
        stderr(err instanceof Error ? err.message : String(err));
        setCode(ExitCode.EngineUnavailable);
      }
    });

  specsCmd
    .command('retry <id>')
    .description('Retry a stopped or skipped spec')
    .option('--repo <path>', 'Path to repository root')
    .action(async (id: string, opts: { repo?: string }) => {
      try {
        const services = await getServices();
        const globalOptions = program.opts<{ json?: boolean }>();
        const code = await specsRetryCommand(
          services,
          id,
          { repo: opts.repo, json: globalOptions.json },
          stdout,
        );
        setCode(code);
      } catch (err) {
        stderr(err instanceof Error ? err.message : String(err));
        setCode(ExitCode.EngineUnavailable);
      }
    });

  specsCmd
    .command('move <id> <position>')
    .description('Reorder a spec in the queue (§10)')
    .option('--repo <path>', 'Path to repository root')
    .action(async (id: string, position: string, opts: { repo?: string }) => {
      try {
        const services = await getServices();
        const globalOptions = program.opts<{ json?: boolean }>();
        const code = await specsMoveCommand(
          services,
          id,
          position,
          { repo: opts.repo, json: globalOptions.json },
          stdout,
        );
        setCode(code);
      } catch (err) {
        stderr(err instanceof Error ? err.message : String(err));
        setCode(ExitCode.EngineUnavailable);
      }
    });
}
