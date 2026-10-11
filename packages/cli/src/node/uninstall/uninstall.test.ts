import * as fs from 'node:fs';
import * as net from 'node:net';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { ExitCode } from '../../common/exitCodes.js';
import {
  isCoreHostRunning,
  orchRoot,
  orchSocketPath,
  orchTokenPath,
  uninstallCommand,
} from './uninstall.js';

const tempDirs: string[] = [];

function tempHome(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'orch-uninstall-'));
  tempDirs.push(dir);
  return dir;
}

function makeOrchInstall(home: string): void {
  const root = orchRoot(home);
  fs.mkdirSync(path.join(root, 'logs'), { recursive: true });
  fs.writeFileSync(path.join(root, 'logs', 'app.log'), 'hello\n');
  fs.writeFileSync(path.join(root, 'orch.db'), 'sqlite');
  fs.writeFileSync(path.join(root, 'token'), 'tok');
  fs.mkdirSync(path.join(root, 'engine'), { recursive: true });
}

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

describe('orch uninstall (S5-05, SEC-05)', () => {
  it('removes only ~/.orch and leaves the repo, its worktrees and ~/.claude untouched', async () => {
    const home = tempHome();
    const root = orchRoot(home);
    makeOrchInstall(home);

    // A sibling repo with a worktree inside it, and an agents' folder.
    const repo = path.join(home, 'repos', 'my-repo');
    fs.mkdirSync(path.join(repo, '.orch', 'wt', 'r-01'), { recursive: true });
    fs.writeFileSync(path.join(repo, 'README.md'), 'my repo\n');
    fs.writeFileSync(path.join(repo, '.orch', 'wt', 'r-01', 'notes.txt'), 'worktree notes\n');

    const claudeDir = path.join(home, '.claude');
    fs.mkdirSync(claudeDir, { recursive: true });
    fs.writeFileSync(path.join(claudeDir, 'settings.json'), '{}');

    const output: string[] = [];
    const code = await uninstallCommand({ home, yes: true }, (msg) => output.push(msg));

    expect(code).toBe(ExitCode.Success);
    expect(fs.existsSync(root)).toBe(false);

    expect(fs.existsSync(path.join(repo, 'README.md'))).toBe(true);
    expect(fs.readFileSync(path.join(repo, 'README.md'), 'utf8')).toBe('my repo\n');
    expect(fs.existsSync(path.join(repo, '.orch', 'wt', 'r-01', 'notes.txt'))).toBe(true);
    expect(fs.readFileSync(path.join(repo, '.orch', 'wt', 'r-01', 'notes.txt'), 'utf8')).toBe(
      'worktree notes\n',
    );
    expect(fs.existsSync(path.join(claudeDir, 'settings.json'))).toBe(true);

    expect(output.join('\n')).toContain('orch uninstalled');
  });

  it('refuses a ~/.orch that is a symbolic link pointing elsewhere', async () => {
    const home = tempHome();
    const elsewhere = path.join(home, 'elsewhere');
    fs.mkdirSync(elsewhere, { recursive: true });
    fs.writeFileSync(path.join(elsewhere, 'keep.txt'), 'keep\n');

    const root = orchRoot(home);
    fs.symlinkSync(elsewhere, root, 'dir');

    const output: string[] = [];
    const code = await uninstallCommand({ home, yes: true }, (msg) => output.push(msg));

    expect(code).toBe(ExitCode.ProblemFound);
    expect(fs.existsSync(root)).toBe(true);
    expect(fs.lstatSync(root).isSymbolicLink()).toBe(true);
    // The symlink target must be left untouched.
    expect(fs.existsSync(path.join(elsewhere, 'keep.txt'))).toBe(true);
    expect(output.join('\n')).toContain('symbolic link');
  });

  it('reports success when there is no ~/.orch to remove', async () => {
    const home = tempHome();
    const output: string[] = [];
    const code = await uninstallCommand({ home, yes: true }, (msg) => output.push(msg));

    expect(code).toBe(ExitCode.Success);
    expect(output.join('\n')).toContain('No orch installation found');
  });

  it('cancels when the confirmation is declined and removes nothing', async () => {
    const home = tempHome();
    makeOrchInstall(home);

    const output: string[] = [];
    const code = await uninstallCommand(
      { home, confirm: async () => false },
      (msg) => output.push(msg),
    );

    expect(code).toBe(ExitCode.Success);
    expect(fs.existsSync(orchRoot(home))).toBe(true);
    expect(output.join('\n')).toContain('Uninstall cancelled');
  });

  it('proceeds and removes ~/.orch when the confirmation is accepted', async () => {
    const home = tempHome();
    makeOrchInstall(home);

    const output: string[] = [];
    const code = await uninstallCommand(
      { home, confirm: async () => true },
      (msg) => output.push(msg),
    );

    expect(code).toBe(ExitCode.Success);
    expect(fs.existsSync(orchRoot(home))).toBe(false);
  });

  it.skipIf(process.platform === 'win32')(
    'refuses to uninstall while the core host answers on the socket',
    async () => {
      const home = tempHome();
      makeOrchInstall(home);

      // A fake core host: a unix socket that answers the SEC-01 auth handshake.
      const socketPath = orchSocketPath(home);
      const token = '__uninstall_test_token__';
      fs.writeFileSync(orchTokenPath(home), token);

      const server = net.createServer((socket) => {
        let buffer = '';
        socket.on('data', (chunk: Buffer) => {
          buffer += chunk.toString('utf8');
          const nl = buffer.indexOf('\n');
          if (nl === -1) return;
          const msg = JSON.parse(buffer.slice(0, nl)) as { id: number; method: string; params: { token: string } };
          if (msg.method === 'auth' && msg.params.token === token) {
            socket.write(
              JSON.stringify({ jsonrpc: '2.0', id: msg.id, result: { ok: true } }) + '\n',
            );
          } else {
            socket.destroy();
          }
        });
      });

      await new Promise<void>((resolve) => server.listen(socketPath, () => resolve()));
      try {
        expect(await isCoreHostRunning(home)).toBe(true);

        const output: string[] = [];
        const code = await uninstallCommand({ home, yes: true }, (msg) => output.push(msg));

        expect(code).toBe(ExitCode.ProblemFound);
        expect(fs.existsSync(orchRoot(home))).toBe(true);
        expect(output.join('\n')).toContain('orch is running');
      } finally {
        await new Promise<void>((resolve) => server.close(() => resolve()));
      }
    },
  );

  it('continues when the socket file is stale and nothing answers', async () => {
    const home = tempHome();
    makeOrchInstall(home);
    fs.writeFileSync(orchTokenPath(home), 'tok');

    const code = await uninstallCommand({ home, yes: true }, () => undefined);

    expect(code).toBe(ExitCode.Success);
    expect(fs.existsSync(orchRoot(home))).toBe(false);
  });
});