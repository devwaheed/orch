import { useEffect, useState } from 'react';
import type { AccountId, PickAccountResult, Run, RunLine } from '@orch/contracts';
import { useAccountsStore } from '../../../../services/stores/accounts.js';
import { useQuotaStore } from '../../../../services/stores/quota.js';
import { useRunsStore } from '../../../../services/stores/work.js';
import { useWorkbenchStore } from '../../../../services/workbenchStore.js';
import { getWorkServices } from '../../workServices.js';
import { workStrings } from '../../strings.js';
import { agentDisplayName } from '../../model/paneModel.js';
import { pausedCardView } from './pausedView.js';
import { useAutoResumeStore } from './autoResumeStore.js';
import { Icon } from '../../../../../../../../design/icons/Icon.js';
import styles from './PausedLimitCard.module.css';

const EMPTY: readonly RunLine[] = [];

interface Props {
  readonly run: Pick<Run, 'id' | 'resumesAt' | 'accountId' | 'agent' | 'sessionId'>;
}

/** Shown by PausedLimitSlot only while the run is paused_limit. */
export function PausedLimitCard({ run }: Props) {
  const accounts = useAccountsStore((s) => s.accounts);
  const agentInfo = useAccountsStore((s) => s.agents.find((a) => a.id === run.agent));
  const setActiveArea = useWorkbenchStore((s) => s.setActiveArea);
  const autoResume = useAutoResumeStore((s) => s.getAutoResume(run.id));
  const setAutoResumeLocal = useAutoResumeStore((s) => s.setAutoResume);
  const lines = useRunsStore((s) => s.lines[run.id]) ?? EMPTY;
  const windows = useQuotaStore((s) => s.windows);
  const [pick, setPick] = useState<PickAccountResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  // The core's own choice of account (QTA routing), refreshed when the account list changes.
  useEffect(() => {
    let live = true;
    void getWorkServices()
      ?.quota.pickAccount(run.agent)
      .then((res) => live && setPick(res.ok ? res.value : null));
    return () => {
      live = false;
    };
  }, [run.agent, run.accountId, accounts]);

  const accountName = (id: AccountId): string => accounts.find((a) => a.id === id)?.name ?? id;
  const view = pausedCardView({
    run,
    lines,
    windows: Object.values(windows),
    pick,
    agentName: agentDisplayName(run.agent, agentInfo?.displayName),
    accountName,
  });

  const resumeOn = view.resumeOn;

  const resumeNow = async (accountId: AccountId): Promise<void> => {
    const res = await getWorkServices()?.runs.resumeOn(run.id, accountId);
    setError(res && !res.ok ? res.error.message : null);
  };

  const changeAutoResume = async (on: boolean): Promise<void> => {
    setAutoResumeLocal(run.id, on);
    const res = await getWorkServices()?.runs.setAutoResume(run.id, on);
    if (res && !res.ok) {
      setAutoResumeLocal(run.id, !on);
      setError(res.error.message);
    }
  };

  return (
    <div className={styles.card} role="region" aria-label={workStrings.paused.title}>
      <div className={styles.header}>
        <Icon name="clock" size={18} weight={1.9} className={styles.icon!} aria-hidden="true" />
        <div className={styles.textBlock}>
          <strong className={styles.title}>{workStrings.paused.title}</strong>
          <span className={styles.subtext}>{view.pausedText}</span>
          {error ? <span className={styles.subtext}>{error}</span> : null}
        </div>
      </div>

      <div className={styles.actions}>
        {resumeOn ? (
          <button type="button" className={styles.resumeButton} onClick={() => void resumeNow(resumeOn.accountId)}>
            <Icon name="swap" size={13} weight={2.2} aria-hidden="true" />
            {resumeOn.label}
          </button>
        ) : null}
        <button type="button" className={styles.moreButton} onClick={() => setActiveArea('sessions')}>
          <Icon name="history" size={13} weight={2} aria-hidden="true" />
          {workStrings.paused.moreOptions}
        </button>
      </div>

      <label className={styles.autoResume}>
        <input
          type="checkbox"
          className={styles.checkbox}
          checked={autoResume}
          onChange={(e) => void changeAutoResume(e.target.checked)}
        />
        {view.autoText}
      </label>
    </div>
  );
}
