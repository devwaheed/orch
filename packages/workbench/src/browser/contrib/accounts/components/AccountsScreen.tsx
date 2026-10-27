import { useEffect } from 'react';
import type { RoutingRule } from '@orchagents/contracts';
import { Icon } from '../../../../../../../design/icons/Icon.js';
import { useAccountsStore } from '../../../services/stores/accounts.js';
import { useQuotaStore } from '../../../services/stores/quota.js';
import { useWorkbenchStore } from '../../../services/workbenchStore.js';
import { accountsServices } from '../services.js';
import { accountsStrings as S, OS_NAME } from '../strings.js';
import { accountsForBackground, buildAgentSections, routingValue } from '../accountsView.js';
import { refreshAll, refreshConfig, removeAccount, runMachineCheck, setPrimary, setRouting, setShareSkills, setUse, openAddFor, openSignInFor } from '../actions.js';
import { useAccountsUiStore } from '../stores/accountsUi.js';
import { AgentSection } from './AgentSection.js';
import { AddAccountDialog } from './AddAccountDialog.js';
import { RemoveAccountDialog } from './RemoveAccountDialog.js';
import { ConfigFileView } from './ConfigFileView.js';

const SEGMENT_BUTTON =
  'flex items-center gap-2 min-h-[30px] px-11px py-2 border-0 rounded-sm bg-transparent text-sm text-muted cursor-pointer aria-pressed:bg-seg aria-pressed:text-text';
const PRIMARY_BUTTON =
  'flex items-center gap-2 min-h-[36px] px-13px py-3 border-0 rounded-md bg-accent-solid text-base font-semibold text-on-accent cursor-pointer disabled:cursor-default disabled:opacity-45';
const MACHINE_BUTTON =
  'flex items-center gap-2 min-h-[32px] px-4 py-2 border border-btnline rounded-md bg-btn text-sm text-text cursor-pointer disabled:cursor-default disabled:opacity-45';
const STRATEGY =
  'flex items-start gap-4 min-h-[44px] px-5 py-11px border border-line rounded-lg bg-panel text-sm text-text text-left cursor-pointer [&>svg]:fill-none [&>svg]:stroke-current aria-pressed:border-2 aria-pressed:border-accent aria-pressed:bg-sel';

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
  const removing = useAccountsUiStore((s) => s.removing);
  const setRemoving = useAccountsUiStore((s) => s.setRemoving);
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
    <div className="flex flex-col gap-8 px-9 pt-22px pb-10 text-sm text-text font-sans">
      <header className="flex flex-col gap-3px">
        <div className="flex flex-wrap items-center gap-5">
          <h1 className="m-0 flex-auto text-xl font-semibold">{S.title}</h1>
          <div role="group" aria-label={S.viewGroupLabel} className="flex p-3px rounded-9px border border-line bg-panel2">
            <button
              type="button"
              className={SEGMENT_BUTTON}
              aria-pressed={view === 'visual'}
              onClick={() => setView('visual')}
            >
              <Icon name="layout" size={13} />
              {S.viewVisual}
            </button>
            <button
              type="button"
              className={SEGMENT_BUTTON}
              aria-pressed={view === 'config'}
              onClick={() => setView('config')}
            >
              <Icon name="file" size={13} />
              {S.viewConfig}
            </button>
          </div>
          <button type="button" className={PRIMARY_BUTTON} onClick={openAdd} disabled={!services}>
            <Icon name="plus" size={13} />
            {S.addAccount}
          </button>
        </div>
        <p className="m-0 text-muted">{S.intro}</p>
      </header>

      <div className="flex flex-wrap items-center gap-5 px-6 py-5 border border-line rounded-xl bg-panel">
        {os ? (
          <span className="inline-flex items-center gap-3 px-4 py-1 rounded-pill bg-neutral text-sm font-medium text-text">
            <Icon name="monitor" size={13} />
            {S.machine.thisMachine(OS_NAME[os])}
          </span>
        ) : null}
        <span className="flex-[1_1_320px] text-sm text-muted">
          {running ? S.machine.checking : report ? (checkAllPassed ? report.orchVersion === 'demo' ? S.machine.checkedDemo : S.machine.checkedNow : firstFix ?? '') : ''}
        </span>
        <button
          type="button"
          className={MACHINE_BUTTON}
          disabled={!services || running}
          onClick={() => services && void runMachineCheck(services)}
        >
          <Icon name="shield" size={12} />
          {S.machine.runCheck}
        </button>
      </div>

      {notice ? (
        <div className="flex items-start gap-4 px-5 py-4 rounded-lg border border-warn-line bg-warn-bg2 text-sm text-warn-text" role="alert">
          <Icon name="alert" size={14} />
          <span>{notice.message}{notice.fix ? ` ${notice.fix}` : ''}</span>
        </div>
      ) : null}

      {view === 'config' ? (
        <ConfigFileView services={services} />
      ) : (
        <div className="flex flex-col gap-8">
          <section aria-labelledby="accounts-routing-title" className="flex flex-col gap-4">
            <h2 id="accounts-routing-title" className="m-0 text-md font-semibold">
              {S.routing.title}
            </h2>
            <div className="grid max-w-[760px] grid-cols-2 gap-3">
              {routingOptions.map((option) => (
                <button
                  key={option.id}
                  type="button"
                  className={STRATEGY}
                  aria-pressed={routing === option.id}
                  disabled={!services}
                  onClick={() => services && void setRouting(services, option.id)}
                >
                  <Icon name={option.icon} size={14} />
                  <span className="flex flex-col gap-2px">
                    <span className="font-medium">{option.label}</span>
                    <span className="text-xs text-muted2">{option.desc}</span>
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
              onAdd={(agent) => openAddFor(agent, accounts)}
              onRemove={(id) => {
                const account = accounts.find((candidate) => candidate.id === id);
                if (account) setRemoving(account);
              }}
            />
          ))}
        </div>
      )}

      <AddAccountDialog services={services} />
      <RemoveAccountDialog
        account={removing}
        agentName={agents.find((agent) => agent.id === removing?.agent)?.displayName ?? removing?.agent ?? ''}
        onCancel={() => setRemoving(null)}
        onConfirm={() => services && removing && void removeAccount(services, removing.id)}
      />
    </div>
  );
}
