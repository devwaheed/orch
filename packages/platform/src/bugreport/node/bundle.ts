import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { ok, err } from '@orchagents/base';
import type { DoctorReport, Result } from '@orchagents/contracts';
import { parseDocument, isMap, isScalar } from 'yaml';
import { maskEmail } from '../../adapters/common/maskEmail.js';
import { redactText } from '../common/redact.js';
import { createZip, type ZipEntry } from './zip.js';

export const PINNED_CLAW_VERSION = '7.5.6';

export interface BugReportOptions {
  /** The user's home. Defaults to os.homedir(). */
  readonly home?: string | undefined;
  /** Overrides ~/.orch/logs, for example a temp folder. */
  readonly logsDir?: string | undefined;
  /** Reads the doctor report through the doctor service or channel. */
  readonly runDoctor: () => Promise<Result<DoctorReport>>;
  /** Where the archive is written. Defaults to ~/.orch/bug-reports/. */
  readonly outputDir?: string | undefined;
  /** Optional repo path to include specs.yaml from <repoPath>/.orch/specs.yaml. */
  readonly repoPath?: string | undefined;
  /** Test seam: overrides the clock. */
  readonly now?: (() => Date) | undefined;
  /** The app's own version when the caller knows it (the bundled CLI does); otherwise the doctor's. */
  readonly orchVersion?: string | undefined;
}

export function bugReportDefaultDir(home: string): string {
  return path.join(home, '.orch', 'bug-reports');
}

export function bugReportLogsDir(home: string): string {
  return path.join(home, '.orch', 'logs');
}

export function bugReportTokenPath(home: string): string {
  return path.join(home, '.orch', 'token');
}

export function bugReportAccountsPath(home: string): string {
  return path.join(home, '.orch', 'accounts.yaml');
}

function pad2(n: number): string {
  return String(n).padStart(2, '0');
}

/** Formats local time as YYYYMMDD-HHMMSS (LOCKED BUG-02). */
export function formatBundleTimestamp(d: Date): string {
  const year = d.getFullYear();
  const month = pad2(d.getMonth() + 1);
  const day = pad2(d.getDate());
  const hours = pad2(d.getHours());
  const minutes = pad2(d.getMinutes());
  const seconds = pad2(d.getSeconds());
  return `${year}${month}${day}-${hours}${minutes}${seconds}`;
}

export function defaultBundleName(now: Date): string {
  return `orch-bug-report-${formatBundleTimestamp(now)}.zip`;
}

function readOrchToken(tokenPath: string): string | null {
  try {
    return fs.readFileSync(tokenPath, 'utf8').trim();
  } catch {
    return null;
  }
}

/**
 * Returns log files in ~/.orch/logs/ modified in the last 3 days (BUG-03).
 */
export function readRecentLogFiles(logsDir: string, now: Date): { name: string; fullPath: string; mtime: Date }[] {
  let names: string[] = [];
  try {
    names = fs.readdirSync(logsDir);
  } catch {
    return [];
  }
  const threeDaysAgoMs = now.getTime() - 3 * 24 * 60 * 60 * 1000;
  const result: { name: string; fullPath: string; mtime: Date }[] = [];

  for (const name of names) {
    const fullPath = path.join(logsDir, name);
    let stat: fs.Stats;
    try {
      stat = fs.statSync(fullPath);
    } catch {
      continue;
    }
    if (!stat.isFile()) {
      continue;
    }
    if (stat.mtimeMs >= threeDaysAgoMs) {
      result.push({ name, fullPath, mtime: stat.mtime });
    }
  }
  return result;
}

/**
 * Masks emails in accounts.yaml while preserving YAML structure and comments.
 */
export function maskAccountsYaml(yamlText: string): string {
  try {
    const doc = parseDocument(yamlText);
    const accountsNode = doc.get('accounts');
    if (isMap(accountsNode)) {
      for (const item of accountsNode.items) {
        if (isMap(item.value)) {
          const emailNode = item.value.items.find((i) => isScalar(i.key) && i.key.value === 'email');
          if (emailNode && isScalar(emailNode.value) && typeof emailNode.value.value === 'string') {
            emailNode.value.value = maskEmail(emailNode.value.value);
          }
        }
      }
    }
    return doc.toString();
  } catch {
    // If invalid YAML, fallback to plain text with redact
    return yamlText;
  }
}

/**
 * S5-05 / BUG-03: computes the list of entry names that would be included in the bundle.
 */
export function previewBugReportEntries(options: {
  home?: string | undefined;
  logsDir?: string | undefined;
  repoPath?: string | undefined;
  now?: (() => Date) | undefined;
}): string[] {
  const home = options.home ?? os.homedir();
  const logsDir = options.logsDir ?? bugReportLogsDir(home);
  const now = options.now ? options.now() : new Date();

  const entries: string[] = ['versions.json', 'doctor.json'];

  const logs = readRecentLogFiles(logsDir, now);
  for (const log of logs) {
    entries.push(`logs/${log.name}`);
  }

  const accountsPath = bugReportAccountsPath(home);
  if (fs.existsSync(accountsPath)) {
    entries.push('accounts.yaml');
  }

  if (options.repoPath) {
    const specsPath = path.join(options.repoPath, '.orch', 'specs.yaml');
    if (fs.existsSync(specsPath)) {
      entries.push('specs.yaml');
    }
  }

  return entries;
}

