import { chmod, lstat, mkdtemp, mkdir, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { execFileSync } from 'node:child_process';
import { adminScript, createCliCommand, cliCommandOffered, CLI_WRAPPER_HEADER } from './cliCommand.js';

const roots: string[] = [];
async function temporaryRoot(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'orch-cli-command-'));
  roots.push(root);
  return root;
}
afterEach(async () => { await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true }))); });

describe('cli command install', () => {
  it('offers only packaged macOS and AppImage installs', () => {
    expect(cliCommandOffered({ platform: 'darwin', packaged: true })).toBe(true);
    expect(cliCommandOffered({ platform: 'linux', packaged: true, appImage: '/tmp/orch.AppImage' })).toBe(true);
    expect(cliCommandOffered({ platform: 'linux', packaged: true })).toBe(false);
    expect(cliCommandOffered({ platform: 'win32', packaged: true })).toBe(false);
    expect(cliCommandOffered({ platform: 'darwin', packaged: false })).toBe(false);
  });

  it('installs and removes an AppImage wrapper only when it has the orch header', async () => {
    const root = await temporaryRoot();
    const home = join(root, 'home');
    const command = createCliCommand({ platform: 'linux', packaged: true, appImage: '/opt/orch AppImage', resourcesPath: root, home, pathValue: '/usr/bin' });
    expect(await command.install()).toEqual({ status: 'installed', pathLine: 'export PATH="$HOME/.local/bin:$PATH"' });
    const wrapper = await readFile(join(home, '.local', 'bin', 'orch'), 'utf8');
    expect(wrapper).toBe(`${CLI_WRAPPER_HEADER}exec "/opt/orch AppImage" --cli "$@"\n`);
    expect((await command.uninstall()).status).toBe('removed');
    await mkdir(join(home, '.local', 'bin'), { recursive: true });
    await writeFile(join(home, '.local', 'bin', 'orch'), 'someone else\n');
    expect((await command.uninstall()).status).toBe('failure');
    expect((await command.install()).status).toBe('failure');
    expect(await readFile(join(home, '.local', 'bin', 'orch'), 'utf8')).toBe('someone else\n');
  });

  it.runIf(process.platform === 'darwin')('builds an admin script AppleScript can compile, with quotes and spaces in paths', async () => {
    const root = await temporaryRoot();
    const script = adminScript(`/bin/ln -s '/Applications/My "orch" app/bin/orch' '/usr/local/bin/orch'`);
    // Compile only (nothing runs, no password prompt).
    expect(() => execFileSync('/usr/bin/osacompile', ['-o', join(root, 'x.scpt'), '-e', script], { stdio: 'pipe' })).not.toThrow();
  });

  it('preserves regular files at the macOS command path', async () => {
    const root = await temporaryRoot();
    const bin = join(root, 'usr-local-bin');
    await mkdir(bin);
    const target = join(bin, 'orch');
    await writeFile(target, 'existing install');
    const admin = vi.fn(async () => undefined);
    const command = createCliCommand({ platform: 'darwin', packaged: true, resourcesPath: root, home: root, binDirectory: bin, runAdmin: admin });
    expect(await command.install()).toMatchObject({ status: 'failure' });
    expect(admin).not.toHaveBeenCalled();
    expect(await readFile(target, 'utf8')).toBe('existing install');
  });

  it('replaces symlinks on install and removes only the orch launcher symlink', async () => {
    const root = await temporaryRoot();
    const bin = join(root, 'bin');
    const resources = join(root, 'resources');
    await mkdir(bin);
    await mkdir(join(resources, 'bin'), { recursive: true });
    const launcher = join(resources, 'bin', 'orch');
    await writeFile(launcher, 'launcher');
    await symlink('/tmp/old-orch', join(bin, 'orch'));
    const command = createCliCommand({ platform: 'darwin', packaged: true, resourcesPath: resources, home: root, binDirectory: bin });
    expect((await command.install()).status).toBe('installed');
    expect((await command.uninstall()).status).toBe('removed');
    await symlink('/tmp/another-app', join(bin, 'orch'));
    expect((await command.uninstall()).status).toBe('failure');
    expect((await lstat(join(bin, 'orch'))).isSymbolicLink()).toBe(true);
  });

  it.skipIf(process.platform === 'win32')('uses the injected administrator runner after a permission failure', async () => {
    const root = await temporaryRoot();
    const bin = join(root, 'bin');
    await mkdir(bin);
    await chmod(bin, 0o555);
    const runAdmin = vi.fn<(script: string) => Promise<void>>().mockResolvedValue(undefined);
    const command = createCliCommand({ platform: 'darwin', packaged: true, resourcesPath: root, home: root, binDirectory: bin, runAdmin });
    try {
      expect((await command.install()).status).toBe('installed');
      expect(runAdmin).toHaveBeenCalledOnce();
      expect(runAdmin.mock.calls[0]?.[0]).toContain('with administrator privileges');
    } finally {
      await chmod(bin, 0o755);
    }
    await chmod(bin, 0o555);
    const cancelledCommand = createCliCommand({
      platform: 'darwin', packaged: true, resourcesPath: root, home: root, binDirectory: bin,
      runAdmin: async () => { const error = new Error('cancelled') as NodeJS.ErrnoException; error.code = 'USER_CANCELLED'; throw error; },
    });
    try {
      expect((await cancelledCommand.install()).status).toBe('cancelled');
    } finally {
      await chmod(bin, 0o755);
    }
  });
});
