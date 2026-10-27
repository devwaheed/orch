import { Icon } from '../../../../../../design/icons/Icon.js';
import { useWorkbenchStore } from '../../services/workbenchStore.js';
import { useQuotaStore } from '../../services/stores/quota.js';
import { useAccountsStore } from '../../services/stores/accounts.js';
import { useRunsStore } from '../../services/stores/work.js';
import { buildCapacityModel, formatSpendUsd, type CapacitySnapshot } from './model.js';
import { shellStrings } from '../strings.js';
import { cx } from '../cx.js';
import { useMemo, useState } from 'react';
import type { CSSProperties } from 'react';

// .capacityPanel — the border flips sides when the menu moves to the right
const capacityPanelClass =
  'flex flex-col gap-5 w-capacity-w shrink-0 box-border py-6 px-5 bg-chrome border-l border-line in-data-[menu-side=right]:border-l-0 in-data-[menu-side=right]:border-r';

const legendDotClass = 'w-[16px] h-[4px] rounded-2px bg-[var(--legend-dot-bg,var(--ok-dot))]';

const iconButtonClass =
  'flex items-center justify-center w-10 h-10 rounded-sm bg-transparent cursor-pointer';

export function CapacityPanel() {
  const capacityOpen = useWorkbenchStore((s) => s.capacityOpen);
  const toggleCapacity = useWorkbenchStore((s) => s.toggleCapacity);

  if (!capacityOpen) {
    return null;
  }

  return <CapacityPanelContent toggleCapacity={toggleCapacity} />;
}

