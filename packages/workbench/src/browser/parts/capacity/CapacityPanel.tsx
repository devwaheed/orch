import { Icon } from '../../../../../../design/icons/Icon.js';
import { useWorkbenchStore } from '../../services/workbenchStore.js';
import { useQuotaStore } from '../../services/stores/quota.js';
import { useAccountsStore } from '../../services/stores/accounts.js';
import { useRunsStore } from '../../services/stores/work.js';
import { buildCapacityModel, formatSpendUsd, type CapacitySnapshot } from './model.js';
import { shellStrings } from '../strings.js';
import styles from './CapacityPanel.module.css';
import { useMemo, useState } from 'react';
import type { CSSProperties } from 'react';

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
    <aside aria-label={shellStrings.capacity.ariaLabel} className={styles.capacityPanel}>
      <div className={styles.header}>
        <h2 className={styles.title}>
          <Icon name="gauge" size={15} weight={2.2} />
          {shellStrings.capacity.title} <span className={styles.titleSub}>{shellStrings.capacity.liveUsage}</span>
        </h2>
        <button
          type="button"
          onClick={goAccounts}
          aria-label={shellStrings.capacity.accountSettings}
          title={shellStrings.capacity.accountSettings}
          className={styles.iconButton}
        >
          <Icon name="gear" size={13} weight={1.9} />
        </button>
        <button
          type="button"
          onClick={toggleCapacity}
          aria-label={shellStrings.titleBar.toggleCapacity}
          className={`${styles.iconButton} ${styles.iconButtonTight}`}
        >
          <Icon name="close" size={12} weight={2.4} />
        </button>
      </div>

      {model.showEmpty ? (
        <div className={styles.emptyContent}>
          <span className={styles.emptyTitle}>{shellStrings.capacity.emptyTitle}</span>
          <span className={styles.emptyDescription}>{shellStrings.capacity.emptyDescription}</span>
        </div>
      ) : (
        <>
          <div className={styles.legend}>
            <span className={styles.legendItem}>
              <span className={styles.legendDot} style={{ '--legend-dot-bg': 'var(--ok-dot)' } as CSSProperties}></span>
              {shellStrings.capacity.legendReported}
            </span>
            <span className={styles.legendItem}>
              <span
                className={styles.legendDot}
                style={{ '--legend-dot-bg': 'repeating-linear-gradient(90deg, var(--muted2) 0 4px, var(--disabled) 4px 7px)' } as CSSProperties}
              ></span>
              {shellStrings.capacity.legendEstimated}
            </span>
          </div>

          {spendToday && (
            <div className={styles.spendRow}>
              <Icon name="coin" size={13} weight={1.9} />
              <span className={styles.spendContent}>
                <span className={styles.spendText}>
                  {shellStrings.capacity.spendToday} <strong className={styles.spendValue}>{formatSpendUsd(spendToday.usd)}</strong> · {shellStrings.capacity.spendApiKeysOnly}
                </span>
                <span className={styles.spendLink}>{shellStrings.capacity.spendRunLedger}</span>
              </span>
            </div>
          )}

          {model.agents.map((group) => (
            <div key={group.agentId} className={styles.agentGroup}>
              <div className={styles.agentHeader}>
                <span
                  className={styles.agentTile}
                  style={{ '--tile-bg': group.tileBg, '--tile-fg': group.tileFg } as CSSProperties}
                >
                  {group.mono}
                </span>
                <span className={styles.agentName}>{group.displayName}</span>
                <span className={styles.usableText}>{group.usableText}</span>
              </div>
              {group.accounts.map((acct) => (
                <div
                  key={acct.accountId}
                  className={`${styles.accountRail} ${acct.stateKind === 'limited' ? styles.accountRailLimited : ''}`}
                >
                  <button
                    type="button"
                    onClick={() => toggleAccount(acct.accountId)}
                    aria-expanded={acct.expanded}
                    className={styles.accountButton}
                  >
                    <span className={styles.accountButtonRow}>
                      <span className={styles.accountBadge}>{acct.label}</span>
                      {acct.isPrimary && <Icon name="starFill" size={10} weight={1} className={styles.primaryDot ?? ''} />}
                      {acct.inUse && <span className={styles.inUseText}>{acct.inUseText}</span>}
                      <span
                        className={styles.statePill}
                        style={{ '--pill-fg': acct.pillColor } as CSSProperties}
                      >
                        {acct.stateLabel}
                      </span>
                      <span className={styles.chevronWrap} style={{ '--chevron': acct.chevron } as CSSProperties}>
                        <Icon name="chevDown" size={12} weight={2} />
                      </span>
                    </span>
                    <span className={styles.accountBarTrack}>
                      <span
                        className={styles.accountBarFill}
                        style={{ '--bar-w': acct.topPct ? `${acct.topPct}%` : '0%', '--bar-bg': barBg(acct) } as CSSProperties}
                      ></span>
                    </span>
                    <span className={styles.accountBinding}>
                      <span>{acct.bindingText}</span>
                      <span>{acct.resetText}</span>
                    </span>
                  </button>
                  {acct.expanded && (
                    <div className={styles.accountExpanded}>
                      {acct.windows.map((w) => (
                        <div key={w.key} className={styles.windowRow}>
                          <div className={styles.windowHeader}>
                            <span className={styles.windowLabel}>{w.label}</span>
                            <span className={styles.windowPct}>{w.pctText} · {w.resetText}</span>
                          </div>
                          <div className={styles.windowBarTrack}>
                            <div
                              className={styles.windowBarFill}
                              style={{ '--w': w.width, '--bg': w.bar } as CSSProperties}
                            />
                          </div>
                        </div>
                      ))}
                      <div className={styles.accountMeta}>
                        <span>{acct.emailMasked} · {acct.plan}</span>
                        <span>{acct.sourceText} · seen {acct.seenText}</span>
                        {acct.holding && <span className={styles.holdingText}>{acct.holding}</span>}
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
