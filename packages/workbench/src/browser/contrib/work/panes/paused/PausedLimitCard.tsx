import { useEffect, useState } from 'react';
import type { AccountId, PickAccountResult, Run, RunLine } from '@orchagents/contracts';
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

const FOCUS_RING = 'focus-visible:outline-2 focus-visible:outline-focus focus-visible:outline-offset-2';

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
    <div
      className="flex flex-col gap-5 mx-6 mt-5 p-5 rounded-lg border border-warn-line bg-warn-bg2"
      role="region"
      aria-label={workStrings.paused.title}
    >
      <div className="flex gap-4 items-start">
        <Icon name="clock" size={18} weight={1.9} className="shrink-0 basis-[18px] mt-0 text-warn-solid" aria-hidden="true" />
        <div className="flex flex-col gap-1 text-warn-text">
          <strong className="text-warn-strong font-semibold text-base">{workStrings.paused.title}</strong>
          <span className="text-sm">{view.pausedText}</span>
          {error ? <span className="text-sm">{error}</span> : null}
        </div>
      </div>

      <div className="flex flex-wrap gap-3">
        {resumeOn ? (
          <button
            type="button"
            className={`flex items-center gap-2 min-h-[34px] px-4 py-2 rounded-sm border-0 bg-warn-solid text-on-warn font-semibold text-sm cursor-pointer ${FOCUS_RING}`}
            onClick={() => void resumeNow(resumeOn.accountId)}
          >
            <Icon name="swap" size={13} weight={2.2} aria-hidden="true" />
            {resumeOn.label}
          </button>
        ) : null}
        <button
          type="button"
          className={`flex items-center gap-2 min-h-[34px] px-4 py-2 rounded-sm border border-warn-line bg-transparent text-warn-text text-sm cursor-pointer ${FOCUS_RING}`}
          onClick={() => setActiveArea('sessions')}
        >
          <Icon name="history" size={13} weight={2} aria-hidden="true" />
          {workStrings.paused.moreOptions}
        </button>
      </div>

      <label className="flex items-center gap-3 text-sm text-warn-soft cursor-pointer">
        <input
          type="checkbox"
          className="w-[15px] h-[15px] accent-warn-solid"
          checked={autoResume}
          onChange={(e) => void changeAutoResume(e.target.checked)}
        />
        {view.autoText}
      </label>
    </div>
  );
}