function CapacityPanelContent({ toggleCapacity }: { toggleCapacity: () => void }) {
  const [expandedAccount, setExpandedAccount] = useState<string | null>(null);

  const accounts = useAccountsStore((s) => s.accounts);
  const agents = useAccountsStore((s) => s.agents);
  const windows = useQuotaStore((s) => s.windows);
  const limits = useQuotaStore((s) => s.limits);
  const spendToday = useQuotaStore((s) => s.spendToday);
  const runs = useRunsStore((s) => s.runs);

  const now = useMemo(() => new Date(), []);

  const runCounts = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const r of runs) {
      if (r.status === 'running') {
        counts[r.accountId] = (counts[r.accountId] ?? 0) + 1;
      }
    }
    return counts;
  }, [runs]);

  const holding = useMemo(() => {
    const holdings: Record<string, string> = {};
    for (const r of runs) {
      if (r.status === 'paused_limit' && r.resumesAt) {
        holdings[r.accountId] = `Holding ${r.id}${r.sessionId ? ` (session ${r.sessionId})` : ''} until reset`;
      }
    }
    return holdings;
  }, [runs]);

  const snapshot: CapacitySnapshot = {
    accounts,
    agents,
    windows,
    limits,
    spendToday,
    now,
    expandedAccount: expandedAccount as CapacitySnapshot['expandedAccount'],
    runCounts,
    holding,
  };

  const model = useMemo(() => buildCapacityModel(snapshot), [snapshot]);

  const toggleAccount = (accountId: string) => {
    setExpandedAccount(expandedAccount === accountId ? null : accountId);
  };

  const goAccounts = () => useWorkbenchStore.getState().setActiveArea('accounts');

  return (
    <aside aria-label={shellStrings.capacity.ariaLabel} className={capacityPanelClass}>
      <div className="flex items-center gap-2">
        <h2 className="[margin:0] text-base font-semibold flex-auto flex items-center gap-1">
          <Icon name="gauge" size={15} weight={2.2} />
          {shellStrings.capacity.title} <span className="font-regular text-faint text-11px">{shellStrings.capacity.liveUsage}</span>
        </h2>
        <button
          type="button"
          onClick={goAccounts}
          aria-label={shellStrings.capacity.accountSettings}
          title={shellStrings.capacity.accountSettings}
          className={cx(iconButtonClass, 'w-10 h-10 border border-line text-text3')}
        >
          <Icon name="gear" size={13} weight={1.9} />
        </button>
        <button
          type="button"
          onClick={toggleCapacity}
          aria-label={shellStrings.titleBar.toggleCapacity}
          className={cx(iconButtonClass, 'w-10 h-10 border-none text-muted2')}
        >
          <Icon name="close" size={12} weight={2.4} />
        </button>
      </div>

      {model.showEmpty ? (
        <div className="flex flex-col gap-1 px-1">
          <span className="text-xs font-semibold text-text2">{shellStrings.capacity.emptyTitle}</span>
          <span className="text-2xs text-muted2">{shellStrings.capacity.emptyDescription}</span>
        </div>
      ) : (
        <>
          <div className="flex gap-5 text-2xs text-muted2">
            <span className="flex items-center gap-5px">
              <span className={legendDotClass} style={{ '--legend-dot-bg': 'var(--ok-dot)' } as CSSProperties}></span>
              {shellStrings.capacity.legendReported}
            </span>
            <span className="flex items-center gap-5px">
              <span
                className={legendDotClass}
                style={{ '--legend-dot-bg': 'repeating-linear-gradient(90deg, var(--muted2) 0 4px, var(--disabled) 4px 7px)' } as CSSProperties}
              ></span>
              {shellStrings.capacity.legendEstimated}
            </span>
          </div>

          {spendToday && (
            <div className="flex items-center gap-3 py-3 px-4 rounded-md bg-panel2 text-xs text-muted">
              <Icon name="coin" size={13} weight={1.9} />
              <span className="flex items-start gap-3 flex-auto min-w-[0px]">
                <span className="block flex-auto min-w-[0px]">
                  {shellStrings.capacity.spendToday} <strong className="text-text font-semibold">{formatSpendUsd(spendToday.usd)}</strong> · {shellStrings.capacity.spendApiKeysOnly}
                </span>
                <span className="flex-[0_0_42px] text-faint cursor-pointer text-right">{shellStrings.capacity.spendRunLedger}</span>
              </span>
            </div>
          )}

          {model.agents.map((group) => (
            <div key={group.agentId} className="flex flex-col gap-2">
              <div className="flex items-center gap-3 px-2px">
                <span
                  className="shrink-0 basis-18px h-18px rounded-xs font-mono text-7p5 font-semibold flex items-center justify-center bg-(--tile-bg) text-(--tile-fg)"
                  style={{ '--tile-bg': group.tileBg, '--tile-fg': group.tileFg } as CSSProperties}
                >
                  {group.mono}
                </span>
                <span className="font-semibold text-sm flex-auto">{group.displayName}</span>
                <span className="text-faint text-2xs">{group.usableText}</span>
              </div>
              {group.accounts.map((acct) => (
                <div
                  key={acct.accountId}
                  className={cx(
                    'border rounded-9px bg-panel2 overflow-hidden',
                    acct.stateKind === 'limited' ? 'border-warn-line' : 'border-line',
                  )}
                >
                  <button
                    type="button"
                    onClick={() => toggleAccount(acct.accountId)}
                    aria-expanded={acct.expanded}
                    className="w-full flex flex-col gap-7px py-9px px-4 min-h-[44px] border-none bg-transparent text-text text-left cursor-pointer"
                  >
                    <span className="flex items-center gap-1 w-full">
                      <span className="font-medium text-sm">{acct.label}</span>
                      {acct.isPrimary && <Icon name="starFill" size={10} weight={1} className="text-info" />}
                      {acct.inUse && <span className="text-info text-2xs">{acct.inUseText}</span>}
                      <span
                        className="text-2xs ml-auto whitespace-nowrap flex-[0_0_auto] text-(--pill-fg)"
                        style={{ '--pill-fg': acct.pillColor } as CSSProperties}
                      >
                        {acct.stateLabel}
                      </span>
                      <span
                        className="inline-flex text-faint transform-(--chevron)"
                        style={{ '--chevron': acct.chevron } as CSSProperties}
                      >
                        <Icon name="chevDown" size={12} weight={2} />
                      </span>
                    </span>
                    <span className="h-[4px] w-full rounded-xs bg-line overflow-hidden block">
                      <span
                        className="block h-[4px] w-(--bar-w) bg-(--bar-bg)"
                        style={{ '--bar-w': acct.topPct ? `${acct.topPct}%` : '0%', '--bar-bg': barBg(acct) } as CSSProperties}
                      ></span>
                    </span>
                    <span className="flex justify-between w-full text-2xs text-muted2">
                      <span>{acct.bindingText}</span>
                      <span>{acct.resetText}</span>
                    </span>
                  </button>
                  {acct.expanded && (
                    <div className="pt-2px px-4 pb-4 flex flex-col gap-3 border-t border-line2">
                      {acct.windows.map((w) => (
                        <div key={w.key} className="flex flex-col gap-3px pt-2">
                          <div className="flex justify-between text-xs">
                            <span className="text-muted2">{w.label}</span>
                            <span className="font-mono text-text3">{w.pctText} · {w.resetText}</span>
                          </div>
                          <div className="h-[4px] rounded-xs bg-line overflow-hidden">
                            <div
                              className="h-[4px] w-(--w) bg-(--bg)"
                              style={{ '--w': w.width, '--bg': w.bar } as CSSProperties}
                            />
                          </div>
                        </div>
                      ))}
                      <div className="flex flex-col text-2xs text-muted2">
                        <span>{acct.emailMasked} · {acct.plan}</span>
                        <span>{acct.sourceText} · seen {acct.seenText}</span>
                        {acct.holding && <span className="text-warn">{acct.holding}</span>}
                      </div>
                    </div>
                  )}
                </div>
              ))}
            </div>
          ))}
        </>
      )}
    </aside>
  );
}

function barBg(acct: { stateKind: string }): string {
  switch (acct.stateKind) {
    case 'limited': return 'var(--warn-solid)';
    case 'near': return 'var(--warn-bar)';
    case 'estimated': return 'repeating-linear-gradient(90deg, var(--muted2) 0 5px, var(--disabled) 5px 8px)';
    case 'signed_out': return 'var(--strongline)';
    default: return 'var(--ok-dot)';
  }
}