/**
 * Cleans up archives older than 30 days in bugReportsDir (LOCKED BUG-02).
 * Returns the names of removed files.
 */
export async function cleanOldBugReports(
  bugReportsDir: string,
  now: Date = new Date(),
): Promise<string[]> {
  let names: string[] = [];
  try {
    names = await fs.promises.readdir(bugReportsDir);
  } catch {
    return [];
  }

  const thirtyDaysAgoMs = now.getTime() - 30 * 24 * 60 * 60 * 1000;
  const removed: string[] = [];

  for (const name of names) {
    if (!name.startsWith('orch-bug-report-') || !name.endsWith('.zip')) {
      continue;
    }
    const fullPath = path.join(bugReportsDir, name);
    let stat: fs.Stats;
    try {
      stat = await fs.promises.stat(fullPath);
    } catch {
      continue;
    }
    if (stat.mtimeMs < thirtyDaysAgoMs) {
      try {
        await fs.promises.unlink(fullPath);
        removed.push(name);
      } catch {
        // Ignore deletion errors
      }
    }
  }

  return removed;
}

/**
 * Builds the bug-report bundle (LOCKED BUG-02, BUG-03).
 * Output: orch-bug-report-<YYYYMMDD-HHMMSS>.zip in ~/.orch/bug-reports/ (or outputDir).
 * Everything is re-redacted on write (redactText).
 */
export async function createBugReportBundle(
  options: BugReportOptions,
): Promise<Result<string>> {
  const home = options.home ?? os.homedir();
  const logsDir = options.logsDir ?? bugReportLogsDir(home);
  const outputDir = options.outputDir ?? bugReportDefaultDir(home);
  const now = options.now ? options.now() : new Date();

  // Doctor report
  let doctorContent: string;
  let doctorEngineVersion: string = '';
  let doctorOrchVersion: string = '';
  try {
    const doctorResult = await options.runDoctor();
    if (doctorResult.ok) {
      doctorEngineVersion = doctorResult.value.engineVersion;
      doctorOrchVersion = doctorResult.value.orchVersion;
      doctorContent = JSON.stringify(doctorResult.value, null, 2);
    } else {
      doctorContent = JSON.stringify({ error: doctorResult.error.message }, null, 2);
    }
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    doctorContent = JSON.stringify({ error: msg }, null, 2);
  }

  // Redaction helper
  const token = readOrchToken(bugReportTokenPath(home));
  const redact = (input: string): string =>
    redactText(input, { home, secrets: token ? [token] : [] });

  const entries: ZipEntry[] = [];

  // 1. versions.json ({orch, engine, node, os, arch})
  const engineVersion = doctorEngineVersion || PINNED_CLAW_VERSION;
  const versionsObj = {
    orch: options.orchVersion ?? (doctorOrchVersion || 'unknown'),
    engine: engineVersion,
    node: process.version,
    os: process.platform,
    arch: process.arch,
  };
  entries.push({
    name: 'versions.json',
    content: Buffer.from(redact(JSON.stringify(versionsObj, null, 2)), 'utf8'),
    mtime: now,
  });

  // 2. doctor.json
  entries.push({
    name: 'doctor.json',
    content: Buffer.from(redact(doctorContent), 'utf8'),
    mtime: now,
  });

  // 3. logs/ (files modified in last 3 days)
  const recentLogs = readRecentLogFiles(logsDir, now);
  for (const log of recentLogs) {
    try {
      const raw = fs.readFileSync(log.fullPath, 'utf8');
      entries.push({
        name: `logs/${log.name}`,
        content: Buffer.from(redact(raw), 'utf8'),
        mtime: log.mtime,
      });
    } catch {
      // Ignore unreadable log file
    }
  }

  // 4. accounts.yaml (emails masked, then redacted)
  const accountsPath = bugReportAccountsPath(home);
  if (fs.existsSync(accountsPath)) {
    try {
      const raw = fs.readFileSync(accountsPath, 'utf8');
      const masked = maskAccountsYaml(raw);
      entries.push({
        name: 'accounts.yaml',
        content: Buffer.from(redact(masked), 'utf8'),
        mtime: now,
      });
    } catch {
      // Ignore unreadable accounts.yaml
    }
  }

  // 5. specs.yaml (only if repoPath given and file exists)
  if (options.repoPath) {
    const specsPath = path.join(options.repoPath, '.orch', 'specs.yaml');
    if (fs.existsSync(specsPath)) {
      try {
        const raw = fs.readFileSync(specsPath, 'utf8');
        entries.push({
          name: 'specs.yaml',
          content: Buffer.from(redact(raw), 'utf8'),
          mtime: now,
        });
      } catch {
        // Ignore unreadable specs.yaml
      }
    }
  }

  // Write the zip archive
  const zipBuffer = createZip(entries);
  const outputPath = path.join(outputDir, defaultBundleName(now));

  try {
    fs.mkdirSync(outputDir, { recursive: true, mode: 0o700 });
    fs.writeFileSync(outputPath, zipBuffer, { mode: 0o600 });
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
