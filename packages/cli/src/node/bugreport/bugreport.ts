import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { ok, err } from '@orch/base';
import type { DoctorReport, Result } from '@orch/contracts';
import { redactText } from './redact.js';
import { createTar, type TarEntry } from './tar.js';

export interface BugReportOptions {
  /** The user's home. Defaults to os.homedir(). */
  readonly home?: string;
  /** Overrides ~/.orch/logs, for example a temp folder. */
  readonly logsDir?: string;
  /** Reads the doctor report through the CLI channel client (IDoctorService.run). */
  readonly runDoctor: () => Promise<Result<DoctorReport>>;
  /** Where the archive is written. Defaults to the current working directory. */
  readonly outputDir?: string;
  /** Test seam: overrides the clock. */
  readonly now?: () => Date;
}

const LOGS_DIR_NAME = 'logs';

/** S5-05: where the logs live (LOCKED SEC-03: ~/.orch/logs/). */
export function bugReportLogsDir(home: string): string {
  return path.join(home, '.orch', LOGS_DIR_NAME);
}

/** S5-05: the token file, whose contents must never cross into a bundle (SEC-01). */
export function bugReportTokenPath(home: string): string {
  return path.join(home, '.orch', 'token');
}

function safeFileNameTimestamp(now: Date): string {
  return now.toISOString().replace(/[:.]/g, '-');
}

function defaultOutputName(now: Date): string {
  return `orch-bugreport-${safeFileNameTimestamp(now)}.tar`;
}

function readOrchToken(tokenPath: string): string | null {
  try {
    return fs.readFileSync(tokenPath, 'utf8').trim();
  } catch {
    return null;
  }
}

function readLogs(logsDir: string): TarEntry[] {
  const entries: TarEntry[] = [];
  let names: string[] = [];
  try {
    names = fs.readdirSync(logsDir);
  } catch {
    // No logs yet (SEC-03): a logs folder with nothing in it is still part of the bundle.
    return [];
  }
  entries.push({
    name: LOGS_DIR_NAME,
    content: Buffer.alloc(0),
    type: 'directory',
  });
  for (const name of names) {
    const filePath = path.join(logsDir, name);
    let stat: fs.Stats | null = null;
    try {
      stat = fs.statSync(filePath);
    } catch {
      continue;
    }
    if (!stat.isFile()) {
      continue;
    }
    let raw: Buffer;
    try {
      raw = fs.readFileSync(filePath);
    } catch {
      continue;
    }
    entries.push({
      name: `${LOGS_DIR_NAME}/${name}`,
      content: raw,
      ...(stat.mtimeMs > 0 ? { mtime: Math.floor(stat.mtimeMs / 1000) } : {}),
    });
  }
  return entries;
}

/**
 * S5-05: builds the bug-report bundle — the logs from ~/.orch/logs/, the
 * doctor report (read through the CLI channel client) and a manifest — into one
 * uncompressed tar. Everything is re-redacted on the way in (SEC-03): tokens,
 * API keys, emails, env values, the ~/.orch token contents and anything that
 * looks like a bearer or sk- key; the home path becomes `~`.
 *
 * Returns the absolute path of the written archive.
 */
export async function createBugReportBundle(
  options: BugReportOptions,
): Promise<Result<string>> {
  const home = options.home ?? os.homedir();
  const logsDir = options.logsDir ?? bugReportLogsDir(home);
  const outputDir = options.outputDir ?? process.cwd();
  const now = options.now ? options.now() : new Date();

  const doctorResult = await options.runDoctor();
  if (!doctorResult.ok) {
    return err({
      code: 'internal',
      message: `Could not run the doctor report for the bug-report bundle: ${doctorResult.error.message}`,
      fix: doctorResult.error.fix ?? 'Make sure orch is running, then try again.',
    });
  }
  const report = doctorResult.value;

  const token = readOrchToken(bugReportTokenPath(home));
  const redact = (input: string): string =>
    redactText(input, { home, secrets: token ? [token] : [] });

  const logEntries = readLogs(logsDir);
  const redactedLogEntries: TarEntry[] = logEntries.map((entry) =>
    entry.type === 'directory' ? entry : { ...entry, content: Buffer.from(redact(entry.content.toString('utf8'))) },
  );

  const doctorText = redact(JSON.stringify(report, null, 2));
  const manifest = redact(
    JSON.stringify(
      {
        createdAt: now.toISOString(),
        os: report.os,
        orchVersion: report.orchVersion,
        engineVersion: report.engineVersion,
        files: redactedLogEntries
          .filter((entry) => entry.type !== 'directory')
          .map((entry) => ({ name: entry.name, bytes: entry.content.length })),
      },
      null,
      2,
    ),
  );

  const entries: TarEntry[] = [
    ...redactedLogEntries,
    { name: 'manifest.json', content: Buffer.from(manifest) },
    { name: 'doctor-report.json', content: Buffer.from(doctorText) },
  ];

  const archive = createTar(entries);

  const outputPath = path.join(outputDir, defaultOutputName(now));

  try {
    fs.mkdirSync(outputDir, { recursive: true });
    fs.writeFileSync(outputPath, archive, { mode: 0o600 });
  } catch {
    return err({
      code: 'internal',
      message: `Could not write the bug-report bundle to ${outputPath}`,
      fix: 'Pick a folder you can write to, then try again.',
      details: { path: outputPath },
    });
  }

  return ok(outputPath);
}