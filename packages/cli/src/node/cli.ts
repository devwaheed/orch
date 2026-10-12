import { Command, CommanderError } from 'commander';
import { ExitCode } from '../common/exitCodes.js';
import { accountsAddCommand, accountsListCommand } from './commands/accounts.js';
import { doctorCommand } from './commands/doctor.js';
import { limitsCommand } from './commands/limits.js';
import { psCommand } from './commands/ps.js';
import { askInTerminal, resumeCommand } from './commands/resume.js';
import { runCommand, type RunCommandOptions } from './commands/run.js';
import { sessionsCommand } from './commands/sessions.js';
import { registerSpecsCommands } from './specs/index.js';
import { connectCliServices, type CliServices } from './client.js';
import { uninstallCommand } from './uninstall/uninstall.js';

export interface CliOptions {
  services?: CliServices;
  stdout?: (msg: string) => void;
  stderr?: (msg: string) => void;
  /** S5-05: test seam pointing `orch uninstall` at a temp home. */
  home?: string;
  /** Installed app launchers inject the headless host; standalone CLI builds omit it. */
  serve?: () => Promise<number>;
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
    .version('1.0.0')
    .option('--json', 'Output contract objects as JSON')
    .exitOverride()
    .configureOutput({
      writeOut: (str) => stdout(str.trimEnd()),
      writeErr: (str) => stderr(str.trimEnd()),
    });

  program
    .command('serve')
    .description('Start the headless orch service')
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
