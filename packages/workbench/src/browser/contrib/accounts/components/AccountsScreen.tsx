import { useEffect } from 'react';
import type { RoutingRule } from '@orchagents/contracts';
import { Icon } from '../../../../../../../design/icons/Icon.js';
import { useAccountsStore } from '../../../services/stores/accounts.js';
import { useQuotaStore } from '../../../services/stores/quota.js';
import { useWorkbenchStore } from '../../../services/workbenchStore.js';
import { accountsServices } from '../services.js';
import { accountsStrings as S, OS_NAME } from '../strings.js';
import { accountsForBackground, buildAgentSections, routingValue } from '../accountsView.js';
import { refreshAll, refreshConfig, runMachineCheck, setPrimary, setRouting, setShareSkills, setUse, openSignInFor } from '../actions.js';
import { useAccountsUiStore } from '../stores/accountsUi.js';
import { AgentSection } from './AgentSection.js';
import { AddAccountDialog } from './AddAccountDialog.js';
import { ConfigFileView } from './ConfigFileView.js';
import styles from './AccountsScreen.module.css';

export function AccountsScreen() {
  const services = accountsServices();
  const accounts = useAccountsStore((s) => s.accounts);
  const agents = useAccountsStore((s) => s.agents);
  const windows = useQuotaStore((s) => s.windows);
  const limits = useQuotaStore((s) => s.limits);
  const view = useAccountsUiStore((s) => s.view);
  const os = useAccountsUiStore((s) => s.os);
  const file = useAccountsUiStore((s) => s.file);
  const report = useAccountsUiStore((s) => s.machineReport);
  const running = useAccountsUiStore((s) => s.machineRunning);
  const notice = useAccountsUiStore((s) => s.notice);
  const setView = useAccountsUiStore((s) => s.setView);
  const resetAdd = useAccountsUiStore((s) => s.resetAdd);
  const addDraft = useAccountsUiStore((s) => s.add);
  const toggleCapacity = useWorkbenchStore((s) => s.toggleCapacity);
  const capacityOpen = useWorkbenchStore((s) => s.capacityOpen);

  useEffect(() => {
    if (services) void refreshAll(services);
  }, [services]);

  // Accounts change on every core event for them, and the file follows them.
  useEffect(() => {
    if (services) void refreshConfig(services);
  }, [services, accounts]);

  const visibleAccounts = accountsForBackground(accounts, addDraft.open ? addDraft.account?.id ?? null : null);
  const sections = os
    ? buildAgentSections({ agents, accounts: visibleAccounts, windows, limits, file, os })
    : [];
  const routing = routingValue(file);
  const checkAllPassed = report ? report.checks.every((c) => c.status === 'pass') : false;
  const firstFix = report ? report.checks.find((c) => c.status !== 'pass')?.fix : undefined;

  const routingOptions: readonly { id: RoutingRule; label: string; desc: string; icon: 'starFill' | 'layers' }[] = [
    { id: 'primary-first', label: S.routing.primary.label, desc: S.routing.primary.desc, icon: 'starFill' },
    { id: 'most-headroom', label: S.routing.headroom.label, desc: S.routing.headroom.desc, icon: 'layers' },
  ];

  const openAdd = () => resetAdd(true);

  return (
    <div className={styles.screen}>
      <header className={styles.header}>
        <div className={styles.titleRow}>
          <h1 className={styles.title}>{S.title}</h1>
          <div role="group" aria-label={S.viewGroupLabel} className={styles.segment}>
            <button
              type="button"
              className={styles.segmentButton}
              aria-pressed={view === 'visual'}
              onClick={() => setView('visual')}
            >
              <Icon name="layout" size={13} />
              {S.viewVisual}
            </button>
            <button
              type="button"
              className={styles.segmentButton}
              aria-pressed={view === 'config'}
              onClick={() => setView('config')}
            >
              <Icon name="file" size={13} />
              {S.viewConfig}
            </button>
          </div>
          <button type="button" className={styles.primaryButton} onClick={openAdd} disabled={!services}>
            <Icon name="plus" size={13} />
            {S.addAccount}
          </button>
        </div>
        <p className={styles.intro}>{S.intro}</p>
      </header>

      <div className={styles.machineBar}>
        {os ? (
          <span className={styles.osPill}>
            <Icon name="monitor" size={13} />
            {S.machine.thisMachine(OS_NAME[os])}
          </span>
        ) : null}
        <span className={styles.machineText}>
          {running ? S.machine.checking : report ? (checkAllPassed ? report.orchVersion === 'demo' ? S.machine.checkedDemo : S.machine.checkedNow : firstFix ?? '') : ''}
        </span>
        <button
          type="button"
          className={styles.button}
          disabled={!services || running}
          onClick={() => services && void runMachineCheck(services)}
        >
          <Icon name="shield" size={12} />
          {S.machine.runCheck}
        </button>
      </div>

      {notice ? (
        <div className={styles.notice} role="alert">
          <Icon name="alert" size={14} />
          <span>{notice.message}{notice.fix ? ` ${notice.fix}` : ''}</span>
        </div>
      ) : null}

      {view === 'config' ? (
        <ConfigFileView services={services} />
      ) : (
        <div className={styles.stack}>
          <section aria-labelledby="accounts-routing-title" className={styles.section}>
            <h2 id="accounts-routing-title" className={styles.sectionTitle}>
              {S.routing.title}
            </h2>
            <div className={styles.routingGrid}>
              {routingOptions.map((option) => (
                <button
                  key={option.id}
                  type="button"
                  className={styles.strategy}
                  aria-pressed={routing === option.id}
                  disabled={!services}
                  onClick={() => services && void setRouting(services, option.id)}
                >
                  <Icon name={option.icon} size={14} className={option.id === 'primary-first' ? styles.routingStar ?? '' : ''} />
                  <span className={styles.strategyText}>
                    <span className={styles.strategyLabel}>{option.label}</span>
                    <span className={styles.strategyDesc}>{option.desc}</span>
                  </span>
                </button>
              ))}
            </div>
          </section>

          {sections.map((section) => (
            <AgentSection
              key={section.id}
              section={section}
              services={services}
              onUse={(id, use) => services && void setUse(services, id, use)}
              onPrimary={(id) => services && void setPrimary(services, id)}
              onSignIn={(id) => {
                const account = accounts.find((a) => a.id === id);
                if (account) openSignInFor(account);
              }}
              onShareSkills={(agent, share) => services && void setShareSkills(services, agent, share)}
              onUsage={() => {
                if (!capacityOpen) toggleCapacity();
              }}
              onAdd={openAdd}
            />
          ))}
        </div>
      )}

      <AddAccountDialog services={services} />
    </div>
  );
}
