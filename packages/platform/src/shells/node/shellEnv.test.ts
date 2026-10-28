import { describe, expect, it, vi } from 'vitest';
import {
  buildFallbackPath,
  isLaunchedFromTerminal,
  parseShellPath,
  resolveNvmDefaultBin,
  resolveShellEnvSync,
  type ShellEnvFs,
} from './shellEnv.js';

describe('shellEnv', () => {
  describe('isLaunchedFromTerminal', () => {
    it('returns true when TERM is set to a real terminal', () => {
      expect(isLaunchedFromTerminal({ TERM: 'xterm-256color' })).toBe(true);
      expect(isLaunchedFromTerminal({ TERM: 'screen' })).toBe(true);
    });

    it('returns false when TERM is absent or dumb', () => {
      expect(isLaunchedFromTerminal({})).toBe(false);
      expect(isLaunchedFromTerminal({ TERM: '' })).toBe(false);
      expect(isLaunchedFromTerminal({ TERM: 'dumb' })).toBe(false);
    });
  });

  describe('parseShellPath', () => {
    const start = '___START___';
    const end = '___END___';

    it('extracts PATH between markers even with surrounding output (ignoring rc-file noise)', () => {
      const output = [
        'Welcome to my customized zsh!',
        'neofetch banner here...',
        start,
        'USER=alice',
        'PATH=/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin',
        'HOME=/Users/alice',
        end,
        'Goodbye!',
      ].join('\n');

      expect(parseShellPath(output, start, end)).toBe('/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin');
    });

    it('returns null if start marker is missing', () => {
      const output = `PATH=/usr/bin\n${end}`;
      expect(parseShellPath(output, start, end)).toBeNull();
    });

    it('returns null if end marker is missing', () => {
      const output = `${start}\nPATH=/usr/bin`;
      expect(parseShellPath(output, start, end)).toBeNull();
    });

    it('returns null if PATH is not within markers', () => {
      const output = `${start}\nFOO=BAR\n${end}`;
      expect(parseShellPath(output, start, end)).toBeNull();
    });
  });

  describe('resolveNvmDefaultBin with fakes', () => {
    it('returns null when ~/.nvm/alias/default does not exist', () => {
      const fakeFs: ShellEnvFs = {
        existsSync: () => false,
        readFileSync: () => '',
        readdirSync: () => [],
      };
      expect(resolveNvmDefaultBin('/home/user', fakeFs)).toBeNull();
    });

    it('resolves direct version match from default alias', () => {
      const files: Record<string, string> = {
        '/home/user/.nvm/alias/default': 'v20.11.0\n',
      };
      const dirs: Record<string, string[]> = {
        '/home/user/.nvm/versions/node': ['v18.0.0', 'v20.11.0', 'v22.0.0'],
      };
      const existing = new Set([
        '/home/user/.nvm/alias/default',
        '/home/user/.nvm/versions/node',
        '/home/user/.nvm/versions/node/v20.11.0/bin',
      ]);

      const fakeFs: ShellEnvFs = {
        existsSync: (p) => existing.has(p),
        readFileSync: (p) => files[p] ?? '',
        readdirSync: (p) => dirs[p] ?? [],
      };

      expect(resolveNvmDefaultBin('/home/user', fakeFs)).toBe('/home/user/.nvm/versions/node/v20.11.0/bin');
    });

    it('resolves major version alias (e.g. "22" matching "v22.18.0")', () => {
      const files: Record<string, string> = {
        '/home/user/.nvm/alias/default': '22',
      };
      const dirs: Record<string, string[]> = {
        '/home/user/.nvm/versions/node': ['v20.0.0', 'v22.18.0', 'v24.0.0'],
      };
      const existing = new Set([
        '/home/user/.nvm/alias/default',
        '/home/user/.nvm/versions/node',
        '/home/user/.nvm/versions/node/v22.18.0/bin',
      ]);

      const fakeFs: ShellEnvFs = {
        existsSync: (p) => existing.has(p),
        readFileSync: (p) => files[p] ?? '',
        readdirSync: (p) => dirs[p] ?? [],
      };

      expect(resolveNvmDefaultBin('/home/user', fakeFs)).toBe('/home/user/.nvm/versions/node/v22.18.0/bin');
    });

    it('follows lts alias chain (default -> lts/* -> lts/iron -> versions/node/v20.11.0/bin)', () => {
      const files: Record<string, string> = {
        '/home/user/.nvm/alias/default': 'lts/*',
        '/home/user/.nvm/alias/lts/*': 'lts/iron',
        '/home/user/.nvm/alias/lts/iron': 'v20.11.0',
      };
      const dirs: Record<string, string[]> = {
        '/home/user/.nvm/versions/node': ['v20.11.0'],
      };
      const existing = new Set([
        '/home/user/.nvm/alias/default',
        '/home/user/.nvm/alias/lts/*',
        '/home/user/.nvm/alias/lts/iron',
        '/home/user/.nvm/versions/node',
        '/home/user/.nvm/versions/node/v20.11.0/bin',
      ]);

      const fakeFs: ShellEnvFs = {
        existsSync: (p) => existing.has(p),
        readFileSync: (p) => files[p] ?? '',
        readdirSync: (p) => dirs[p] ?? [],
      };

      expect(resolveNvmDefaultBin('/home/user', fakeFs)).toBe('/home/user/.nvm/versions/node/v20.11.0/bin');
    });
  });

  describe('buildFallbackPath with fakes', () => {
    it('returns current PATH unchanged on Windows', () => {
      expect(
        buildFallbackPath({
          currentPath: 'C:\\Windows\\system32',
          platform: 'win32',
        }),
      ).toBe('C:\\Windows\\system32');
    });

    it('adds common dirs and resolves nvm default node bin on macOS', () => {
      const fakeFs: ShellEnvFs = {
        existsSync: (p) =>
          p === '/Users/test/.nvm/alias/default' ||
          p === '/Users/test/.nvm/versions/node' ||
          p === '/Users/test/.nvm/versions/node/v22.18.0/bin',
        readFileSync: (p) => (p === '/Users/test/.nvm/alias/default' ? '22' : ''),
        readdirSync: (p) => (p === '/Users/test/.nvm/versions/node' ? ['v22.18.0'] : []),
      };

      const fallback = buildFallbackPath({
        currentPath: '/usr/bin:/bin:/usr/sbin:/sbin:/usr/local/bin',
        home: '/Users/test',
        platform: 'darwin',
        fs: fakeFs,
      });

      const parts = fallback.split(':');
      expect(parts).toContain('/usr/bin');
      expect(parts).toContain('/bin');
      expect(parts).toContain('/opt/homebrew/bin');
      expect(parts).toContain('/usr/local/bin');
      expect(parts).toContain('/Users/test/.local/bin');
      expect(parts).toContain('/Users/test/.opencode/bin');
      expect(parts).toContain('/Users/test/.bun/bin');
      expect(parts).toContain('/Users/test/.nvm/versions/node/v22.18.0/bin');

      // Check deduplication of /usr/local/bin
      expect(parts.filter((p) => p === '/usr/local/bin').length).toBe(1);
    });
  });

  describe('resolveShellEnvSync with fakes', () => {
    it('returns env.PATH immediately on win32', () => {
      const spawnSync = vi.fn();
      const path = resolveShellEnvSync({
        platform: 'win32',
        env: { PATH: 'C:\\Windows\\system32' },
        spawnSync,
      });
      expect(path).toBe('C:\\Windows\\system32');
      expect(spawnSync).not.toHaveBeenCalled();
    });

    it('returns env.PATH immediately when launched from a real terminal', () => {
      const spawnSync = vi.fn();
      const path = resolveShellEnvSync({
        platform: 'darwin',
        env: { PATH: '/usr/bin:/bin', TERM: 'xterm-256color' },
        spawnSync,
      });
      expect(path).toBe('/usr/bin:/bin');
      expect(spawnSync).not.toHaveBeenCalled();
    });

    it('spawns shell synchronously when not launched from terminal, parses PATH, and logs entry count', () => {
      const logs: string[] = [];
      const spawnSync = vi.fn().mockImplementation((_file, args: readonly string[]) => {
        const cmd = args[1] ?? '';
        const startMatch = cmd.match(/echo "(__ORCH_ENV_START_[^"]+)"/);
        const endMatch = cmd.match(/echo "(__ORCH_ENV_END_[^"]+)"/);
        const startMarker = startMatch ? startMatch[1] : '';
        const endMarker = endMatch ? endMatch[1] : '';

        return {
          stdout: `${startMarker}\nPATH=/opt/homebrew/bin:/usr/bin:/bin\n${endMarker}\n`,
        };
      });

      const path = resolveShellEnvSync({
        platform: 'darwin',
        env: { PATH: '/usr/bin:/bin' },
        spawnSync,
        logger: (msg) => logs.push(msg),
      });

      expect(spawnSync).toHaveBeenCalledWith(
        '/bin/zsh',
        ['-ilc', expect.stringContaining('__ORCH_ENV_START_')],
        expect.objectContaining({ timeout: 10_000, stdin: 'ignore' }),
      );
      expect(path).toBe('/opt/homebrew/bin:/usr/bin:/bin');
      expect(logs).toEqual(['resolved shell PATH (3 entries)']);
    });

    it('falls back to buildFallbackPath on shell failure and logs entry count', () => {
      const logs: string[] = [];
      const spawnSync = vi.fn().mockImplementation(() => {
        throw new Error('timed out after 10000ms');
      });
      const fakeFs: ShellEnvFs = {
        existsSync: () => false,
        readFileSync: () => '',
        readdirSync: () => [],
      };

      const path = resolveShellEnvSync({
        platform: 'darwin',
        env: { PATH: '/usr/bin:/bin' },
        home: '/Users/test',
        spawnSync,
        fs: fakeFs,
        logger: (msg) => logs.push(msg),
      });

      expect(path).toContain('/opt/homebrew/bin');
      expect(path).toContain('/Users/test/.opencode/bin');
      expect(logs.length).toBe(1);
      expect(logs[0]).toMatch(/^resolved shell PATH \(\d+ entries\)$/);
    });
  });
});
