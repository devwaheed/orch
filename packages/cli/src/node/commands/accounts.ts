import {
  AgentId,
  type IEventsService,
  type OrchError,
  type OrchEvent,
  type SignInResult,
} from '@orchagents/contracts';
import { ExitCode } from '../../common/exitCodes.js';
import { formatAgentAccount, formatStatus, formatTable } from '../../common/format.js';
import type { CliServices } from '../client.js';

export async function accountsListCommand(
  services: CliServices,
  options: { json?: boolean | undefined },
  output: (msg: string) => void,
): Promise<number> {
  const result = await services.accounts.list();
  if (!result.ok) {
    output(
      `Error: ${result.error.message}${result.error.fix ? `\nFix: ${result.error.fix}` : ''}`,
    );
    return ExitCode.ProblemFound;
  }

  if (options.json) {
    output(JSON.stringify(result.value, null, 2));
    return ExitCode.Success;
  }

  if (result.value.length === 0) {
    output('No accounts found.');
    return ExitCode.Success;
  }

  const headers = ['ACCOUNT', 'EMAIL', 'STATUS', 'PRIMARY', 'USE'];
  const rows = result.value.map((account) => {
    const accountStr = formatAgentAccount(
      account.agent,
      account.name.toLowerCase().replace(/[^a-z0-9]+/g, '-'),
    );
    return [
      accountStr,
      account.emailMasked ?? '—',
      formatStatus(account.state),
      account.primary ? 'yes' : 'no',
      account.use ? 'yes' : 'no',
    ];
  });

  output(formatTable(headers, rows));
  return ExitCode.Success;
}

export interface AccountsAddOptions {
  json?: boolean | undefined;
  type?: string | undefined;
}

export interface AccountsAddIo {
  stdin?: NodeJS.ReadableStream | undefined;
  stdout?: { write: (data: string) => boolean | void } | undefined;
  stdinIsTTY?: boolean | undefined;
  stdoutIsTTY?: boolean | undefined;
  rawModeSetter?: ((enabled: boolean) => void) | undefined;
  stderr?: ((msg: string) => void) | undefined;
  columns?: number | undefined;
  rows?: number | undefined;
}

async function getAgentDisplayName(services: CliServices, agentId: AgentId): Promise<string> {
  const fallbackNames: Record<AgentId, string> = {
    claude: 'Claude Code',
    codex: 'Codex',
    gemini: 'Gemini CLI',
    opencode: 'OpenCode',
    agy: 'Antigravity',
  };

  try {
    const res = await services.accounts.listAgents();
    if (res.ok) {
      const match = res.value.find((a) => a.id === agentId);
      if (match?.displayName) {
        return match.displayName;
      }
    }
  } catch {
    // ignore
  }

  return fallbackNames[agentId] ?? agentId;
}

