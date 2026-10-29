/**
 * OpenCode agent adapter.
 *
 * Implements AgentAdapter per:
 * - LOCKED PRD-05 (command: "opencode")
 * - LOCKED ACC-02 (XDG_DATA_HOME + OPENCODE_CONFIG_DIR=<profile>/config)
 * - LOCKED ACC-03 (parallel on macOS/Linux, unverified on Windows)
 * - LOCKED ACC-04 (email masking: first character, •••, @, domain)
 * - LOCKED ACC-09 (skills: ~/.config/opencode/skills)
 */
import * as fs from 'node:fs';
import { homedir } from 'node:os';
import * as path from 'node:path';
import { execa } from 'execa';
import { redactText } from '../../bugreport/common/redact.js';
import type {
  AccountId,
  AgentAdapter,
  CommandSpec,
  MultiAccountSupport,
  Os,
  ProviderLogin,
  QuotaObservation,
} from '@orchagents/contracts';
import { maskEmail } from '../common/maskEmail.js';
import { extractIsoTimestamp, RATE_LIMIT_PATTERN } from '../common/quota.js';

/** opencode prints the credential type; older output used the contract's names directly. */
const PROVIDER_KINDS: Readonly<Record<string, ProviderLogin['kind']>> = {
  api: 'api_key',
  api_key: 'api_key',
  oauth: 'subscription',
  subscription: 'subscription',
};

/** An OpenCode v2 `auth list` row: integration, account, then how it is held. */
const V2_ROW = /^\S.*?\s{2,}\S.*?\s{2,}(stored|environment)\s*$/;

export type CapabilityRunner = (
  file: string,
  args: readonly string[],
  options?: { timeout?: number },
) => Promise<{ stdout: string }>;

export class OpenCodeAdapter implements AgentAdapter {
  readonly id = 'opencode' as const;
  readonly displayName = 'OpenCode';
  readonly command = 'opencode';
  readonly accountSetting = 'XDG_DATA_HOME + OPENCODE_CONFIG_DIR';
  readonly supportByOs: Readonly<Record<Os, MultiAccountSupport>> = Object.freeze({
    macos: 'parallel',
    linux: 'parallel',
    windows: 'unverified',
  });

  readonly testedVersions = '>=1.0.0 <3.0.0';

  private probePromise: Promise<boolean> | null = null;
  private _supportsStandalone = false;
  private readonly runner: CapabilityRunner;

  constructor(runner?: CapabilityRunner) {
    this.runner = runner ?? (async (file, args, opts) => {
      const result = await execa(file, args, { timeout: opts?.timeout ?? 5000, stdin: 'ignore' });
      return { stdout: typeof result.stdout === 'string' ? result.stdout : '' };
    });
  }

  get supportsStandalone(): boolean {
    return this._supportsStandalone;
  }

  async probe(runner?: CapabilityRunner): Promise<boolean> {
    if (this.probePromise) {
      return this.probePromise;
    }
    const run = runner ?? this.runner;
    this.probePromise = (async () => {
      try {
        const result = await run('opencode', ['auth', 'list', '--help'], { timeout: 5000 });
        const output = typeof result?.stdout === 'string' ? result.stdout : '';
        this._supportsStandalone = output.includes('--standalone');
      } catch (error) {
        this._supportsStandalone = false;
        const msg = error instanceof Error ? error.message : String(error);
        const isNotFound =
          (error as NodeJS.ErrnoException)?.code === 'ENOENT' ||
          msg.includes('ENOENT') ||
          msg.includes('not found') ||
          (error as { exitCode?: number })?.exitCode === 127;
        if (isNotFound) {
          const redacted = redactText(msg, { home: homedir() });
          console.warn(`[opencode] opencode not found on PATH: ${redacted}`);
        }
      }
      return this._supportsStandalone;
    })();
    return this.probePromise;
  }

  accountEnv(profileDir: string, os: Os): Readonly<Record<string, string>> {
    const p = os === 'windows' ? path.win32 : path.posix;
    const configDir = p.join(profileDir, 'config');
    return Object.freeze({
      XDG_DATA_HOME: profileDir,
      OPENCODE_CONFIG_DIR: configDir,
      ...(this._supportsStandalone ? { ORCH_OPENCODE_STANDALONE: '1' } : {}),
    });
  }

  async prepareProfile(profileDir: string, os: Os): Promise<void> {
    const p = os === 'windows' ? path.win32 : path.posix;
    const configDir = p.join(profileDir, 'config');
    await fs.promises.mkdir(profileDir, { recursive: true });
    await fs.promises.mkdir(configDir, { recursive: true });
  }

  loginCommand(profileDir: string, os: Os): CommandSpec {
    return {
      argv: this._supportsStandalone
        ? ['opencode', 'auth', 'login', '--standalone']
        : ['opencode', 'auth', 'login'],
      env: this.accountEnv(profileDir, os),
    };
  }

