import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { ok, err } from '@orchagents/base';
import type { DoctorReport } from '@orchagents/contracts';
import { afterEach, describe, expect, it } from 'vitest';
import {
  cleanOldBugReports,
  createBugReportBundle,
  defaultBundleName,
  previewBugReportEntries,
} from './bundle.js';
import { BugReportService } from './bugReportService.js';
import { createZip, parseZip } from './zip.js';

const tempDirs: string[] = [];

function tempHome(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'orch-bugreport-'));
  tempDirs.push(dir);
  return dir;
}

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

const fakeDoctorReport: DoctorReport = {
  os: 'macos',
  orchVersion: '1.0.0',
  engineVersion: '7.5.6',
  checks: [
    { id: 'engine_ping', title: 'engine ping', status: 'pass' },
    { id: 'disk_space', title: 'disk space', status: 'warn', fix: 'Free up some disk space.' },
  ],
};

const fakeDoctorRun = async () => ok(fakeDoctorReport);

function writeLogs(home: string, lines: string[]): string {
  const logsDir = path.join(home, '.orch', 'logs');
  fs.mkdirSync(logsDir, { recursive: true });
  fs.writeFileSync(path.join(logsDir, 'app.log'), lines.join('\n'));
  return logsDir;
}

describe('zip writer and reader (BUG-02)', () => {
  it('round-trips entries accurately with node:zlib deflate and inflate', () => {
    const entries = [
      { name: 'hello.txt', content: Buffer.from('Hello world!', 'utf8') },
      { name: 'deep/nested/report.json', content: Buffer.from(JSON.stringify({ passed: true }), 'utf8') },
    ];
    const zipBuf = createZip(entries);
    expect(zipBuf.length).toBeGreaterThan(0);

    const parsed = parseZip(zipBuf);
    expect(parsed).toHaveLength(2);
    expect(parsed[0]?.name).toBe('hello.txt');
    expect(parsed[0]?.content.toString('utf8')).toBe('Hello world!');
    expect(parsed[1]?.name).toBe('deep/nested/report.json');
    expect(parsed[1]?.content.toString('utf8')).toBe('{"passed":true}');
  });
});