export async function accountsAddCommand(
  services: CliServices,
  agentStr: string,
  name: string,
  options: AccountsAddOptions,
  output: (msg: string) => void,
  io: AccountsAddIo = {},
): Promise<number> {
  const agentParsed = AgentId.safeParse(agentStr);
  if (!agentParsed.success) {
    output(
      `Invalid agent '${agentStr}'. Supported agents: claude, codex, gemini, opencode, agy.`,
    );
    return ExitCode.InvalidUsage;
  }

  const trimmedName = name.trim();
  if (trimmedName.length === 0 || trimmedName.length > 40) {
    output(`Invalid account name '${name}'. Name must be 1 to 40 characters.`);
    return ExitCode.InvalidUsage;
  }

  const trimmedType = options.type?.trim();
  if (trimmedType !== undefined && trimmedType.length > 40) {
    output(`Invalid account type '${options.type}'. Type must be at most 40 characters.`);
    return ExitCode.InvalidUsage;
  }

  const agentDisplayName = await getAgentDisplayName(services, agentParsed.data);

  const stdin = io.stdin ?? process.stdin;
  const stdout = io.stdout ?? process.stdout;
  const isStdinTTY = io.stdinIsTTY ?? Boolean((stdin as unknown as { isTTY?: boolean }).isTTY);
  const isStdoutTTY = io.stdoutIsTTY ?? Boolean((stdout as unknown as { isTTY?: boolean }).isTTY);

  if (!isStdinTTY || !isStdoutTTY) {
    const msg = `orch accounts add needs a terminal to run ${agentDisplayName}’s own sign-in. Run it in a terminal, or add the account in the app: Accounts → Add account.`;
    if (options.json) {
      (io.stderr ?? console.error)(msg);
    } else {
      output(msg);
    }
    return ExitCode.InvalidUsage;
  }

  const addResult = await services.accounts.add({
    agent: agentParsed.data,
    name: trimmedName,
    ...(trimmedType && trimmedType.length > 0 ? { type: trimmedType } : {}),
  });

  if (!addResult.ok) {
    output(
      `Error: ${addResult.error.message}${addResult.error.fix ? `\nFix: ${addResult.error.fix}` : ''}`,
    );
    return ExitCode.ProblemFound;
  }

  const account = addResult.value;

  const signingLine = `Signing in to ${agentDisplayName} · ${trimmedName}. ${agentDisplayName}’s own sign-in runs below; your password never passes through orch. Press Ctrl-] when you’ve signed in and it doesn’t close by itself.`;
  if (options.json) {
    (io.stderr ?? console.error)(signingLine);
  } else {
    output(signingLine);
  }

  const cols = io.columns ?? process.stdout.columns ?? 80;
  const rows = io.rows ?? process.stdout.rows ?? 24;
  const safeCols = Math.max(1, cols || 80);
  const safeRows = Math.max(1, rows || 24);

  const openResult = await services.accounts.openSignIn(account.id, safeCols, safeRows);
  if (!openResult.ok) {
    await services.accounts.remove(account.id);
    output(
      `Error: ${openResult.error.message}${openResult.error.fix ? `\nFix: ${openResult.error.fix}` : ''}`,
    );
    return ExitCode.ProblemFound;
  }

  const shellId = openResult.value;
  const shells =
    services.shells ??
    (services.client ? services.client.getService<CliServices['shells']>('shells') : undefined);

  const eventsService: IEventsService =
    (services as unknown as { events?: IEventsService }).events ??
    services.client?.events ??
    services.client?.getService<IEventsService>('events') ?? {
      subscribe: () => () => undefined,
    };

  let unsubscribeEvents: (() => void) | undefined;
  let cleanupStdin: (() => void) | undefined;
  let cleanupResize: (() => void) | undefined;

  let outcome: { result: SignInResult | null; error: OrchError | null } = {
    result: null,
    error: null,
  };

  const setRaw =
    io.rawModeSetter ??
    ((enabled: boolean) => {
      if (
        typeof (stdin as unknown as { setRawMode?: (mode: boolean) => void })
          .setRawMode === 'function'
      ) {
        (stdin as unknown as { setRawMode: (mode: boolean) => void }).setRawMode(
          enabled,
        );
      }
    });

  try {
    try {
      setRaw(true);
    } catch {
      // Ignore if unable to set raw mode
    }

    outcome = await new Promise<{ result: SignInResult | null; error: OrchError | null }>((resolve) => {
      let finished = false;

      const finish = async (userConfirmed: boolean) => {
        if (finished) return;
        finished = true;

        let result: SignInResult | null = null;
        let error: OrchError | null = null;

        try {
          if (userConfirmed && shells) {
            await shells.close(shellId);
          }
          const checkResult = await services.accounts.checkSignIn(
            account.id,
            userConfirmed,
          );
          if (checkResult.ok) {
            result = checkResult.value;
          } else {
            error = checkResult.error;
          }
        } catch (err) {
          error = {
            code: 'internal',
            message: err instanceof Error ? err.message : String(err),
          };
        } finally {
          resolve({ result, error });
        }
      };

      unsubscribeEvents = eventsService.subscribe((event: OrchEvent) => {
        if (event.type === 'shell.output' && event.shellId === shellId) {
          if (io.stdout && typeof io.stdout.write === 'function') {
            io.stdout.write(event.data);
          } else if (typeof process.stdout.write === 'function') {
            process.stdout.write(event.data);
          }
        } else if (event.type === 'shell.exited' && event.shellId === shellId) {
          void finish(false);
        }
      });

      const onResize = () => {
        const c = io.columns ?? process.stdout.columns ?? 80;
        const r = io.rows ?? process.stdout.rows ?? 24;
        if (shells) {
          void shells.resize(shellId, Math.max(1, c || 80), Math.max(1, r || 24));
        }
      };

      const resizeEmitter =
        io.stdout && 'on' in io.stdout && typeof (io.stdout as unknown as NodeJS.EventEmitter).on === 'function'
          ? (io.stdout as unknown as NodeJS.EventEmitter)
          : process.stdout;

      if (typeof resizeEmitter?.on === 'function') {
        resizeEmitter.on('resize', onResize);
        cleanupResize = () => {
          resizeEmitter.removeListener('resize', onResize);
        };
      }

      const onData = (chunk: Buffer | string) => {
        if (finished) return;
        const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
        if (buf.includes(0x1d)) {
          void finish(true);
          return;
        }
        const str = typeof chunk === 'string' ? chunk : chunk.toString('utf-8');
        if (shells) {
          void shells.write(shellId, str);
        }
      };

      if (typeof stdin.on === 'function') {
        stdin.on('data', onData);
        cleanupStdin = () => {
          stdin.removeListener('data', onData);
        };
      }

      if (typeof (stdin as unknown as { resume?: () => void }).resume === 'function') {
        (stdin as unknown as { resume: () => void }).resume();
      }
    });
  } finally {
    if (cleanupResize) {
      cleanupResize();
    }
    if (cleanupStdin) {
      cleanupStdin();
    }
    if (unsubscribeEvents) {
      unsubscribeEvents();
    }
    try {
      setRaw(false);
    } catch {
      // Ignore
    }
    if (typeof (stdin as unknown as { pause?: () => void }).pause === 'function') {
      (stdin as unknown as { pause: () => void }).pause();
    }
  }

  const { result: signInResultValue, error: signInError } = outcome;

  if (signInError) {
    output(
      `Error: ${signInError.message}${signInError.fix ? `\nFix: ${signInError.fix}` : ''}`,
    );
    return ExitCode.ProblemFound;
  }

  if (!signInResultValue) {
    return ExitCode.ProblemFound;
  }

  if (options.json) {
    output(JSON.stringify(signInResultValue, null, 2));
    const allPassed =
      signInResultValue.signedIn &&
      signInResultValue.keptSeparate &&
      signInResultValue.ready;
    return allPassed ? ExitCode.Success : ExitCode.ProblemFound;
  }

  const emailText =
    signInResultValue.identity === 'checked'
      ? (signInResultValue.emailMasked ?? account.emailMasked)
      : undefined;
  const signedInLine = emailText ? `Signed in as ${emailText}` : 'Signed in';

  const lines = [
    `${signInResultValue.signedIn ? '✓' : '✗'} ${signedInLine}`,
    `${signInResultValue.keptSeparate ? '✓' : '✗'} Kept separate: in its own private folder.`,
    `${signInResultValue.ready ? '✓' : '✗'} Ready: usage tracking is on and orch can route work to it.`,
  ];

  output(lines.join('\n'));

  const allPassed =
    signInResultValue.signedIn &&
    signInResultValue.keptSeparate &&
    signInResultValue.ready;
  return allPassed ? ExitCode.Success : ExitCode.ProblemFound;
}
