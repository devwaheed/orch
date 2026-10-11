/**
 * Claude Code agent adapter.
 *
 * Implements AgentAdapter per:
 * - LOCKED PRD-05 (command: "claude")
 * - LOCKED ACC-02 (CLAUDE_CONFIG_DIR)
 * - LOCKED ACC-03 (parallel on macOS, Linux, Windows)
 * - LOCKED ACC-04 (email masking: first character, •••, @, domain)
 * - LOCKED ACC-09 (skills: ~/.claude/skills)
 */
import * as fs from 'node:fs';
import * as path from 'node:path';
import type { AccountId, AgentAdapter, CommandSpec, MultiAccountSupport, Os, QuotaObservation } from '@orch/contracts';
import { maskEmail } from '../common/maskEmail.js';
import { extractIsoTimestamp, RATE_LIMIT_PATTERN } from '../common/quota.js';

export class ClaudeAdapter implements AgentAdapter {
  readonly id = 'claude' as const;
  readonly displayName = 'Claude Code';
  readonly command = 'claude';
  readonly accountSetting = 'CLAUDE_CONFIG_DIR';
  readonly supportByOs: Readonly<Record<Os, MultiAccountSupport>> = Object.freeze({
    macos: 'parallel',
    linux: 'parallel',
    windows: 'parallel',
  });

  readonly testedVersions = '>=2.0.0 <3.0.0';

  accountEnv(profileDir: string, os: Os): Readonly<Record<string, string>> {
    void os;
    return Object.freeze({
      CLAUDE_CONFIG_DIR: profileDir,
    });
  }

  async prepareProfile(profileDir: string, os: Os): Promise<void> {
    void os;
    await fs.promises.mkdir(profileDir, { recursive: true });
  }

  loginCommand(profileDir: string, os: Os): CommandSpec {
    return {
      argv: ['claude', 'auth', 'login'],
      env: this.accountEnv(profileDir, os),
    };
  }

  whoAmICommand(profileDir: string, os: Os): CommandSpec | null {
    return {
      argv: ['claude', 'auth', 'status', '--json'],
      env: this.accountEnv(profileDir, os),
    };
  }

  parseWhoAmI(stdout: string): { emailMasked: string; plan?: string } | null {
    const trimmed = stdout.trim();
    if (!trimmed) return null;

    try {
      const data = JSON.parse(trimmed) as {
        loggedIn?: boolean;
        email?: string;
        subscriptionType?: string;
        plan?: string;
      };
      if (!data.loggedIn || !data.email) return null;
      const plan = data.subscriptionType || data.plan;
      return {
        emailMasked: maskEmail(data.email),
        ...(plan ? { plan: String(plan) } : {}),
      };
    } catch {
      // Non-JSON fallback
      if (/not logged in|loggedIn["':\s]+false/i.test(trimmed)) {
        return null;
      }
      const match = trimmed.match(/([a-zA-Z0-9_.+-]+@[a-zA-Z0-9-]+\.[a-zA-Z0-9-.]+)/);
      if (match && match[1]) {
        return { emailMasked: maskEmail(match[1]) };
      }
      return null;
    }
  }

  sharedSkillsDir(homeDir: string, os: Os): string | null {
    const p = os === 'windows' ? path.win32 : path.posix;
    return p.join(homeDir, '.claude', 'skills');
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
    let windowKind: '5h' | 'weekly' = '5h';

    try {
      const parsed = JSON.parse(trimmed) as Record<string, unknown>;
      const stopReason = parsed.stop_reason as string | undefined;
      const isError = Boolean(parsed.is_error);
      const text = `${String(parsed.result || '')} ${String(parsed.message || '')} ${String(parsed.error || '')}`;

      if (stopReason === 'rate_limit' || (isError && RATE_LIMIT_PATTERN.test(text)) || RATE_LIMIT_PATTERN.test(text)) {
        isLimited = true;
        const rawResets = typeof parsed.resets_at === 'string' ? parsed.resets_at : text;
        resetsAt = extractIsoTimestamp(rawResets);
        if (/weekly/i.test(text)) {
          windowKind = 'weekly';
        }
      }
    } catch {
      // Plain text output
      if (RATE_LIMIT_PATTERN.test(trimmed)) {
        isLimited = true;
        resetsAt = extractIsoTimestamp(trimmed);
        if (/weekly/i.test(trimmed)) {
          windowKind = 'weekly';
        }
      } else {
        const usageMatch = trimmed.match(/(?:usage|used)[:\s]+(\d+(?:\.\d+)?)\s*%/i);
        if (usageMatch && usageMatch[1]) {
          usedPct = parseFloat(usageMatch[1]);
          if (/weekly/i.test(trimmed)) {
            windowKind = 'weekly';
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

export const claudeAdapter = new ClaudeAdapter();