describe('bug-report bundle (BUG-02, BUG-03)', () => {
  it('passes the planted-secret test: token, API key, email and env value are redacted from all files', async () => {
    const home = tempHome();
    const plantedToken = 'orch-token-secret-0123456789abcdef';
    const plantedApiKey = 'sk-proj-secretkey0123456789abcdef01234';
    const plantedEmail = 'secret.developer@example.org';
    const plantedEnvVal = 'super-secret-password-xyz';
    const plantedBearer = 'ghp_SECRETTOKEN0123456789abcdefghij';

    fs.mkdirSync(path.join(home, '.orch'), { recursive: true });
    fs.writeFileSync(path.join(home, '.orch', 'token'), plantedToken);

    // Plant in logs
    writeLogs(home, [
      `home is ${home}`,
      `token: ${plantedToken}`,
      `OPENAI_API_KEY=${plantedApiKey}`,
      `API_PASS=${plantedEnvVal}`,
      `auth: Bearer ${plantedBearer}`,
      `contact: ${plantedEmail}`,
    ]);

    // Plant in accounts.yaml
    const accountsYaml = `
accounts:
  claude-work:
    agent: claude
    name: Work
    email: ${plantedEmail}
    token: ${plantedToken}
`;
    fs.writeFileSync(path.join(home, '.orch', 'accounts.yaml'), accountsYaml);

    // Plant in repo's .orch/specs.yaml
    const repoDir = fs.mkdtempSync(path.join(os.tmpdir(), 'orch-repo-'));
    tempDirs.push(repoDir);
    fs.mkdirSync(path.join(repoDir, '.orch'), { recursive: true });
    const specsYaml = `
source: docs/specs
SECRET_PASS=${plantedEnvVal}
planted_key: ${plantedApiKey}
`;
    fs.writeFileSync(path.join(repoDir, '.orch', 'specs.yaml'), specsYaml);

    const outDir = fs.mkdtempSync(path.join(os.tmpdir(), 'orch-bugreport-out-'));
    tempDirs.push(outDir);

    const fixedDate = new Date(2026, 9, 12, 14, 30, 45); // 2026-10-12 14:30:45 local

    const result = await createBugReportBundle({
      home,
      outputDir: outDir,
      repoPath: repoDir,
      runDoctor: fakeDoctorRun,
      now: () => fixedDate,
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(path.basename(result.value)).toBe('orch-bug-report-20261012-143045.zip');

    const zipBuffer = fs.readFileSync(result.value);
    const parsed = parseZip(zipBuffer);

    // Inflate and check every single entry: none of the planted secrets must appear
    const entryNames = parsed.map((e) => e.name);
    expect(entryNames).toContain('versions.json');
    expect(entryNames).toContain('doctor.json');
    expect(entryNames).toContain('logs/app.log');
    expect(entryNames).toContain('accounts.yaml');
    expect(entryNames).toContain('specs.yaml');

    for (const entry of parsed) {
      const content = entry.content.toString('utf8');
      expect(content, `Entry ${entry.name} contained plantedToken`).not.toContain(plantedToken);
      expect(content, `Entry ${entry.name} contained plantedApiKey`).not.toContain(plantedApiKey);
      expect(content, `Entry ${entry.name} contained plantedEmail`).not.toContain(plantedEmail);
      expect(content, `Entry ${entry.name} contained plantedEnvVal`).not.toContain(plantedEnvVal);
      expect(content, `Entry ${entry.name} contained plantedBearer`).not.toContain(plantedBearer);
      expect(content, `Entry ${entry.name} contained raw home path`).not.toContain(home);
    }

    // Verify accounts.yaml email masking (ACC-04: s•••@example.org)
    const accountsEntry = parsed.find((e) => e.name === 'accounts.yaml')?.content.toString('utf8') ?? '';
    expect(accountsEntry).toContain('s•••@example.org');

    // Verify versions.json structure (BUG-03: {orch, engine, node, os, arch})
    const versionsEntry = parsed.find((e) => e.name === 'versions.json')?.content.toString('utf8') ?? '';
    const versions = JSON.parse(versionsEntry) as Record<string, string>;
    expect(versions).toEqual({
      orch: '0.0.0',
      engine: '7.5.6',
      node: process.version,
      os: process.platform,
      arch: process.arch,
    });

    // Verify doctor.json content
    const doctorEntry = parsed.find((e) => e.name === 'doctor.json')?.content.toString('utf8') ?? '';
    expect(doctorEntry).toContain('"engineVersion": "7.5.6"');
  });

  it('records {"error": "<message>"} in doctor.json when doctor fails', async () => {
    const home = tempHome();
    const outDir = fs.mkdtempSync(path.join(os.tmpdir(), 'orch-bugreport-out-'));
    tempDirs.push(outDir);

    const result = await createBugReportBundle({
      home,
      outputDir: outDir,
      runDoctor: async () => err({ code: 'engine_unavailable', message: 'engine is stopped', fix: 'Start orch.' }),
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const zipBuffer = fs.readFileSync(result.value);
    const parsed = parseZip(zipBuffer);
    const doctorEntry = parsed.find((e) => e.name === 'doctor.json')?.content.toString('utf8') ?? '';
    expect(JSON.parse(doctorEntry)).toEqual({ error: 'engine is stopped' });
  });

  it('only includes log files modified in the last 3 days', async () => {
    const home = tempHome();
    const logsDir = path.join(home, '.orch', 'logs');
    fs.mkdirSync(logsDir, { recursive: true });

    const now = new Date(2026, 9, 12, 12, 0, 0);
    const recentTime = new Date(now.getTime() - 1 * 24 * 60 * 60 * 1000); // 1 day old
    const oldTime = new Date(now.getTime() - 5 * 24 * 60 * 60 * 1000); // 5 days old

    const recentFile = path.join(logsDir, 'recent.log');
    const oldFile = path.join(logsDir, 'old.log');
    fs.writeFileSync(recentFile, 'recent log line\n');
    fs.writeFileSync(oldFile, 'old log line\n');
    fs.utimesSync(recentFile, recentTime, recentTime);
    fs.utimesSync(oldFile, oldTime, oldTime);

    const outDir = fs.mkdtempSync(path.join(os.tmpdir(), 'orch-bugreport-out-'));
    tempDirs.push(outDir);

    const result = await createBugReportBundle({
      home,
      outputDir: outDir,
      runDoctor: fakeDoctorRun,
      now: () => now,
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const parsed = parseZip(fs.readFileSync(result.value));
    const names = parsed.map((e) => e.name);
    expect(names).toContain('logs/recent.log');
    expect(names).not.toContain('logs/old.log');
  });

  it('creates ~/.orch/bug-reports owner-only by default', async () => {
    const home = tempHome();
    const result = await createBugReportBundle({
      home,
      runDoctor: fakeDoctorRun,
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const defaultDir = path.join(home, '.orch', 'bug-reports');
    expect(fs.existsSync(defaultDir)).toBe(true);
    expect(fs.existsSync(result.value)).toBe(true);

    if (process.platform !== 'win32') {
      const stat = fs.statSync(defaultDir);
      expect(stat.mode & 0o777).toBe(0o700);
      const fileStat = fs.statSync(result.value);
      expect(fileStat.mode & 0o777).toBe(0o600);
    }
  });
});

describe('cleanup of old bug reports (BUG-02)', () => {
  it('deletes bug-report zips older than 30 days and preserves newer ones', async () => {
    const home = tempHome();
    const dir = path.join(home, '.orch', 'bug-reports');
    fs.mkdirSync(dir, { recursive: true });

    const now = new Date(2026, 9, 12, 12, 0, 0);
    const thirtyOneDaysAgo = new Date(now.getTime() - 31 * 24 * 60 * 60 * 1000);
    const tenDaysAgo = new Date(now.getTime() - 10 * 24 * 60 * 60 * 1000);

    const oldZip = path.join(dir, 'orch-bug-report-20260911-120000.zip');
    const recentZip = path.join(dir, 'orch-bug-report-20261002-120000.zip');
    const otherFile = path.join(dir, 'keep-me.txt');

    fs.writeFileSync(oldZip, 'fake zip content');
    fs.writeFileSync(recentZip, 'fake zip content');
    fs.writeFileSync(otherFile, 'text');

    fs.utimesSync(oldZip, thirtyOneDaysAgo, thirtyOneDaysAgo);
    fs.utimesSync(recentZip, tenDaysAgo, tenDaysAgo);
    fs.utimesSync(otherFile, thirtyOneDaysAgo, thirtyOneDaysAgo);

    const deleted = await cleanOldBugReports(dir, now);
    expect(deleted).toEqual(['orch-bug-report-20260911-120000.zip']);

    expect(fs.existsSync(oldZip)).toBe(false);
    expect(fs.existsSync(recentZip)).toBe(true);
    expect(fs.existsSync(otherFile)).toBe(true); // Only orch-bug-report-*.zip is targeted
  });
});

describe('IBugReportService', () => {
  it('files() previews the entry names and save() writes the bundle', async () => {
    const home = tempHome();
    writeLogs(home, ['log line 1']);

    expect(defaultBundleName(new Date(2026, 9, 12, 14, 30, 45))).toBe('orch-bug-report-20261012-143045.zip');

    const preview = previewBugReportEntries({ home });
    expect(preview).toContain('versions.json');
    expect(preview).toContain('doctor.json');
    expect(preview).toContain('logs/app.log');

    const service = new BugReportService({
      home,
      runDoctor: fakeDoctorRun,
    });

    const filesRes = await service.files();
    expect(filesRes.ok).toBe(true);
    if (!filesRes.ok) return;

    expect(filesRes.value).toContain('versions.json');
    expect(filesRes.value).toContain('doctor.json');
    expect(filesRes.value).toContain('logs/app.log');

    const saveRes = await service.save({});
    expect(saveRes.ok).toBe(true);
    if (!saveRes.ok) return;

    expect(fs.existsSync(saveRes.value.path)).toBe(true);
    expect(saveRes.value.path).toContain(path.join(home, '.orch', 'bug-reports'));
  });
});
