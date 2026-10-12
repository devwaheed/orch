import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { ok, err } from '@orchagents/base';
import type { DoctorReport } from '@orchagents/contracts';
import { afterEach, describe, expect, it } from 'vitest';
import { createBugReportBundle } from './bugreport.js';
import { parseTar } from './tar.js';

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

describe('bug-report bundle (S5-05)', () => {
  it('redacts tokens, sk- keys, emails, env values and the token file contents, and hides the home path', async () => {
    const home = tempHome();
    const plantedToken = 'orch-token-leak-0123456789abcdef';
    const plantedSkKey = 'sk-proj-0123456789abcdef0123456789abcdef';
    const plantedEmail = 'alex@acme.dev';
    const plantedEnvValue = 'super-secret-env-value-01';
    const plantedGithub = 'ghp_ABCDEFHJ0123456789abcdefghijklmn';

    fs.mkdirSync(path.join(home, '.orch'), { recursive: true });
    fs.writeFileSync(path.join(home, '.orch', 'token'), plantedToken);

    writeLogs(home, [
      `home is ${home}`,
      `token value: ${plantedToken}`,
      `OPENAI_API_KEY=${plantedSkKey}`,
      `bare key: sk-abcdefgh1234567890`,
      `DEPLOY_PASSWORD=${plantedEnvValue}`,
      `auth: Bearer ${plantedGithub}`,
      `contact: ${plantedEmail}`,
    ]);

    const outputDir = fs.mkdtempSync(path.join(os.tmpdir(), 'orch-bugreport-out-'));
    tempDirs.push(outputDir);

    const result = await createBugReportBundle({
      home,
      runDoctor: fakeDoctorRun,
      outputDir,
      now: () => new Date('2026-10-11T12:00:00.000Z'),
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(fs.existsSync(result.value)).toBe(true);
    const archive = fs.readFileSync(result.value);
    const archiveText = archive.toString('utf8');

    // Secrets must never appear, in any of the bundle's raw bytes.
    expect(archiveText).not.toContain(plantedToken);
    expect(archiveText).not.toContain(plantedSkKey);
    expect(archiveText).not.toContain(plantedEnvValue);
    expect(archiveText).not.toContain(plantedGithub);
    expect(archiveText).not.toContain(plantedEmail);
    // The absolute home path becomes `~`.
    expect(archiveText).not.toContain(home);
    expect(archiveText).not.toContain(path.join(home, '.orch', 'logs'));

    const members = parseTar(archive);
    const names = members.map((m) => m.name);
    expect(names).toContain('logs/app.log');
    expect(names).toContain('manifest.json');
    expect(names).toContain('doctor-report.json');

    const logText = members.find((m) => m.name === 'logs/app.log')?.content.toString('utf8') ?? '';
    expect(logText).not.toContain(home);
    expect(logText).toContain('home is ~');
    expect(logText).toContain('token value: [REDACTED]');
    expect(logText).toContain('OPENAI_API_KEY=[REDACTED]');
    expect(logText).toContain('DEPLOY_PASSWORD=[REDACTED]');
    expect(logText).toContain('Bearer [REDACTED]');
    expect(logText).toContain('sk-[REDACTED]');
    expect(logText).toContain('a•••@acme.dev');
  });

  it('bundles the doctor report and a manifest timestamped with the injected clock', async () => {
    const home = tempHome();
    writeLogs(home, ['a log line']);

    const outputDir = fs.mkdtempSync(path.join(os.tmpdir(), 'orch-bugreport-out-'));
    tempDirs.push(outputDir);

    const result = await createBugReportBundle({
      home,
      runDoctor: fakeDoctorRun,
      outputDir,
      now: () => new Date('2026-10-11T12:00:00.000Z'),
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(path.basename(result.value)).toBe('orch-bugreport-2026-10-11T12-00-00-000Z.tar');

    const members = parseTar(fs.readFileSync(result.value));
    const doctorMember = members.find((m) => m.name === 'doctor-report.json');
    expect(doctorMember).toBeDefined();
    const doctorText = doctorMember?.content.toString('utf8') ?? '';
    expect(doctorText).toContain('"orchVersion": "1.0.0"');
    expect(doctorText).toContain('"engineVersion": "7.5.6"');

    const manifest = JSON.parse(members.find((m) => m.name === 'manifest.json')?.content.toString('utf8') ?? '{}') as {
      createdAt: string;
      files: { name: string; bytes: number }[];
    };
    expect(manifest.createdAt).toBe('2026-10-11T12:00:00.000Z');
    expect(manifest.files.some((f) => f.name === 'logs/app.log')).toBe(true);
  });

  it('returns an error when the doctor call fails, and does not write an archive', async () => {
    const home = tempHome();
    writeLogs(home, ['x']);

    const outputDir = fs.mkdtempSync(path.join(os.tmpdir(), 'orch-bugreport-out-'));
    tempDirs.push(outputDir);

    const result = await createBugReportBundle({
      home,
      runDoctor: async () =>
        err({ code: 'engine_unavailable', message: 'engine is down', fix: 'Start orch.' }),
      outputDir,
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.message).toContain('doctor');
    expect(fs.readdirSync(outputDir)).toEqual([]);
  });

  it('still produces a bundle with the doctor report when there are no logs yet', async () => {
    const home = tempHome();
    const outputDir = fs.mkdtempSync(path.join(os.tmpdir(), 'orch-bugreport-out-'));
    tempDirs.push(outputDir);

    const result = await createBugReportBundle({
      home,
      runDoctor: fakeDoctorRun,
      outputDir,
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const members = parseTar(fs.readFileSync(result.value));
    const names = members.map((m) => m.name);
    expect(names).toContain('manifest.json');
    expect(names).toContain('doctor-report.json');
    expect(names).not.toContain('logs/app.log');
  });
});