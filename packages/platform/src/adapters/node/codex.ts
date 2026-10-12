/**
 * Codex agent adapter.
 *
 * Implements AgentAdapter per:
 * - LOCKED PRD-05 (command: "codex")
 * - LOCKED ACC-02 (CODEX_HOME + cli_auth_credentials_store = "file" in profile config)
 * - LOCKED ACC-03 (parallel on macOS, Linux, Windows)
 * - LOCKED ACC-04 (email masking: first character, •••, @, domain)
 * - LOCKED ACC-09 (skills: ~/.codex/skills)
 * - S1-08: prepareProfile writes cli_auth_credentials_store = "file" idempotently
 */
import * as fs from 'node:fs';
import * as path from 'node:path';
import type { AccountId, AgentAdapter, CommandSpec, MultiAccountSupport, Os, QuotaObservation } from '@orchagents/contracts';
import { maskEmail } from '../common/maskEmail.js';
import { extractIsoTimestamp, RATE_LIMIT_PATTERN } from '../common/quota.js';

export class CodexAdapter implements AgentAdapter {
  readonly id = 'codex' as const;
  readonly displayName = 'Codex';
  readonly command = 'codex';
  readonly accountSetting = 'CODEX_HOME';
  readonly supportByOs: Readonly<Record<Os, MultiAccountSupport>> = Object.freeze({
    macos: 'parallel',
    linux: 'parallel',
    windows: 'parallel',
  });

  readonly testedVersions = '>=0.150.0 <1.0.0';

  accountEnv(profileDir: string, os: Os): Readonly<Record<string, string>> {
    void os;
    return Object.freeze({
      CODEX_HOME: profileDir,
    });
  }

  async prepareProfile(profileDir: string, os: Os): Promise<void> {
    void os;
    await fs.promises.mkdir(profileDir, { recursive: true });
    const configPath = path.join(profileDir, 'config.toml');
    const targetLine = 'cli_auth_credentials_store = "file"';
    const storeRegex = /^\s*cli_auth_credentials_store\s*=.*$/m;

    let content = '';
    try {
      content = await fs.promises.readFile(configPath, 'utf8');
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== 'ENOENT') {
        throw err;
      }
    }

    if (!content) {
      await fs.promises.writeFile(configPath, `${targetLine}\n`, 'utf8');
      return;
    }

    if (storeRegex.test(content)) {
      const updated = content.replace(storeRegex, targetLine);
      if (updated !== content) {
        await fs.promises.writeFile(configPath, updated, 'utf8');
      }
    } else {
      const separator = content.endsWith('\n') ? '' : '\n';
      await fs.promises.writeFile(configPath, `${content}${separator}${targetLine}\n`, 'utf8');
    }
  }

  loginCommand(profileDir: string, os: Os): CommandSpec {
    return {
      argv: ['codex', 'login'],
      env: this.accountEnv(profileDir, os),
    };
  }

  whoAmICommand(profileDir: string, os: Os): CommandSpec | null {
    return {
      argv: ['codex', 'login', 'status'],
      env: this.accountEnv(profileDir, os),
    };
  }

  parseWhoAmI(stdout: string): { emailMasked: string; plan?: string } | null {
    const trimmed = stdout.trim();
    if (!trimmed || /not logged in/i.test(trimmed)) {
      return null;
    }

    // Check for email
    const emailMatch = trimmed.match(/([a-zA-Z0-9_.+-]+@[a-zA-Z0-9-]+\.[a-zA-Z0-9-.]+)/);
    const planMatch = trimmed.match(/\((Plus|Team|Pro|Enterprise|ChatGPT[^)]*)\)/i) || trimmed.match(/plan:\s*([A-Za-z0-9_-]+)/i);

    if (emailMatch && emailMatch[1]) {
      const plan = planMatch && planMatch[1] ? planMatch[1] : undefined;
      return {
        emailMasked: maskEmail(emailMatch[1]),
        ...(plan ? { plan } : {}),
      };
    }

    if (/logged in using chatgpt/i.test(trimmed)) {
      return {
        emailMasked: 'c•••@openai.com',
        plan: 'ChatGPT',
      };
    }

    if (/logged in/i.test(trimmed)) {
      return {
        emailMasked: 'u•••@openai.com',
      };
    }

    return null;
  }

  sharedSkillsDir(homeDir: string, os: Os): string | null {
    const p = os === 'windows' ? path.win32 : path.posix;
    return p.join(homeDir, '.codex', 'skills');
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
      const eventType = parsed.type as string | undefined;
      const errorObj = parsed.error as Record<string, unknown> | undefined;
      const errorMsg = String(errorObj?.message || parsed.message || '');

      if (eventType === 'turn.failed' || eventType === 'error' || RATE_LIMIT_PATTERN.test(errorMsg)) {
        if (RATE_LIMIT_PATTERN.test(errorMsg)) {
          isLimited = true;
          resetsAt = extractIsoTimestamp(errorMsg);
          if (/weekly/i.test(errorMsg)) {
            windowKind = 'weekly';
          }
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

export const codexAdapter = new CodexAdapter();
