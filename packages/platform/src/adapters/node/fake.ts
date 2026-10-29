import { spawn, type ChildProcess, type SpawnOptions } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type {
  AccountId,
  AgentAdapter,
  AgentId,
  CommandSpec,
  MultiAccountSupport,
  Os,
  QuotaObservation,
  QuotaWindowKind,
  Timestamp,
} from '@orchagents/contracts';

const currentDir = path.dirname(fileURLToPath(import.meta.url));
export const FAKE_AGENT_SCRIPT_PATH = path.resolve(currentDir, '../../../test/fake-agent/fake-agent.mjs');
export const FAKE_AGENT_CMD_PATH = path.resolve(currentDir, '../../../test/fake-agent/fake-agent.cmd');

export function spawnFakeAgent(args: readonly string[] = [], options: SpawnOptions = {}): ChildProcess {
  return spawn(process.execPath, [FAKE_AGENT_SCRIPT_PATH, ...args], options);
}

export function spawnFakeProcess(command: string, args: readonly string[] = [], options: SpawnOptions = {}): ChildProcess {
  return spawn(command, args as string[], options);
}

export interface FakeAdapterOptions {
  impersonate?: AgentId;
  command?: string;
  testedVersions?: string;
}

export class FakeAgentAdapter implements AgentAdapter {
  readonly id: AgentId;
  readonly displayName: string;
  readonly command: string;
  readonly accountSetting: string;
  readonly testedVersions: string;

  readonly supportByOs: Readonly<Record<Os, MultiAccountSupport>> = {
    macos: 'parallel',
    linux: 'parallel',
    windows: 'parallel',
  };

  constructor(options?: AgentId | FakeAdapterOptions) {
    const opts: FakeAdapterOptions = typeof options === 'string' ? { impersonate: options } : (options ?? {});
    this.id = opts.impersonate ?? 'claude';
    this.testedVersions = opts.testedVersions ?? '>=0.0.0';

    if (opts.command) {
      this.command = opts.command;
    } else {
      this.command = process.platform === 'win32' ? FAKE_AGENT_CMD_PATH : FAKE_AGENT_SCRIPT_PATH;
    }

    switch (this.id) {
      case 'claude':
        this.displayName = 'Fake Claude Code';
        this.accountSetting = 'CLAUDE_CONFIG_DIR';
        break;
      case 'codex':
        this.displayName = 'Fake Codex';
        this.accountSetting = 'CODEX_HOME';
        break;
      case 'gemini':
        this.displayName = 'Fake Gemini CLI';
        this.accountSetting = 'GEMINI_CLI_HOME';
        break;
      case 'opencode':
        this.displayName = 'Fake OpenCode';
        this.accountSetting = 'OPENCODE_CONFIG_DIR';
        break;
      case 'agy':
        this.displayName = 'Fake Antigravity';
        this.accountSetting = 'HOME';
        break;
    }
  }

  accountEnv(profileDir: string, os: Os): Readonly<Record<string, string>> {
    switch (this.id) {
      case 'claude':
        return { CLAUDE_CONFIG_DIR: profileDir };
      case 'codex':
        return { CODEX_HOME: profileDir };
      case 'gemini':
        return { GEMINI_CLI_HOME: profileDir };
      case 'opencode':
        return {
          XDG_DATA_HOME: profileDir,
          OPENCODE_CONFIG_DIR: path.join(profileDir, 'config'),
        };
      case 'agy':
        return os === 'windows' ? { USERPROFILE: profileDir } : { HOME: profileDir };
    }
  }

  async prepareProfile(profileDir: string, os: Os = 'macos'): Promise<void> {
    void os;
    await fs.promises.mkdir(profileDir, { recursive: true });
    const accountFile = path.join(profileDir, 'account.json');
    try {
      await fs.promises.access(accountFile);
    } catch {
      await fs.promises.writeFile(
        accountFile,
        JSON.stringify({ emailMasked: 'f•••@example.com', plan: 'pro', signedIn: true }, null, 2),
        'utf8',
      );
    }
  }

  loginCommand(profileDir: string, os: Os): CommandSpec {
    const argv =
      process.platform === 'win32' && this.command.endsWith('.mjs')
        ? [process.execPath, this.command, 'login']
        : [this.command, 'login'];
    return {
      argv,
      env: this.accountEnv(profileDir, os),
      cwd: profileDir,
    };
  }

