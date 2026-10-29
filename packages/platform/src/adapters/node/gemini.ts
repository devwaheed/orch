/**
 * Gemini CLI agent adapter.
 *
 * Implements AgentAdapter per:
 * - LOCKED PRD-05 (command: "gemini")
 * - LOCKED ACC-02 (GEMINI_CLI_HOME)
 * - LOCKED ACC-03 (parallel on macOS, Linux, Windows)
 * - LOCKED ACC-04 (email masking: first character, •••, @, domain)
 * - LOCKED ACC-09 (skills: ~/.gemini/skills)
 */
import * as fs from 'node:fs';
import * as path from 'node:path';
import type { AccountId, AgentAdapter, CommandSpec, MultiAccountSupport, Os, QuotaObservation } from '@orchagents/contracts';
import { maskEmail } from '../common/maskEmail.js';
import { extractIsoTimestamp, RATE_LIMIT_PATTERN } from '../common/quota.js';

export class GeminiAdapter implements AgentAdapter {
  readonly id = 'gemini' as const;
  readonly displayName = 'Gemini CLI';
  readonly command = 'gemini';
  readonly accountSetting = 'GEMINI_CLI_HOME';
  readonly supportByOs: Readonly<Record<Os, MultiAccountSupport>> = Object.freeze({
    macos: 'parallel',
    linux: 'parallel',
    windows: 'parallel',
  });

  readonly testedVersions = '>=0.40.0 <1.0.0';

  accountEnv(profileDir: string, os: Os): Readonly<Record<string, string>> {
    void os;
    return Object.freeze({
      GEMINI_CLI_HOME: profileDir,
    });
  }

  async prepareProfile(profileDir: string, os: Os): Promise<void> {
    void os;
    await fs.promises.mkdir(profileDir, { recursive: true });
  }

  loginCommand(profileDir: string, os: Os): CommandSpec {
    return {
      argv: ['gemini'],
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
      argv: ['gemini'],
      env: this.accountEnv(profileDir, os),
    };
  }

  /**
   * Gemini CLI 0.63 has no sign-in status command (checked with --help, 2026-10-11), so the
   * signed-in account can't be asked for. ACC-04 [SPIKE]: verify on real machines.
   */
  whoAmICommand(): CommandSpec | null {
    return null;
  }

  parseWhoAmI(stdout: string): { emailMasked: string; plan?: string } | null {
    const trimmed = stdout.trim();
    if (!trimmed || /not logged in|please set an auth method/i.test(trimmed)) {
      return null;
    }

    const emailMatch = trimmed.match(/([a-zA-Z0-9_.+-]+@[a-zA-Z0-9-]+\.[a-zA-Z0-9-.]+)/);
    const planMatch = trimmed.match(/\((Free tier|Google account|Pro|Advanced)\)/i) || trimmed.match(/plan:\s*([A-Za-z0-9_ -]+)/i);

    if (emailMatch && emailMatch[1]) {
      const plan = planMatch && planMatch[1] ? planMatch[1] : 'Free tier';
      return {
        emailMasked: maskEmail(emailMatch[1]),
        plan,
      };
    }

    if (/logged in/i.test(trimmed)) {
      return {
        emailMasked: 'g•••@google.com',
        plan: 'Free tier',
      };
    }

    return null;
  }

  sharedSkillsDir(homeDir: string, os: Os): string | null {
    const p = os === 'windows' ? path.win32 : path.posix;
    return p.join(homeDir, '.gemini', 'skills');
  }

  profileSkillsDir(profileDir: string, os: Os): string | null {
    const p = os === 'windows' ? path.win32 : path.posix;
    return p.join(profileDir, 'skills');
  }

  parseQuotaSignal(accountId: AccountId, line: string): QuotaObservation | null {
    const trimmed = line.trim();
    if (!trimmed) return null;

    let isLimited = false;
    let resetsAt: string | null = null;
    let usedPct: number | undefined;

    try {
      const parsed = JSON.parse(trimmed) as Record<string, unknown>;
      const errorMsg = String(parsed.error || parsed.message || '');
      if (RATE_LIMIT_PATTERN.test(errorMsg)) {
        isLimited = true;
        resetsAt = extractIsoTimestamp(errorMsg);
      }
    } catch {
      if (RATE_LIMIT_PATTERN.test(trimmed) || /exit code 53|turn limit/i.test(trimmed)) {
        isLimited = true;
        resetsAt = extractIsoTimestamp(trimmed);
      } else {
        const usageMatch = trimmed.match(/(?:usage|used)[:\s]+(\d+(?:\.\d+)?)\s*%/i);
        if (usageMatch && usageMatch[1]) {
          usedPct = parseFloat(usageMatch[1]);
        }
      }
    }

    if (!isLimited && usedPct === undefined) {
      return null;
    }

    return {
      accountId,
      window: 'daily',
      ...(usedPct !== undefined ? { usedPct } : {}),
      limited: isLimited,
      resetsAt,
      source: 'estimated',
      raw: trimmed.slice(0, 500),
    };
  }
}

export const geminiAdapter = new GeminiAdapter();
