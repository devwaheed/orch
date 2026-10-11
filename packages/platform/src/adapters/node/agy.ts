/**
 * Google Antigravity (agy) agent adapter.
 *
 * Implements AgentAdapter per:
 * - LOCKED PRD-05 (command: "agy", marked experimental)
 * - LOCKED ACC-02 (separate home folder: HOME / USERPROFILE)
 * - LOCKED ACC-03 (parallel on Linux, single on macOS and Windows)
 * - LOCKED ACC-04 (email masking: first character, •••, @, domain)
 * - LOCKED ACC-09 (skills: ~/.gemini/antigravity/skills)
 */
import * as fs from 'node:fs';
import * as path from 'node:path';
import type { AccountId, AgentAdapter, CommandSpec, MultiAccountSupport, Os, QuotaObservation } from '@orch/contracts';
import { maskEmail } from '../common/maskEmail.js';
import { extractIsoTimestamp, RATE_LIMIT_PATTERN } from '../common/quota.js';

export class AntigravityAdapter implements AgentAdapter {
  readonly id = 'agy' as const;
  readonly displayName = 'Antigravity';
  readonly command = 'agy';
  readonly accountSetting = 'separate home folder';
  readonly supportByOs: Readonly<Record<Os, MultiAccountSupport>> = Object.freeze({
    macos: 'single',
    linux: 'parallel',
    windows: 'single',
  });

  readonly testedVersions = '>=1.0.0 <2.0.0';

  accountEnv(profileDir: string, os: Os): Readonly<Record<string, string>> {
    if (os === 'windows') {
      return Object.freeze({
        USERPROFILE: profileDir,
      });
    }
    return Object.freeze({
      HOME: profileDir,
    });
  }

  async prepareProfile(profileDir: string, os: Os): Promise<void> {
    void os;
    await fs.promises.mkdir(profileDir, { recursive: true });
  }

  loginCommand(profileDir: string, os: Os): CommandSpec {
    return {
      argv: ['agy'],
      env: this.accountEnv(profileDir, os),
    };
  }

  /**
   * agy 1.3.3 has no sign-in status command (checked with --help, 2026-10-11), so the
   * signed-in account can't be asked for. ACC-04 [SPIKE]: verify on real machines.
   */
  whoAmICommand(): CommandSpec | null {
    return null;
  }

  parseWhoAmI(stdout: string): { emailMasked: string; plan?: string } | null {
    const trimmed = stdout.trim();
    if (!trimmed || /authentication required|not logged in/i.test(trimmed)) {
      return null;
    }

    const emailMatch = trimmed.match(/([a-zA-Z0-9_.+-]+@[a-zA-Z0-9-]+\.[a-zA-Z0-9-.]+)/);
    const planMatch = trimmed.match(/\((Google account|Free tier|Pro)\)/i) || trimmed.match(/plan:\s*([A-Za-z0-9_ -]+)/i);

    if (emailMatch && emailMatch[1]) {
      const plan = planMatch && planMatch[1] ? planMatch[1] : 'Google account';
      return {
        emailMasked: maskEmail(emailMatch[1]),
        plan,
      };
    }

    if (/logged in/i.test(trimmed)) {
      return {
        emailMasked: 'g•••@gmail.com',
        plan: 'Google account',
      };
    }

    return null;
  }

  sharedSkillsDir(homeDir: string, os: Os): string | null {
    const p = os === 'windows' ? path.win32 : path.posix;
    return p.join(homeDir, '.gemini', 'antigravity', 'skills');
  }

  profileSkillsDir(profileDir: string, os: Os): string | null {
    const p = os === 'windows' ? path.win32 : path.posix;
    return p.join(profileDir, '.gemini', 'antigravity', 'skills');
  }

  parseQuotaSignal(accountId: AccountId, line: string): QuotaObservation | null {
    const trimmed = line.trim();
    if (!trimmed) return null;

    let isLimited = false;
    let resetsAt: string | null = null;
    let usedPct: number | undefined;

    try {
      const parsed = JSON.parse(trimmed) as Record<string, unknown>;
      const resultObj = parsed.result as Record<string, unknown> | undefined;
      const status = String(resultObj?.status || parsed.status || '');
      const errorMsg = String(resultObj?.error || parsed.error || '');

      if (status === 'ERROR' && RATE_LIMIT_PATTERN.test(errorMsg)) {
        isLimited = true;
        resetsAt = extractIsoTimestamp(errorMsg);
      } else if (RATE_LIMIT_PATTERN.test(errorMsg)) {
        isLimited = true;
        resetsAt = extractIsoTimestamp(errorMsg);
      }
    } catch {
      if (RATE_LIMIT_PATTERN.test(trimmed)) {
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

export const agyAdapter = new AntigravityAdapter();