  resumeCommand(profileDirOrSession: string | null, osOrProfile: Os | string, maybeSessionOrOs?: string | Os | null): CommandSpec {
    let profileDir: string;
    let os: Os;
    let sessionId: string | null = null;
    if (osOrProfile === 'macos' || osOrProfile === 'linux' || osOrProfile === 'windows') {
      profileDir = profileDirOrSession ?? '';
      os = osOrProfile;
      sessionId = (maybeSessionOrOs as string | null) ?? null;
    } else {
      sessionId = profileDirOrSession;
      profileDir = osOrProfile;
      os = (maybeSessionOrOs as Os) ?? 'macos';
    }

    const baseArgv =
      process.platform === 'win32' && this.command.endsWith('.mjs')
        ? [process.execPath, this.command]
        : [this.command];

    let extraArgs: string[];
    switch (this.id) {
      case 'claude':
        extraArgs = sessionId ? ['--resume', sessionId] : [];
        break;
      case 'codex':
        extraArgs = sessionId ? ['resume', sessionId] : [];
        break;
      case 'agy':
        extraArgs = sessionId ? ['--conversation', sessionId] : [];
        break;
      default:
        extraArgs = [];
        break;
    }

    return {
      argv: [...baseArgv, ...extraArgs],
      env: this.accountEnv(profileDir, os),
      cwd: profileDir,
    };
  }

  whoAmICommand(profileDir: string, os: Os): CommandSpec | null {
    const argv =
      process.platform === 'win32' && this.command.endsWith('.mjs')
        ? [process.execPath, this.command, 'whoami']
        : [this.command, 'whoami'];
    return {
      argv,
      env: this.accountEnv(profileDir, os),
      cwd: profileDir,
    };
  }

  parseWhoAmI(stdout: string): { emailMasked: string; plan?: string } | null {
    const trimmed = stdout.trim();
    if (!trimmed || trimmed === 'Not logged in' || trimmed.toLowerCase().includes('not logged in')) {
      return null;
    }
    try {
      const parsed = JSON.parse(trimmed) as { emailMasked?: string; plan?: string };
      if (parsed.emailMasked) {
        const res: { emailMasked: string; plan?: string } = { emailMasked: parsed.emailMasked };
        if (parsed.plan !== undefined) {
          res.plan = parsed.plan;
        }
        return res;
      }
    } catch {
      // not json
    }
    const match = trimmed.match(/Logged in as\s+([^\s()]+)(?:\s+\(([^)]+)\))?/i);
    if (match && match[1]) {
      const res: { emailMasked: string; plan?: string } = { emailMasked: match[1] };
      if (match[2] !== undefined) {
        res.plan = match[2];
      }
      return res;
    }
    return null;
  }

  sharedSkillsDir(homeDir: string, os: Os = 'macos'): string | null {
    void os;
    return path.join(homeDir, `.${this.id}`, 'skills');
  }

  profileSkillsDir(profileDir: string, os: Os = 'macos'): string | null {
    void os;
    return path.join(profileDir, 'skills');
  }

  parseQuotaSignal(accountId: AccountId, line: string): QuotaObservation | null {
    if (!/(?:rate[ -]?limit|quota[ -]?limit|limited)/i.test(line)) {
      return null;
    }

    const dateMatch = line.match(
      /(?:resets?(?: at| until|=)|\bresetsAt=)\s*([0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}(?:\.[0-9]+)?Z)/i,
    );
    const windowMatch = line.match(/(?:window[:=]\s*|\bwindow\s+)(per_minute|5h|daily|weekly|monthly)/i);
    const usedMatch = line.match(/(?:used[:=]\s*|usedPct=)(\d+(?:\.\d+)?)/i);

    const window = (windowMatch ? windowMatch[1] : undefined) as QuotaWindowKind | undefined;
    const usedPct = usedMatch ? Math.min(100, Math.max(0, Number(usedMatch[1]))) : 100;
    const resetsAt = dateMatch ? (dateMatch[1] as Timestamp) : null;

    return {
      accountId,
      window: window ?? '5h',
      usedPct,
      limited: true,
      resetsAt,
      source: 'reported',
      raw: line.slice(0, 500),
    };
  }
}

export function createFakeAdapter(options?: AgentId | FakeAdapterOptions): AgentAdapter {
  return new FakeAgentAdapter(options);
}

export function fakeAdapter(options?: AgentId | FakeAdapterOptions): AgentAdapter {
  return new FakeAgentAdapter(options);
}

export default createFakeAdapter;
