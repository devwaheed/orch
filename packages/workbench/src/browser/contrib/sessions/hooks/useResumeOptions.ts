/**
 * Loads the core's resume options for the selected session (ISessionsService.resumeOptions).
 * Reloads when the session (or its status or worktree) changes, or when accounts or quota change, since availability
 * depends on them. Ignores a reply that arrives after the session has changed.
 */
import { useEffect, useState } from 'react';
import type { ResumeOption, Session } from '@orch/contracts';
import { useAccountsStore } from '../../../services/stores/accounts.js';
import { useQuotaStore } from '../../../services/stores/quota.js';
import { sessionsServices } from '../services.js';

export function useResumeOptions(session: Session | null): ResumeOption[] {
  const services = sessionsServices();
  const accounts = useAccountsStore((s) => s.accounts);
  const limits = useQuotaStore((s) => s.limits);
  const windows = useQuotaStore((s) => s.windows);
  const [options, setOptions] = useState<ResumeOption[]>([]);

  const sessionId = session?.id ?? null;
  const status = session?.status ?? null;
  const worktree = session?.worktree ?? null;

  useEffect(() => {
    if (!services || sessionId === null || status === 'live') {
      setOptions([]);
      return undefined;
    }
    let current = true;
    void services.sessions.resumeOptions(sessionId).then((result) => {
      if (!current) return;
      setOptions(result.ok ? result.value : []);
    });
    return () => {
      current = false;
    };
  }, [services, sessionId, status, worktree, accounts, limits, windows]);

  return options;
}
