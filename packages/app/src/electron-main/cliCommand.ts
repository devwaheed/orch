import { lstat, mkdir, readFile, realpath, rm, symlink, writeFile } from 'node:fs/promises';
import { delimiter, join, resolve } from 'node:path';

export const CLI_WRAPPER_HEADER = '#!/bin/sh\n# orch AppImage command wrapper\n';

export interface CliCommandOptions {
  platform: string;
  packaged: boolean;
  appImage?: string;
  resourcesPath: string;
  home: string;
  pathValue?: string;
  binDirectory?: string;
  runAdmin?: (command: string) => Promise<void>;
}

export interface CliCommandResult {
  status: 'installed' | 'removed' | 'cancelled' | 'failure';
  detail?: string;
  pathLine?: string;
}

function appleShellQuote(value: string): string {
  return `'${value.replaceAll("'", "'\\''")}'`;
}

function shellDoubleQuote(value: string): string {
  return `"${value.replace(/[\\"$`]/g, '\\$&')}"`;
}

export function cliCommandOffered(options: Pick<CliCommandOptions, 'platform' | 'packaged' | 'appImage'>): boolean {
  return options.packaged && (options.platform === 'darwin' || (options.platform === 'linux' && Boolean(options.appImage)));
}

export function createCliCommand(options: CliCommandOptions) {
  const launcher = resolve(options.resourcesPath, 'bin', 'orch');
  const macTarget = join(options.binDirectory ?? '/usr/local/bin', 'orch');
  const appImageTarget = join(options.home, '.local', 'bin', 'orch');
  const appImage = options.appImage ? resolve(options.appImage) : '';

  const runAdmin = async (command: string): Promise<'ok' | 'cancelled'> => {
    if (!options.runAdmin) return 'cancelled';
    const script = `do shell script ${appleShellQuote(command)} with administrator privileges`;
    try {
      await options.runAdmin(script);
      return 'ok';
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'USER_CANCELLED') return 'cancelled';
      throw error;
    }
  };

  async function installMac(): Promise<CliCommandResult> {
    try {
      try {
        const existing = await lstat(macTarget);
        if (!existing.isSymbolicLink()) return { status: 'failure', detail: `${macTarget} already exists and is not a symlink.` };
        await rm(macTarget);
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
      }
      await mkdir(options.binDirectory ?? '/usr/local/bin', { recursive: true });
      await symlink(launcher, macTarget);
      return { status: 'installed' };
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EACCES' && (error as NodeJS.ErrnoException).code !== 'EPERM') {
        return { status: 'failure', detail: error instanceof Error ? error.message : String(error) };
      }
      try {
        try {
          const existing = await lstat(macTarget);
          if (!existing.isSymbolicLink()) return { status: 'failure', detail: `${macTarget} already exists and is not a symlink.` };
        } catch (statError) {
          if ((statError as NodeJS.ErrnoException).code !== 'ENOENT') throw statError;
        }
        const quotedTarget = appleShellQuote(macTarget);
        const status = await runAdmin(`/bin/mkdir -p ${appleShellQuote(options.binDirectory ?? '/usr/local/bin')} && { /usr/bin/test -L ${quotedTarget} || /usr/bin/test ! -e ${quotedTarget}; } && /bin/rm -f ${quotedTarget} && /bin/ln -s ${appleShellQuote(launcher)} ${quotedTarget}`);
        return status === 'cancelled' ? { status: 'cancelled' } : { status: 'installed' };
      } catch (adminError) {
        return { status: 'failure', detail: adminError instanceof Error ? adminError.message : String(adminError) };
      }
    }
  }

  async function uninstallMac(): Promise<CliCommandResult> {
    let launcherTarget: string;
    try {
      const stat = await lstat(macTarget);
      if (!stat.isSymbolicLink()) return { status: 'failure', detail: `${macTarget} is not an orch launcher symlink.` };
      launcherTarget = await realpath(macTarget);
      if (launcherTarget !== await realpath(launcher)) return { status: 'failure', detail: `${macTarget} is not an orch launcher symlink.` };
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return { status: 'failure', detail: `${macTarget} was not found.` };
      return { status: 'failure', detail: error instanceof Error ? error.message : String(error) };
    }
    try {
      await rm(macTarget);
      return { status: 'removed' };
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'EACCES' || (error as NodeJS.ErrnoException).code === 'EPERM') {
        try {
          if (await realpath(macTarget) !== launcherTarget) return { status: 'failure', detail: `${macTarget} is not an orch launcher symlink.` };
          const status = await runAdmin(`/usr/bin/test -L ${appleShellQuote(macTarget)} && [ "$(/usr/bin/readlink ${appleShellQuote(macTarget)})" = ${appleShellQuote(launcher)} ] && /bin/rm ${appleShellQuote(macTarget)}`);
          return status === 'cancelled' ? { status: 'cancelled' } : { status: 'removed' };
        } catch (adminError) {
          return { status: 'failure', detail: adminError instanceof Error ? adminError.message : String(adminError) };
        }
      }
      return { status: 'failure', detail: error instanceof Error ? error.message : String(error) };
    }
  }

  async function installAppImage(): Promise<CliCommandResult> {
    if (!appImage) return { status: 'failure', detail: 'APPIMAGE is not set.' };
    try {
      await mkdir(join(options.home, '.local', 'bin'), { recursive: true, mode: 0o755 });
      const content = `${CLI_WRAPPER_HEADER}exec ${shellDoubleQuote(appImage)} --cli "$@"\n`;
      await writeFile(appImageTarget, content, { mode: 0o755 });
      const onPath = (options.pathValue ?? '').split(delimiter).some((entry) => resolve(entry || '.') === join(options.home, '.local', 'bin'));
      return { status: 'installed', ...(!onPath ? { pathLine: 'export PATH="$HOME/.local/bin:$PATH"' } : {}) };
    } catch (error) {
      return { status: 'failure', detail: error instanceof Error ? error.message : String(error) };
    }
  }

  async function uninstallAppImage(): Promise<CliCommandResult> {
    try {
      const content = await readFile(appImageTarget, 'utf8');
      if (!content.startsWith(CLI_WRAPPER_HEADER)) return { status: 'failure', detail: `${appImageTarget} is not an orch wrapper.` };
      await rm(appImageTarget);
      return { status: 'removed' };
    } catch (error) {
      return { status: 'failure', detail: error instanceof Error ? error.message : String(error) };
    }
  }

  return {
    offered: cliCommandOffered(options),
    install: () => options.platform === 'darwin' ? installMac() : installAppImage(),
    uninstall: () => options.platform === 'darwin' ? uninstallMac() : uninstallAppImage(),
  };
}
