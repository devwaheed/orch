import { Command, CommanderError } from 'commander';
import { ExitCode } from '../common/exitCodes.js';
import { accountsAddCommand, accountsListCommand } from './commands/accounts.js';
import { attachCommand } from './commands/attach.js';
import { doctorCommand } from './commands/doctor.js';
import { limitsCommand } from './commands/limits.js';
import { moveCommand } from './commands/move.js';
import { psCommand } from './commands/ps.js';
import { askInTerminal, resumeCommand } from './commands/resume.js';
import { runCommand, type RunCommandOptions } from './commands/run.js';
import { sessionsCommand } from './commands/sessions.js';
import { registerSpecsCommands } from './specs/index.js';
import { connectCliServices, type CliServices } from './client.js';
import { uninstallCommand } from './uninstall/uninstall.js';
import { bugReportCommand } from './commands/bugreport.js';
import { existsSync, statSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { platform } from 'node:os';

export interface CliOptions {
  services?: CliServices;
  stdout?: (msg: string) => void;
  stderr?: (msg: string) => void;
  /** S5-05: test seam pointing `orch uninstall` at a temp home. */
  home?: string;
  /** Installed app launchers inject the headless host; standalone CLI builds omit it. */
  serve?: () => Promise<number>;
  openApp?: (repoRoot?: string) => void;
  appVersion?: string;
  engineVersion?: string;
  stdoutIsTTY?: boolean;
  env?: NodeJS.ProcessEnv;
  platform?: NodeJS.Platform;
}

export function createProgram(options: CliOptions = {}): {
  program: Command;
  getExitCode: () => number;
} {
  const stdout = options.stdout ?? ((msg: string) => console.log(msg));
  const stderr = options.stderr ?? ((msg: string) => console.error(msg));
  let exitCode: number = ExitCode.Success;

  const setCode = (code: number): void => {
    exitCode = code;
  };

  const getServices = async (): Promise<CliServices> => {
    if (options.services) {
      return options.services;
    }
    return connectCliServices(options.home !== undefined ? { home: options.home } : undefined);
  };

  const program = new Command();
  program
    .name('orch')
    .description('orch: desktop app and CLI for multi-agent workflows')
    .version(`orch ${options.appVersion ?? '1.0.0'} · engine ${options.engineVersion ?? 'unknown'}`)
    .option('--json', 'Output contract objects as JSON')
    .exitOverride()
    .configureOutput({
      writeOut: (str) => stdout(str.trimEnd()),
      writeErr: (str) => stderr(str.trimEnd()),
    });

  program
    .command('serve')
    .description('Start the headless orch service')
    // Agent binary flags (--claude-bin <path>, …) are read from argv by the host and passed to the engine.
    .allowUnknownOption()
    .allowExcessArguments()
    .action(async () => {
      if (!options.serve) {
        stderr('Headless serving is unavailable in this orch installation.');
        setCode(ExitCode.InvalidUsage);
        return;
      }
      try {
        setCode(await options.serve());
      } catch (err) {
        stderr(err instanceof Error ? err.message : String(err));
        setCode(ExitCode.ProblemFound);
      }
    });

  // Accounts commands
  const accountsCmd = program
    .command('accounts')
    .description('List configured agent accounts')
    .action(async () => {
      try {
        const services = await getServices();
        const globalOptions = program.opts<{ json?: boolean }>();
        const code = await accountsListCommand(services, { json: globalOptions.json }, stdout);
        setCode(code);
      } catch (err) {
        stderr(err instanceof Error ? err.message : String(err));
        setCode(ExitCode.EngineUnavailable);
      }
    });

  accountsCmd
    .command('add <agent> <name>')
    .description('Add an agent account and verify sign-in')
    .action(async (agent: string, name: string) => {
      try {
        const services = await getServices();
        const globalOptions = program.opts<{ json?: boolean }>();
        const code = await accountsAddCommand(
          services,
          agent,
          name,
          { json: globalOptions.json },
          stdout,
        );
        setCode(code);
      } catch (err) {
        stderr(err instanceof Error ? err.message : String(err));
        setCode(ExitCode.EngineUnavailable);
      }
    });

  // Doctor command
  program
    .command('doctor')
    .description('Check system, agents, engine and profiles')
    .option('--sign-in-twice', 'Also run the isolation checks, which sign in twice per agent')
    .action(async (opts: { signInTwice?: boolean }) => {
      try {
        const services = await getServices();
        const globalOptions = program.opts<{ json?: boolean }>();
        const code = await doctorCommand(
          services,
          { json: globalOptions.json, signInTwice: opts.signInTwice },
          stdout,
        );
        setCode(code);
      } catch (err) {
        stderr(err instanceof Error ? err.message : String(err));
        setCode(ExitCode.EngineUnavailable);
      }
    });

  // Run command
  program
    .command('run <goal>')
    .description('Start a single-mode job with goal and verification checks')
    .option(
      '--check <cmd>',
      'Check command run by orch to verify the goal',
      (val: string, memo: string[]) => [...memo, val],
      [],
    )
    .option('--orchestrator <choice>', 'Orchestrator agent choice (e.g. claude, claude@work)', 'claude')
    .option('--on-limit <policy>', 'Policy when an account reaches limit (switch-account, switch-agent, ask)', 'switch-account')
    .option('--workers <agents>', 'Worker agents allowed for this job')
    .action(async (goal: string, opts: { check: string[]; orchestrator: string; onLimit: string; workers?: string }) => {
      try {
        const services = await getServices();
        const globalOptions = program.opts<{ json?: boolean }>();
        const runOptions: RunCommandOptions = {
          check: opts.check,
          orchestrator: opts.orchestrator,
          onLimit: opts.onLimit,
          workers: opts.workers,
          json: globalOptions.json,
        };
        const code = await runCommand(services, goal, runOptions, stdout);
        setCode(code);
      } catch (err) {
        stderr(err instanceof Error ? err.message : String(err));
        setCode(ExitCode.EngineUnavailable);
      }
    });

  // Ps command
  program
    .command('ps')
    .description('List active agent runs and tasks')
    .action(async () => {
      try {
        const services = await getServices();
        const globalOptions = program.opts<{ json?: boolean }>();
        const code = await psCommand(services, { json: globalOptions.json }, stdout);
        setCode(code);
      } catch (err) {
        stderr(err instanceof Error ? err.message : String(err));
        setCode(ExitCode.EngineUnavailable);
      }
    });

  // Attach command (CLI-01, CLI-03)
  program
    .command('attach <run>')
    .description('Stream a live run; Ctrl-] to detach, it keeps running')
    .action(async (run: string) => {
      try {
        const services = await getServices();
        const globalOptions = program.opts<{ json?: boolean }>();
        const code = await attachCommand(
          services,
          run,
          { json: globalOptions.json },
          stdout,
        );
        setCode(code);
      } catch (err) {
        stderr(err instanceof Error ? err.message : String(err));
        setCode(ExitCode.EngineUnavailable);
      }
    });

  // Limits command
  program
    .command('limits')
    .description('Show capacity and quota windows for accounts')
    .action(async () => {
      try {
        const services = await getServices();
        const globalOptions = program.opts<{ json?: boolean }>();
        const code = await limitsCommand(services, { json: globalOptions.json }, stdout);
        setCode(code);
      } catch (err) {
        stderr(err instanceof Error ? err.message : String(err));
        setCode(ExitCode.EngineUnavailable);
      }
    });

  // Sessions command
  program
    .command('sessions')
    .description('List conversation sessions')
    .option('--resumable', 'Filter to resumable sessions only')
    .action(async (opts: { resumable?: boolean }) => {
      try {
        const services = await getServices();
        const globalOptions = program.opts<{ json?: boolean }>();
        const code = await sessionsCommand(
          services,
          { resumable: opts.resumable, json: globalOptions.json },
          stdout,
        );
        setCode(code);
      } catch (err) {
        stderr(err instanceof Error ? err.message : String(err));
        setCode(ExitCode.EngineUnavailable);
      }
    });

  // Resume command (CLI-01, SES-01..SES-03)
  program
    .command('resume <session>')
    .description('Resume a session: continue it, hand it off to another account or agent, or fork it')
    .option('--to <agent@account>', 'Hand off to this account (same agent) or agent (another agent)')
    .option('--fork', 'Fork the session into a new branch and worktree')
    .action(async (session: string, opts: { to?: string; fork?: boolean }) => {
      try {
        const services = await getServices();
        const globalOptions = program.opts<{ json?: boolean }>();
        const code = await resumeCommand(
          services,
          session,
          { to: opts.to, fork: opts.fork, json: globalOptions.json },
          stdout,
          process.stdin.isTTY ? askInTerminal : undefined,
        );
        setCode(code);
      } catch (err) {
        stderr(err instanceof Error ? err.message : String(err));
        setCode(ExitCode.EngineUnavailable);
      }
    });

  // Move command (CLI-01, CLI-03)
  program
    .command('move <run>')
    .description('Move a run to another account now')
    .option('--to <agent@account>', 'Move to this account')
    .action(async (run: string, opts: { to?: string }) => {
      try {
        const services = await getServices();
        const globalOptions = program.opts<{ json?: boolean }>();
        const code = await moveCommand(
          services,
          run,
          { to: opts.to, json: globalOptions.json },
          stdout,
        );
        setCode(code);
      } catch (err) {
        stderr(err instanceof Error ? err.message : String(err));
        setCode(ExitCode.EngineUnavailable);
      }
    });

  // Uninstall command (S5-05, CLI-01, SEC-05)
  program
    .command('uninstall')
    .description('Remove orch and everything under ~/.orch')
    .option('--yes', 'Remove ~/.orch without asking for confirmation')
    .action(async (opts: { yes?: boolean }) => {
      try {
        const code = await uninstallCommand(
          {
            yes: opts.yes === true,
            ...(options.home !== undefined ? { home: options.home } : {}),
          },
          stdout,
        );
        setCode(code);
      } catch (err) {
        stderr(err instanceof Error ? err.message : String(err));
        setCode(ExitCode.ProblemFound);
      }
    });

  // Bug report command (BUG-01, CLI-01)
  program
    .command('bug-report')
    .description('Create an archive of logs, doctor report, masked accounts and specs')
    .option('--out <folder>', 'Folder where the bug report zip will be saved')
    .action(async (opts: { out?: string }) => {
      try {
        const code = await bugReportCommand(
          getServices,
          {
            out: opts.out,
            home: options.home,
            orchVersion: options.appVersion,
          },
          stdout,
          stderr,
        );
        setCode(code);
      } catch (err) {
        stderr(err instanceof Error ? err.message : String(err));
        setCode(ExitCode.ProblemFound);
      }
    });

  // Specs commands
  registerSpecsCommands(program, {
    getServices,
    setCode,
    stdout,
    stderr,
  });

  return {
    program,
    getExitCode: () => exitCode,
  };
}

export async function runCli(argv: string[], options: CliOptions = {}): Promise<number> {
  const stderr = options.stderr ?? ((msg: string) => console.error(msg));
  const { program, getExitCode } = createProgram(options);

  let formattedArgv = argv;
  if (formattedArgv.length < 2 || !formattedArgv[0]?.includes('node')) {
    formattedArgv = ['node', 'orch', ...argv];
  }

  try {
    const args = formattedArgv.slice(2);
    const isKnownCommand = args.length === 1 && program.commands.some((command) => command.name() === args[0]);
    if (args.length === 0 || (args.length === 1 && !args[0]?.startsWith('-') && !isKnownCommand)) {
      const candidate = args[0];
      if (candidate && !existsSync(candidate)) {
        // Unknown command words remain Commander errors; only existing paths are treated as repos.
      } else {
        return await runPlainCommand(candidate, options, program, stderr);
      }
    }
    await program.parseAsync(formattedArgv);
    return getExitCode();
  } catch (err) {
    if (err instanceof CommanderError) {
      if (err.code === 'commander.helpDisplayed' || err.code === 'commander.version') {
        return ExitCode.Success;
      }
      stderr(err.message);
      return ExitCode.InvalidUsage;
    }
    const message = err instanceof Error ? err.message : String(err);
    stderr(message);
    if (message.includes('engine') || message.includes('token') || message.includes('socket')) {
      return ExitCode.EngineUnavailable;
    }
    return ExitCode.ProblemFound;
  }
}

export function findGitRoot(path: string): string | null {
  let current = resolve(path);
  try {
    if (!statSync(current).isDirectory()) current = dirname(current);
  } catch {
    return null;
  }
  while (true) {
    try {
      statSync(resolve(current, '.git'));
      return current;
    } catch {
      const parent = dirname(current);
      if (parent === current) return null;
      current = parent;
    }
  }
}

async function runPlainCommand(
  typedPath: string | undefined,
  options: CliOptions,
  program: Command,
  stderr: (msg: string) => void,
): Promise<number> {
  const stdout = options.stdout ?? ((msg: string) => console.log(msg));
  const env = options.env ?? {};
  if (options.stdoutIsTTY !== true || env.CI !== undefined) {
    stdout(program.helpInformation().trimEnd());
    return ExitCode.Success;
  }
  if (!options.openApp) {
    stdout(program.helpInformation().trimEnd());
    return ExitCode.Success;
  }
  const currentPlatform = options.platform ?? platform();
  const noDisplay = currentPlatform === 'linux'
    ? !env.DISPLAY && !env.WAYLAND_DISPLAY
    : (currentPlatform === 'darwin' || currentPlatform === 'win32') && Boolean(env.SSH_CONNECTION || env.SSH_TTY);
  if (noDisplay) {
    try {
      const services = options.services ?? await connectCliServices(options.home !== undefined ? { home: options.home } : undefined);
      const [doctor, accounts, jobs] = await Promise.all([services.doctor.run(), services.accounts.list(), services.jobs.list()]);
      const engineCheck = doctor.ok ? doctor.value.checks.find((check) => check.id === 'engine' || check.id === 'engine_ping') : undefined;
      const engine = engineCheck?.status === 'pass' ? 'ready' : 'unavailable';
      const usable = accounts.ok ? accounts.value.filter((account) => account.use && account.state !== 'limited' && account.state !== 'signed_out').length : 0;
      const total = accounts.ok ? accounts.value.length : 0;
      const running = jobs.ok ? jobs.value.filter((job) => job.status === 'running').length : 0;
      stdout(`Engine: ${engine}\nUsable accounts: ${usable}/${total}\nRunning jobs: ${running}\nRun orch --help for all commands.`);
      if (!options.services) services.dispose();
      return ExitCode.Success;
    } catch {
      stderr('No display found. Start orch without a window with: orch serve');
      return ExitCode.EngineUnavailable;
    }
  }
  const root = typedPath ? findGitRoot(typedPath) : undefined;
  if (typedPath && !root) {
    stderr(`${typedPath} isn't inside a git repository.`);
    return ExitCode.InvalidUsage;
  }
  options.openApp(root ?? undefined);
  return ExitCode.Success;
}
