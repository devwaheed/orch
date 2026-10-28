/**
 * Resolves the user's login shell PATH on macOS and Linux (when not launched from a terminal)
 * using the VS Code resolveShellEnv / shell-env / fix-path approach.
 */
import { spawnSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import * as fs from 'node:fs';
import { homedir, userInfo } from 'node:os';
import { delimiter, join } from 'node:path';

export interface ShellEnvFs {
  existsSync(path: string): boolean;
  readFileSync(path: string, encoding: 'utf8'): string;
  readdirSync(path: string): string[];
}

export function isLaunchedFromTerminal(env: NodeJS.ProcessEnv): boolean {
  return Boolean(env.TERM && env.TERM !== 'dumb');
}

export function parseShellPath(stdout: string, startMarker: string, endMarker: string): string | null {
  const startIndex = stdout.indexOf(startMarker);
  if (startIndex === -1) return null;
  const afterStart = startIndex + startMarker.length;
  const endIndex = stdout.indexOf(endMarker, afterStart);
  if (endIndex === -1) return null;

  const block = stdout.slice(afterStart, endIndex);
  for (const line of block.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (trimmed.startsWith('PATH=')) {
      return trimmed.slice('PATH='.length);
    }
  }
  return null;
}

export function resolveNvmDefaultBin(home: string, fileSystem: ShellEnvFs = fs): string | null {
  const nvmDir = join(home, '.nvm');
  const defaultAliasFile = join(nvmDir, 'alias', 'default');
  if (!fileSystem.existsSync(defaultAliasFile)) return null;

  let target: string;
  try {
    target = fileSystem.readFileSync(defaultAliasFile, 'utf8').trim();
  } catch {
    return null;
  }
  if (!target) return null;

  // Follow alias chains (up to 5 steps, e.g. default -> lts/* -> lts/krypton -> v24.21.0)
  for (let depth = 0; depth < 5; depth++) {
    const candidateAlias = target.startsWith('lts/')
      ? join(nvmDir, 'alias', 'lts', target.slice(4))
      : join(nvmDir, 'alias', target);
    if (fileSystem.existsSync(candidateAlias)) {
      try {
        const next = fileSystem.readFileSync(candidateAlias, 'utf8').trim();
        if (next && next !== target) {
          target = next;
          continue;
        }
      } catch {
        break;
      }
    }
    break;
  }

  const versionsDir = join(nvmDir, 'versions', 'node');
  if (!fileSystem.existsSync(versionsDir)) return null;

  let installedVersions: string[];
  try {
    installedVersions = fileSystem.readdirSync(versionsDir);
  } catch {
    return null;
  }

  const normalizedTarget = target.startsWith('v') ? target : `v${target}`;
  const matches = installedVersions.filter((v) => {
    if (v === normalizedTarget) return true;
    if (v === target) return true;
    if (v.startsWith(`${normalizedTarget}.`)) return true;
    return false;
  });

  if (matches.length === 0) return null;

  matches.sort((a, b) => b.localeCompare(a, undefined, { numeric: true, sensitivity: 'base' }));
  const chosen = matches[0];
  if (!chosen) return null;

  const binDir = join(versionsDir, chosen, 'bin');
  if (fileSystem.existsSync(binDir)) {
    return binDir;
  }
  return null;
}

export function resolveHomeAndUser(env: NodeJS.ProcessEnv, explicitHome?: string): { home: string; user?: string } {
  let home = explicitHome;
  let user: string | undefined;
  try {
    const u = userInfo();
    if (!home) home = u.homedir;
    user = u.username;
  } catch {
    if (!home) home = env.HOME ?? homedir();
  }
  return { home: home ?? homedir(), ...(user ? { user } : {}) };
}

export function detectShell(platform: NodeJS.Platform, envShell?: string): string {
  if (envShell) return envShell;
  try {
    const userShell = userInfo().shell;
    if (typeof userShell === 'string' && userShell.length > 0) {
      return userShell;
    }
  } catch {
    // ignore
  }
  return platform === 'darwin' ? '/bin/zsh' : '/bin/sh';
}

export interface FallbackPathOptions {
  currentPath?: string | undefined;
  home?: string | undefined;
  platform?: NodeJS.Platform | undefined;
  fs?: ShellEnvFs | undefined;
}

export function buildFallbackPath(options: FallbackPathOptions = {}): string {
  const platform = options.platform ?? process.platform;
  const currentPath = options.currentPath ?? '';
  if (platform === 'win32') {
    return currentPath;
  }

  const { home } = resolveHomeAndUser({}, options.home);
  const fileSystem = options.fs ?? fs;

  const delim = delimiter || ':';
  const currentEntries = currentPath.split(delim).filter(Boolean);
  const commonDirs: string[] = [
    '/opt/homebrew/bin',
    '/usr/local/bin',
    join(home, '.local', 'bin'),
    join(home, '.opencode', 'bin'),
    join(home, '.bun', 'bin'),
  ];

  const nvmBin = resolveNvmDefaultBin(home, fileSystem);
  if (nvmBin) {
    commonDirs.push(nvmBin);
  }

  const seen = new Set<string>();
  const result: string[] = [];

  for (const dir of [...currentEntries, ...commonDirs]) {
    if (dir && !seen.has(dir)) {
      seen.add(dir);
      result.push(dir);
    }
  }

  return result.join(delim);
}

export interface ResolveShellEnvSyncOptions {
  platform?: NodeJS.Platform | undefined;
  env?: NodeJS.ProcessEnv | undefined;
  shell?: string | undefined;
  timeoutMs?: number | undefined;
  home?: string | undefined;
  fs?: ShellEnvFs | undefined;
  spawnSync?: ((file: string, args: readonly string[], options: { timeout?: number; stdin?: 'ignore' }) => { stdout: string }) | undefined;
  logger?: ((message: string) => void) | undefined;
}

export function resolveShellEnvSync(options: ResolveShellEnvSyncOptions = {}): string {
  const platform = options.platform ?? process.platform;
  const env = options.env ?? {};
  const logger = options.logger ?? console.log;

  if (platform === 'win32') {
    return env.PATH ?? '';
  }

  if (isLaunchedFromTerminal(env)) {
    return env.PATH ?? '';
  }

  const startMarker = `__ORCH_ENV_START_${randomBytes(8).toString('hex')}__`;
  const endMarker = `__ORCH_ENV_END_${randomBytes(8).toString('hex')}__`;
  const command = `echo "${startMarker}"; env; echo "${endMarker}"`;

  const shell = options.shell ?? detectShell(platform, env.SHELL);
  const { home: realHome, user: realUser } = resolveHomeAndUser(env, options.home);

  const spawnEnv: NodeJS.ProcessEnv = {
    ...env,
    HOME: realHome,
    ...(realUser ? { USER: realUser, LOGNAME: realUser } : {}),
    SHELL: shell,
  };

  const timeoutMs = options.timeoutMs ?? 10_000;
  const runner = options.spawnSync ?? ((file, args, opts) => {
    const res = spawnSync(file, args, {
      env: spawnEnv,
      timeout: opts.timeout,
      stdio: ['ignore', 'pipe', 'ignore'],
      encoding: 'utf8',
    });
    return { stdout: res.stdout ?? '' };
  });

  try {
    const result = runner(shell, ['-ilc', command], { timeout: timeoutMs, stdin: 'ignore' });
    const parsedPath = parseShellPath(result.stdout, startMarker, endMarker);
    if (parsedPath) {
      const entries = parsedPath.split(delimiter || ':').filter(Boolean);
      logger(`resolved shell PATH (${entries.length} entries)`);
      return parsedPath;
    }
  } catch {
    // shell failed, timed out, or exited with error
  }

  const fallback = buildFallbackPath({
    currentPath: env.PATH,
    home: realHome,
    platform,
    fs: options.fs,
  });
  const entries = fallback.split(delimiter || ':').filter(Boolean);
  logger(`resolved shell PATH (${entries.length} entries)`);
  return fallback;
}
