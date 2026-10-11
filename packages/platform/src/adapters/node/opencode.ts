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
import * as path from 'node:path';
import type { AccountId, AgentAdapter, CommandSpec, MultiAccountSupport, Os, QuotaObservation } from '@orch/contracts';
import { maskEmail } from '../common/maskEmail.js';
import { extractIsoTimestamp, RATE_LIMIT_PATTERN } from '../common/quota.js';

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

  readonly testedVersions = '>=1.0.0 <2.0.0';

  accountEnv(profileDir: string, os: Os): Readonly<Record<string, string>> {
    const p = os === 'windows' ? path.win32 : path.posix;
    const configDir = p.join(profileDir, 'config');
    return Object.freeze({
      XDG_DATA_HOME: profileDir,
      OPENCODE_CONFIG_DIR: configDir,
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
      argv: ['opencode', 'auth', 'login'],
      env: this.accountEnv(profileDir, os),
    };
  }

  whoAmICommand(profileDir: string, os: Os): CommandSpec | null {
    return {
      argv: ['opencode', 'auth', 'list'],
      env: this.accountEnv(profileDir, os),
    };
  }

  parseWhoAmI(stdout: string): { emailMasked: string; plan?: string } | null {
    const trimmed = stdout.trim();
    if (!trimmed || /0 credentials/i.test(trimmed)) {
      return null;
    }

    const emailMatch = trimmed.match(/([a-zA-Z0-9_.+-]+@[a-zA-Z0-9-]+\.[a-zA-Z0-9-.]+)/);
    const countMatch = trimmed.match(/(\d+)\s+credentials/i);
    const plan = countMatch && countMatch[1] ? `${countMatch[1]} provider logins` : undefined;

    if (emailMatch && emailMatch[1]) {
      return {
        emailMasked: maskEmail(emailMatch[1]),
        ...(plan ? { plan } : {}),
      };
    }

    if (/credentials/i.test(trimmed) && /●/i.test(trimmed)) {
      return {
        emailMasked: 'o•••@opencode.ai',
        ...(plan ? { plan } : { plan: 'Provider login' }),
      };
    }

    return null;
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
