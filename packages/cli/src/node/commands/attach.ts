/**
 * `orch attach <run>` (CLI-01, CLI-02, CLI-03).
 *
 * "stream a live run; Ctrl-] to detach, it keeps running" (design/prototype/Terminal.dc.html,
 * the attach artboard: header line `# session s-7a1c · claude@personal · orch/r-02`,
 * then the run's lines, user input lines shown with `›`).
 */
import {
  RunId,
  type IEventsService,
  type OrchEvent,
  type Run,
  type RunLine,
} from '@orch/contracts';
import { ExitCode } from '../../common/exitCodes.js';
import { formatAgentAccount } from '../../common/format.js';
import type { CliServices } from '../client.js';

export interface AttachCommandOptions {
  json?: boolean | undefined;
}

function errorLines(error: { message: string; fix?: string | undefined }): string {
  return `Error: ${error.message}${error.fix ? `\nFix: ${error.fix}` : ''}`;
}

export function formatRunLineGlyph(kind: RunLine['kind']): string {
  switch (kind) {
    case 'prompt':
      return '›';
    case 'tool':
      return '⏺';
    case 'ok':
      return '✓';
    case 'err':
      return '✗';
    case 'limit':
      return '!';
    case 'spawn':
      return '↳';
    case 'meta':
      return '#';
    case 'message':
    case 'diff_add':
    case 'diff_del':
    default:
      return '';
  }
}

export function formatRunLineText(line: RunLine): string {
  const glyph = formatRunLineGlyph(line.kind);
  if (!glyph) {
    return line.text;
  }
  return `${glyph} ${line.text}`;
}

export function formatAttachHeader(run: Run): string {
  const sessionStr = run.sessionId ? `session ${run.sessionId}` : 'no session';
  const agentAccountStr = formatAgentAccount(run.agent, run.accountId);
  const worktreeStr = run.worktree ?? (run.readOnly ? 'main (ro)' : '—');
  return `# ${sessionStr} · ${agentAccountStr} · ${worktreeStr}`;
}

export async function findRun(
  services: Pick<CliServices, 'jobs' | 'runs'>,
  runId: RunId,
): Promise<{ ok: true; run: Run } | { ok: false; error: { message: string; fix?: string | undefined } }> {
  const jobsRes = await services.jobs.list();
  if (!jobsRes.ok) {
    return { ok: false, error: jobsRes.error };
  }

  for (const job of jobsRes.value) {
    const runsRes = await services.runs.list(job.id);
    if (runsRes.ok) {
      const match = runsRes.value.find((r) => r.id === runId);
      if (match) {
        return { ok: true, run: match };
      }
    }
  }

  return {
    ok: false,
    error: {
      message: `Run ${runId} was not found.`,
      fix: 'Check the run id in orch ps, then try again.',
    },
  };
}

export interface AttachIo {
  stdin?: NodeJS.ReadableStream | undefined;
  rawModeSetter?: ((enabled: boolean) => void) | undefined;
  onReady?: (() => void) | undefined;
}

export async function attachCommand(
  services: Pick<CliServices, 'jobs' | 'runs'> & { client?: Pick<CliServices['client'], 'events' | 'getService'> | undefined; events?: IEventsService | undefined },
  runArg: string,
  options: AttachCommandOptions,
  output: (msg: string) => void,
  io: AttachIo = {},
): Promise<number> {
  const parsedRunId = RunId.safeParse(runArg);
  if (!parsedRunId.success) {
    output(
      errorLines({
        message: `${runArg} is not a run id.`,
        fix: 'Use an id from orch ps, such as r-02.',
      }),
    );
    return ExitCode.InvalidUsage;
  }
  const runId = parsedRunId.data;

  const found = await findRun(services, runId);
  if (!found.ok) {
    output(errorLines(found.error));
    return ExitCode.InvalidUsage;
  }
  const run = found.run;

  if (!options.json) {
    output(formatAttachHeader(run));
  }

  const seenSeqs = new Set<number>();

  return new Promise<number>((resolve) => {
    let finished = false;
    let cleanupStdin: (() => void) | undefined;

    const printLine = (line: RunLine) => {
      if (seenSeqs.has(line.seq)) {
        return;
      }
      seenSeqs.add(line.seq);
      if (options.json) {
        output(JSON.stringify(line));
      } else {
        output(formatRunLineText(line));
      }
    };

    const eventsService: IEventsService =
      services.events ?? services.client?.events ?? services.client?.getService<IEventsService>('events') ?? {
        subscribe: () => () => undefined,
      };

    const unsubscribeEvents = eventsService.subscribe((event: OrchEvent) => {
      if (event.type === 'run.line' && event.line.runId === runId) {
        printLine(event.line);
      } else if (event.type === 'run.changed' && event.run.id === runId) {
        if (['done', 'failed', 'stopped'].includes(event.run.status)) {
          cleanupAndResolve(ExitCode.Success);
        }
      }
    });

    const cleanupAndResolve = (code: number) => {
      if (finished) return;
      finished = true;
      unsubscribeEvents();
      if (cleanupStdin) {
        cleanupStdin();
      }
      resolve(code);
    };

    // 1. Catch up missed lines
    void services.runs.lines(runId, -1).then((catchUpRes) => {
      if (catchUpRes.ok) {
        for (const line of catchUpRes.value) {
          printLine(line);
        }
      }
      if (io.onReady) {
        io.onReady();
      }
    });

    const stdin = io.stdin ?? process.stdin;
    if (stdin) {
      const isTTY = Boolean((stdin as unknown as { isTTY?: boolean }).isTTY);
      const setRaw = io.rawModeSetter ?? ((enabled: boolean) => {
        if (typeof (stdin as unknown as { setRawMode?: (mode: boolean) => void }).setRawMode === 'function') {
          (stdin as unknown as { setRawMode: (mode: boolean) => void }).setRawMode(enabled);
        }
      });

      if (isTTY) {
        try {
          setRaw(true);
        } catch {
          // Ignore if unable to set raw mode
        }
      }

      let lineBuffer = '';

      const onData = (chunk: Buffer | string) => {
        const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
        for (let i = 0; i < buffer.length; i++) {
          const byte = buffer[i]!;
          // Ctrl-] (byte 0x1d) -> detach immediately
          if (byte === 0x1d) {
            cleanupAndResolve(ExitCode.Success);
            return;
          }

          // In raw mode, enter can be \r (0x0d) or \n (0x0a)
          if (byte === 0x0a || byte === 0x0d) {
            const lineToSend = lineBuffer.trim();
            lineBuffer = '';
            // The run echoes what was sent as its own `prompt` line, so nothing is printed here.
            if (lineToSend.length > 0) void services.runs.send(runId, lineToSend);
          } else if (byte === 0x08 || byte === 0x7f) {
            // Backspace
            lineBuffer = lineBuffer.slice(0, -1);
          } else if (byte >= 0x20) {
            lineBuffer += String.fromCharCode(byte);
          }
        }
      };

      stdin.on('data', onData);

      cleanupStdin = () => {
        stdin.removeListener('data', onData);
        if (isTTY) {
          try {
            setRaw(false);
          } catch {
            // Ignore
          }
        }
      };
    }
  });
}
