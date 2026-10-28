/**
 * Command handlers and registration for orch specs (docs/specs/spec-queue.md §13).
 */
import { type ISpecsService, SpecId, SpecDraft, type SpecQueue } from '@orchagents/contracts';
import type { Command } from 'commander';
import { ExitCode } from '../../common/exitCodes.js';
import type { CliServices } from '../client.js';
import { formatBmadInitReport, formatProblems, formatSpecsTable } from './format.js';

export async function specsAddCommand(services: CliServices, repoPath: string, draft: unknown, json: boolean, output: (msg: string) => void): Promise<number> {
  const parsed = SpecDraft.safeParse(draft);
  if (!parsed.success) { output(parsed.error.message); return ExitCode.InvalidUsage; }
  const result = await getSpecsService(services).create(repoPath, parsed.data);
  if (!result.ok) { output(`Error: ${result.error.message}${result.error.fix ? `\nFix: ${result.error.fix}` : ''}`); return ExitCode.ProblemFound; }
  output(json ? JSON.stringify(result.value, null, 2) : `Added spec ${result.value.id} · ${result.value.spec.title} → ${result.value.file}`);
  return ExitCode.Success;
}

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
          { repo: resolveRepo(specsCmd, opts), json: globalOptions.json },
          stdout,
        );
        setCode(code);
      } catch (err) {
        stderr(err instanceof Error ? err.message : String(err));
        setCode(ExitCode.EngineUnavailable);
      }
    });

  specsCmd
    .command('add <title>')
    .description('Add a spec to the queue')
    .option('--body <text>')
    .option('--mode <mode>')
    .option('--agent <agent>', 'Agent (repeatable)', (value: string, previous: string[] = []) => [...previous, value], [])
    .option('--after <id>', 'Spec this one starts after (repeatable)', (value: string, previous: string[] = []) => [...previous, value], [])
    .option('--check <cmd>', 'Command check (repeatable)', (value: string, previous: string[] = []) => [...previous, value], [])
    .option('--web-check <url>', 'HTTP check (repeatable)', (value: string, previous: string[] = []) => [...previous, value], [])
    .option('--allow <glob>', 'Allowed file glob (repeatable)', (value: string, previous: string[] = []) => [...previous, value], [])
    .option('--audit <text>', 'Audit criterion (repeatable)', (value: string, previous: string[] = []) => [...previous, value], [])
    .option('--next')
    .option('--repo <path>')
    .action(async (title: string, opts: { body?: string; mode?: string; agent: string[]; after: string[]; check: string[]; webCheck: string[]; allow: string[]; audit: string[]; next?: boolean; repo?: string }) => {
      try {
        for (const id of opts.after) {
          const parsed = SpecId.safeParse(id);
          if (!parsed.success) { stdout(`Invalid spec id '${id}'. Spec id must be 1 to 4 digits.`); setCode(ExitCode.InvalidUsage); return; }
        }
        for (const address of opts.webCheck) {
          let valid = false;
          try { const parsed = new URL(address); valid = parsed.protocol === 'http:' || parsed.protocol === 'https:'; } catch { valid = false; }
          if (!valid) { stdout('--web-check needs an http(s) address, e.g. http://localhost:3000.'); setCode(ExitCode.InvalidUsage); return; }
        }
        const done_when = [
          ...opts.check.map((run) => ({ by: 'check' as const, text: run, check: { kind: 'command' as const, run } })),
          ...opts.webCheck.map((url) => ({ by: 'check' as const, text: url, check: { kind: 'http' as const, url, expectStatus: 200 } })),
          ...opts.audit.map((text) => ({ by: 'audit' as const, text })),
        ];
        const draft = { title, body: opts.body ?? '', mode: opts.mode ?? 'single', agents: opts.agent, depends_on: opts.after, scope: opts.allow, done_when, runNext: !!opts.next };
        const services = await getServices();
        const code = await specsAddCommand(services, resolveRepo(specsCmd, opts) ?? process.cwd(), draft, !!program.opts<{json?: boolean}>().json, stdout);
        setCode(code);
      } catch (err) { stderr(err instanceof Error ? err.message : String(err)); setCode(ExitCode.EngineUnavailable); }
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
          { repo: resolveRepo(specsCmd, opts), json: globalOptions.json },
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
          { repo: resolveRepo(specsCmd, opts), json: globalOptions.json },
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
          { repo: resolveRepo(specsCmd, opts), json: globalOptions.json },
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
          { repo: resolveRepo(specsCmd, opts), json: globalOptions.json },
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
          { repo: resolveRepo(specsCmd, opts), json: globalOptions.json },
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
          { repo: resolveRepo(specsCmd, opts), json: globalOptions.json },
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
          { repo: resolveRepo(specsCmd, opts), json: globalOptions.json },
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
          { repo: resolveRepo(specsCmd, opts), json: globalOptions.json },
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
          { repo: resolveRepo(specsCmd, opts), json: globalOptions.json },
          stdout,
        );
        setCode(code);
      } catch (err) {
        stderr(err instanceof Error ? err.message : String(err));
        setCode(ExitCode.EngineUnavailable);
      }
    });
}

/**
 * Commander parses the parent `specs` command's `--repo` greedily across the whole
 * argument list (the same way the root `--json` is parsed), so a flag given either
 * before or after the subcommand always lands on the parent. The subcommand's own
 * `--repo` value is therefore never set. Prefer the subcommand copy when present, then
 * fall back to the parent's so both orders work. (F-01)
 */
function resolveRepo(
  specsCmd: Command,
  opts: { repo?: string | undefined },
): string | undefined {
  return opts.repo ?? specsCmd.opts<{ repo?: string }>().repo;
}