  resumeCommand(profileDirOrSession: string | null, osOrProfile: Os | string, maybeSessionOrOs?: string | Os | null): CommandSpec {
    let profileDir: string;
    let os: Os;
    if (osOrProfile === 'macos' || osOrProfile === 'linux' || osOrProfile === 'windows') {
      profileDir = profileDirOrSession ?? '';
      os = osOrProfile;
    } else {
      profileDir = osOrProfile;
      os = (maybeSessionOrOs as Os) ?? 'macos';
    }
    return {
      argv: ['opencode'],
      env: this.accountEnv(profileDir, os),
    };
  }

  whoAmICommand(profileDir: string, os: Os): CommandSpec | null {
    return {
      argv: this._supportsStandalone
        ? ['opencode', 'auth', 'list', '--standalone']
        : ['opencode', 'auth', 'list'],
      env: this.accountEnv(profileDir, os),
    };
  }

  parseWhoAmI(stdout: string): { emailMasked?: string; plan?: string } | null {
    const trimmed = stdout.trim();
    if (!trimmed) {
      return null;
    }

    // OpenCode v2 lists integrations as "<name>  <account>  <stored|environment>" rows, or says it has none.
    // Either way a successful listing means the account works (free models need no login); who it is stays unknown.
    if (/No authenticated integrations/i.test(trimmed)) return {};
    const v2Rows = trimmed.split(/\r?\n/).filter((line) => V2_ROW.test(line));
    if (v2Rows.length > 0) return { plan: `${v2Rows.length} provider logins` };

    const emailMatch = trimmed.match(/([a-zA-Z0-9_.+-]+@[a-zA-Z0-9-]+\.[a-zA-Z0-9-.]+)/);
    const countMatch = trimmed.match(/(\d+)\s+credentials/i);
    const plan = countMatch && countMatch[1] ? `${countMatch[1]} provider logins` : undefined;

    if (/credentials/i.test(trimmed) && /\d+\s+credentials/i.test(trimmed)) {
      if (!emailMatch?.[1]) return {};
    }

    if (emailMatch && emailMatch[1]) {
      return {
        emailMasked: maskEmail(emailMatch[1]),
        ...(plan ? { plan } : {}),
      };
    }

    return null;
  }

  /**
   * ACC-10: one provider login per "●" line of `opencode auth list`, e.g.
   * "●  GitHub Copilot (alex@acme.dev) subscription". The name is kept as shown,
   * since that is the only identifier the output gives. Every listed login is signed in.
   */
  /** ACC-10: one entry per credential in `opencode auth list` ("●  <provider> [(<who>)] <kind>"). */
  parseProviders(stdout: string): ProviderLogin[] {
    const providers: ProviderLogin[] = [];
    const plain = stdout.replace(/\u001b\[[0-9;]*m/g, '');
    for (const line of plain.split(/\r?\n/)) {
      const match = line.match(/^\s*●\s+(.+?)(?:\s+\([^)]*\))?\s+(\S+)\s*$/);
      const provider = match?.[1]?.trim();
      const kind = match?.[2] ? PROVIDER_KINDS[match[2]] : undefined;
      if (provider && kind) providers.push({ provider, kind });
    }
    return providers;
  }

  sharedSkillsDir(homeDir: string, os: Os): string | null {
    const p = os === 'windows' ? path.win32 : path.posix;
    return p.join(homeDir, '.config', 'opencode', 'skills');
  }

  profileSkillsDir(profileDir: string, os: Os): string | null {
    const p = os === 'windows' ? path.win32 : path.posix;
    return p.join(profileDir, 'config', 'skills');
  }

  parseQuotaSignal(accountId: AccountId, line: string): QuotaObservation | null {
    const trimmed = line.trim();
    if (!trimmed) return null;

    let isLimited = false;
    let resetsAt: string | null = null;
    let usedPct: number | undefined;
    let windowKind: 'monthly' | 'daily' = 'monthly';

    try {
      const parsed = JSON.parse(trimmed) as Record<string, unknown>;
      const errorMsg = String(parsed.error || parsed.message || '');
      if (RATE_LIMIT_PATTERN.test(errorMsg)) {
        isLimited = true;
        resetsAt = extractIsoTimestamp(errorMsg);
        if (/daily/i.test(errorMsg)) {
          windowKind = 'daily';
        }
      }
    } catch {
      if (RATE_LIMIT_PATTERN.test(trimmed)) {
        isLimited = true;
        resetsAt = extractIsoTimestamp(trimmed);
        if (/daily/i.test(trimmed)) {
          windowKind = 'daily';
        }
      } else {
        const usageMatch = trimmed.match(/(?:usage|used)[:\s]+(\d+(?:\.\d+)?)\s*%/i);
        if (usageMatch && usageMatch[1]) {
          usedPct = parseFloat(usageMatch[1]);
          if (/daily/i.test(trimmed)) {
            windowKind = 'daily';
          }
        }
      }
    }

    if (!isLimited && usedPct === undefined) {
      return null;
    }

    return {
      accountId,
      window: windowKind,
      ...(usedPct !== undefined ? { usedPct } : {}),
      limited: isLimited,
      resetsAt,
      source: 'reported',
      raw: trimmed.slice(0, 500),
    };
  }
}

export const opencodeAdapter = new OpenCodeAdapter();
