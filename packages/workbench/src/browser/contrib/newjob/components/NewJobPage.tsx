/**
 * The New spec screen (route /jobs/new). Layout, copy and states follow
 * ADR 0013, design/screens.md ("New spec") and the spec queue requirements.
 */
import { useEffect, useId, useMemo, useRef, useState } from 'react';
import type { AccountId, AgentChoice, AgentId, AgentInfo, Check, JobMode } from '@orchagents/contracts';
import { Icon } from '../../../../../../../design/icons/Icon.js';
import type { IconName } from '../../../../../../../design/icons/icons.js';
import { useAccountsStore } from '../../../services/stores/accounts.js';
import { useQuotaStore } from '../../../services/stores/quota.js';
import { useWorkbenchStore } from '../../../services/workbenchStore.js';
import { openSpecInQueue } from '../../specs/index.js';
import { useAutoPicks, useCliLine, addNewSpec, useRepoLoad } from '../hooks/useNewJob.js';
import {
  AGENT_ORDER,
  addableCheckPresets,
  checkFor,
  accountOptionSub,
  accountTone,
  autoOptionSub,
  buildSpecDraft,
  defaultCombine,
  defaultCompareAgents,
  defaultCouncilAgents,
  defaultCouncilRounds,
  defaultOrchestrator,
  defaultRoles,
  defaultWorkers,
  isModeEnabled,
  isUsable,
  orchestratorWarning,
  pinnedStatus,
  GUARDRAIL_CHECKS,
} from '../newJobModel.js';
import { AutoloopPanel, ComparePanel, CouncilPanel } from '../modes/index.js';
import { newJobStrings } from '../strings.js';
import { effectiveValues, useNewJobDraft } from '../stores/newJobStore.js';

/** Joins class names, skipping empty ones. */
function cls(...names: ReadonlyArray<string | false | null | undefined>): string {
  return names.filter((name): name is string => typeof name === 'string' && name !== '').join(' ');
}

const FOCUS_RING = 'focus-visible:outline-2 focus-visible:outline-focus focus-visible:outline-offset-2';
const BADGE_TILE = 'flex shrink-0 font-mono font-semibold items-center justify-center';

const MODE_CARDS: readonly { id: JobMode; icon: IconName }[] = [
  { id: 'single', icon: 'logo' },
  { id: 'compare', icon: 'layers' },
  { id: 'council', icon: 'users' },
  { id: 'autoloop', icon: 'sync' },
];

/** Agent badge: mono tile and its colour class (badge colours are for agent badges only). */
const AGENT_BADGE: Record<AgentId, { mono: string; className: string }> = {
  claude: { mono: 'CC', className: 'bg-cc-bg text-cc-fg' },
  codex: { mono: 'CX', className: 'bg-cx-bg text-cx-fg' },
  agy: { mono: 'AG', className: 'bg-ag-bg text-ag-fg' },
  gemini: { mono: 'GM', className: 'bg-gm-bg text-gm-fg' },
  opencode: { mono: 'OC', className: 'bg-oc-bg text-oc-fg' },
};

function badgeOf(agent: AgentId): { mono: string; className: string } {
  return AGENT_BADGE[agent];
}

function isSameChoice(choice: AgentChoice | null, agent: AgentId, account: AgentChoice['account']): boolean {
  return choice !== null && choice.agent === agent && choice.account === account;
}

const CHECK_ICON: Partial<Record<Check['kind'], IconName>> = { http: 'link', file_rule: 'file' };

export function NewJobPage() {
  const accounts = useAccountsStore((s) => s.accounts);
  const agentInfos = useAccountsStore((s) => s.agents);
  const limits = useQuotaStore((s) => s.limits);
  const repoPath = useWorkbenchStore((s) => s.activeProject);
  const setCapacityOpen = useWorkbenchStore((s) => s.setCapacityOpen);
  const draft = useNewJobDraft();
  const [starting, setStarting] = useState(false);
  const [startError, setStartError] = useState<string | null>(null);
  const demoGoalSeeded = useRef(false);
  const titleId = useId();
  const goalId = useId();
  const specSearchId = useId();
  const [specSearch, setSpecSearch] = useState('');

  useEffect(() => {
    if (!demoGoalSeeded.current) {
      demoGoalSeeded.current = true;
      if (window.orch?.app.demo) {
        setCapacityOpen(true);
        if (useNewJobDraft.getState().title === '' && useNewJobDraft.getState().goal === '') {
          useNewJobDraft.setState({
            title: 'Flaky integration tests in api-server',
            goal: 'Fix the flaky integration tests in api-server and add retries where the network is involved',
            mode: 'single',
            orchestratorPick: {
              agent: 'codex',
              account: 'codex-personal' as AccountId,
            },
            workersPick: ['claude', 'codex', 'agy'],
            commandChecks: ['npm test', 'npm run lint'],
            onLimit: 'switch-account',
            compareAgentsPick: ['claude', 'codex', 'gemini'],
            combinePick: true,
            councilAgentsPick: ['claude', 'codex', 'opencode'],
            councilRoundsPick: 5,
            rolesPick: { planner: 'claude', coder: 'codex', reviewer: 'gemini' },
          });
        }
      }
    }
  }, [accounts, setCapacityOpen]);

  const defaults = useMemo(
    () => ({
      orchestrator: defaultOrchestrator(accounts),
      workers: defaultWorkers(accounts),
      compareAgents: defaultCompareAgents(accounts),
      combine: defaultCombine(),
      councilAgents: defaultCouncilAgents(accounts),
      councilRounds: defaultCouncilRounds(),
      roles: defaultRoles(accounts),
    }),
    [accounts],
  );
  const values = useMemo(() => effectiveValues(draft, defaults), [draft, defaults]);
  const draftSpec = useMemo(() => buildSpecDraft(values), [values]);
  const cli = useCliLine(draftSpec);
  const autoPicks = useAutoPicks(accounts);
  const repoLoad = useRepoLoad(repoPath);
  const queueSpecs = repoLoad.queueSpecs;
  const shownQueueSpecs = useMemo(() => {
    const query = specSearch.trim().toLowerCase();
    if (query.length === 0) return queueSpecs;
    return queueSpecs.filter(
      (spec) => spec.id.includes(query) || spec.title.toLowerCase().includes(query),
    );
  }, [queueSpecs, specSearch]);

  const agentsShown = AGENT_ORDER.map((id) => agentInfos.find((a) => a.id === id)).filter(
    (a): a is AgentInfo => a !== undefined,
  );
  const agentName = (agent: AgentId): string => agentInfos.find((a) => a.id === agent)?.displayName ?? agent;
  const accountName = (accountId: string): string | null =>
    accounts.find((a) => a.id === accountId)?.name ?? null;

  const pinned = pinnedStatus(values.orchestrator, accounts, limits);
  const autoPick = values.orchestrator ? autoPicks[values.orchestrator.agent] : undefined;
  const autoFallback = autoPick?.kind === 'account' ? accountName(autoPick.accountId) : null;
  const warning = pinned && values.orchestrator
    ? orchestratorWarning(pinned, agentName(values.orchestrator.agent), autoFallback)
    : null;

  const canSubmit = draft.title.trim().length > 0 && draftSpec !== null && !starting && Boolean(repoPath);

  const onSubmit = async () => {
    if (!repoPath || draftSpec === null) return;
    setStarting(true);
    setStartError(null);
    const outcome = await addNewSpec(repoPath, draftSpec);
    setStarting(false);
    if (outcome.ok) {
      useNewJobDraft.getState().reset();
      openSpecInQueue(outcome.spec.id);
      return;
    }
    setStartError(cls(outcome.error.message, outcome.error.fix));
  };

  const onCancel = () => {
    useWorkbenchStore.getState().setActiveArea('specs');
    useWorkbenchStore.getState().setActiveRoute('/specs');
  };

  const toggleWorker = (agent: AgentId) => {
    const next = values.workers.includes(agent)
      ? values.workers.filter((a) => a !== agent)
      : AGENT_ORDER.filter((a) => a === agent || values.workers.includes(a));
    useNewJobDraft.getState().setWorkers(next);
  };

  const guardrailText = (rule: 'no_new_suppressions' | 'protected_files') => newJobStrings.checks.guardrails[rule];
  const addablePresets = addableCheckPresets(repoLoad.checkPresets, values.commandChecks);

  return (
    <div className="flex flex-auto min-h-0 in-data-[menu-side=right]:flex-row-reverse">
      <div className="flex flex-auto flex-col min-w-0 gap-22px px-9 pt-22px pb-10 max-w-[860px] text-text font-sans text-base max-[720px]:px-7 max-[720px]:pt-7 max-[720px]:pb-7">
        <div className="flex flex-col gap-3px">
          <h1 className="m-0 text-xl font-semibold">{newJobStrings.title}</h1>
          <p className="m-0 text-muted">{newJobStrings.subtitle}</p>
        </div>

        {/* 1. Title */}
        <div className="flex flex-col gap-2">
          <label htmlFor={titleId} className="font-semibold">
            {newJobStrings.titleField.label}
          </label>
          <input
            id={titleId}
            type="text"
            maxLength={120}
            value={draft.title}
            placeholder={newJobStrings.titleField.placeholder}
            onChange={(e) => useNewJobDraft.getState().setTitle(e.target.value)}
            className={`bg-panel border border-line rounded-lg text-text font-sans text-base py-3 px-4 leading-normal ${FOCUS_RING}`}
          />
        </div>

        {/* 2. What to do */}
        <div className="flex flex-col gap-2">
          <label htmlFor={goalId} className="font-semibold">
            {newJobStrings.goal.label}
          </label>
          <textarea
            id={goalId}
            rows={3}
            value={draft.goal}
            placeholder={newJobStrings.goal.placeholder}
            onChange={(e) => useNewJobDraft.getState().setGoal(e.target.value)}
            className={`bg-panel border border-line rounded-lg text-text font-sans text-base py-5 px-6 resize-y leading-normal ${FOCUS_RING}`}
          />
        </div>

        {/* 3. How should agents work on this? */}
        <section aria-labelledby="newjob-mode-h" className="flex flex-col gap-4">
          <div className="flex flex-col gap-2px">
            <h2 id="newjob-mode-h" className="m-0 text-md font-semibold">{newJobStrings.modes.heading}</h2>
            <p className="m-0 text-muted2 text-sm">{newJobStrings.modes.intro}</p>
          </div>
          <div role="radiogroup" aria-label={newJobStrings.modes.groupLabel} className="grid grid-cols-2 gap-3 max-[720px]:grid-cols-1">
            {MODE_CARDS.map(({ id, icon }) => {
              const copy = newJobStrings.modes[id];
              const checked = values.mode === id;
              const available = isModeEnabled(id);
              return (
                <button
                  key={id}
                  type="button"
                  role="radio"
                  aria-checked={checked}
                  aria-disabled={available ? undefined : true}
                  title={available ? undefined : newJobStrings.modes.comingLater}
                  onClick={() => {
                    if (available) useNewJobDraft.getState().selectMode(id);
                  }}
                  className={cls(
                    'flex gap-5 items-start px-6 py-5 min-h-[64px] rounded-11px text-text text-left',
                    checked ? 'border-2 border-accent bg-sel' : 'border border-line bg-panel',
                    available ? 'cursor-pointer' : 'cursor-not-allowed opacity-75',
                    FOCUS_RING,
                  )}
                >
                  <span
                    className={cls(
                      'flex shrink-0 basis-[34px] h-[34px] rounded-9px flex items-center justify-center',
                      checked ? 'bg-accent-solid text-on-accent' : 'bg-raised text-muted',
                    )}
                  >
                    <Icon name={icon} size={17} />
                  </span>
                  <span className="flex flex-col gap-3px min-w-0">
                    <span className="font-semibold text-13p5">{copy.label}</span>
                    <span className="text-muted text-sm">{copy.desc}</span>
                    <span className="text-faint text-11px">{newJobStrings.modes.bestFor(copy.best)}</span>
                  </span>
                </button>
              );
            })}
          </div>
        </section>

        {/* 4. Orchestrator / workers / mode panels */}
        {values.mode === 'single' ? (
          <>
            <section aria-labelledby="newjob-orch-h" className="flex flex-col gap-4">
              <div className="flex flex-col gap-2px">
                <h2 id="newjob-orch-h" className="m-0 text-md font-semibold">{newJobStrings.orchestrator.heading}</h2>
                <p className="m-0 text-muted2 text-sm">{newJobStrings.orchestrator.intro}</p>
              </div>
              {agentsShown.map((agent) => {
                const badge = badgeOf(agent.id);
                const agentAccounts = accounts.filter((a) => a.agent === agent.id);
                const autoSub = autoOptionSub(autoPicks[agent.id], accountName);
                return (
                  <div key={agent.id} className="flex flex-wrap items-stretch gap-3 p-4 border border-line rounded-xl bg-panel">
                    <div className="flex shrink-0 basis-[150px] items-center gap-4 px-1">
                      <span className={cls(BADGE_TILE, 'basis-[28px] h-[28px] rounded-7px text-10px', badge.className)}>{badge.mono}</span>
                      <span className="flex flex-col">
                        <span className="font-semibold">{agent.displayName}</span>
                        <span className="font-mono text-faint text-xs">{agent.command}</span>
                      </span>
                    </div>
                    <button
                      type="button"
                      aria-pressed={isSameChoice(values.orchestrator, agent.id, 'auto')}
                      onClick={() => useNewJobDraft.getState().pickOrchestrator({ agent: agent.id, account: 'auto' })}
                      className={cls(
                        'flex grow shrink basis-[160px] flex-col gap-3px min-h-[44px] rounded-md text-text text-left cursor-pointer',
                        isSameChoice(values.orchestrator, agent.id, 'auto')
                          ? 'border-2 border-accent bg-sel px-4 py-3'
                          : 'border border-line bg-card px-11px py-9px',
                        FOCUS_RING,
                      )}
                    >
                      <span className="flex items-center gap-3 w-full">
                        <Icon name="auto" size={12} className="text-muted" />
                        <span className="font-medium flex-auto">{newJobStrings.orchestrator.auto}</span>
                      </span>
                      <span className="text-muted2 text-11px">{autoSub}</span>
                    </button>
                    {agentAccounts.map((account) => {
                      const signedOut = account.state === 'signed_out';
                      const pressed = isSameChoice(values.orchestrator, agent.id, account.id);
                      const tone = accountTone(account.state);
                      return (
                        <button
                          key={account.id}
                          type="button"
                          disabled={signedOut}
                          aria-pressed={pressed}
                          onClick={() => useNewJobDraft.getState().pickOrchestrator({ agent: agent.id, account: account.id })}
                          className={cls(
                            'flex grow shrink basis-[160px] flex-col gap-3px min-h-[44px] rounded-md text-text text-left',
                            pressed
                              ? 'border-2 border-accent bg-sel px-4 py-3'
                              : 'border border-line bg-card px-11px py-9px',
                            signedOut ? 'cursor-not-allowed opacity-75' : 'cursor-pointer',
                            FOCUS_RING,
                          )}
                        >
                          <span className="flex items-center gap-3 w-full">
                            <Icon name="pin" size={12} className="text-muted" />
                            <span className="font-medium flex-auto">{account.name}</span>
                            <span className={cls('w-[7px] h-[7px] rounded-full', toneClass(tone))} />
                          </span>
                          <span className="text-muted2 text-11px">
                            {accountOptionSub(account, limits[account.id]?.resetsAt)}
                          </span>
                        </button>
                      );
                    })}
                  </div>
                );
              })}
              {warning ? (
                <div
                  role="status"
                  className="flex gap-4 items-start px-13px py-11px rounded-lg border border-warn-line bg-warn-bg2 text-warn-text text-sm"
                >
                  <Icon name="alert" size={15} className="shrink-0 basis-[15px] text-warn-solid" />
                  <span>{warning}</span>
                </div>
              ) : null}
            </section>

            <section aria-labelledby="newjob-work-h" className="flex flex-col gap-4">
              <h2 id="newjob-work-h" className="m-0 text-md font-semibold">{newJobStrings.workers.heading}</h2>
              <div className="grid grid-cols-2 gap-3 max-[720px]:grid-cols-1">
                {agentsShown.map((agent) => {
                  const badge = badgeOf(agent.id);
                  const agentAccounts = accounts.filter((a) => a.agent === agent.id);
                  const usable = agentAccounts.filter(isUsable).length;
                  const checkboxId = `newjob-worker-${agent.id}`;
                  return (
                    <div key={agent.id} className="flex items-center gap-4 px-5 py-4 border border-line rounded-lg bg-panel">
                      <input
                        type="checkbox"
                        id={checkboxId}
                        checked={values.workers.includes(agent.id)}
                        onChange={() => toggleWorker(agent.id)}
                        className={`w-[17px] h-[17px] accent-accent ${FOCUS_RING}`}
                      />
                      <span className={cls(BADGE_TILE, 'basis-[22px] h-[22px] rounded-sm text-8p5', badge.className)}>{badge.mono}</span>
                      <label htmlFor={checkboxId} className="flex-auto flex flex-col cursor-pointer">
                        <span className="font-medium">{agent.displayName}</span>
                        <span className="text-muted2 text-11px">
                          {newJobStrings.workers.usable(usable, agentAccounts.length)}
                        </span>
                      </label>
                    </div>
                  );
                })}
              </div>
            </section>
          </>
        ) : null}

        {values.mode === 'compare' ? (
          <ComparePanel
            agents={agentsShown}
            selectedAgents={values.compareAgents}
            combine={values.combine}
          />
        ) : null}

        {values.mode === 'council' ? (
          <CouncilPanel
            agents={agentsShown}
            selectedAgents={values.councilAgents}
            rounds={values.councilRounds}
          />
        ) : null}

        {values.mode === 'autoloop' ? (
          <AutoloopPanel agents={agentsShown} roles={values.roles} />
        ) : null}

        {/* 5. Done when */}
        <section aria-labelledby="newjob-checks-h" className="flex flex-col gap-4">
          <div className="flex flex-col gap-2px">
            <h2 id="newjob-checks-h" className="m-0 text-md font-semibold">{newJobStrings.checks.heading}</h2>
            <p className="m-0 text-muted2 text-sm">{newJobStrings.checks.helperText}</p>
          </div>
          <div className="flex flex-col border border-line rounded-lg bg-panel overflow-hidden">
            {GUARDRAIL_CHECKS.map((check) => {
              if (check.kind !== 'guardrail') return null;
              return (
                <div key={check.rule} className="flex items-center gap-4 px-5 py-9px border-b border-line2 bg-panel2">
                  <Icon name="lock" size={14} className="text-info-dot" />
                  <span className="flex-auto text-12p5">{guardrailText(check.rule)}</span>
                  <span className="text-info text-xs">{newJobStrings.checks.guardrailTag}</span>
                </div>
              );
            })}
            {values.commandChecks.map((run) => {
              const kind = checkFor(run).kind;
              return (
                <div key={run} className="flex items-center gap-4 px-5 py-9px border-b border-line2">
                  <Icon name={CHECK_ICON[kind] ?? 'terminal'} size={14} className="text-ok-dot" />
                  <span className="flex-auto text-12p5 font-mono">{run}</span>
                  {kind === 'http' ? (
                    <input
                      type="text"
                      className="w-[260px] px-3 py-1 rounded-md border border-line bg-bg text-text font-mono text-xs"
                      value={values.appAddress}
                      placeholder={newJobStrings.checks.appAddress}
                      aria-label={newJobStrings.checks.appAddressAria}
                      onChange={(event) => useNewJobDraft.getState().setAppAddress(event.target.value)}
                    />
                  ) : null}
                  <span className="text-muted2 text-xs">
                    {kind === 'http'
                      ? newJobStrings.checks.webKind
                      : kind === 'file_rule'
                        ? newJobStrings.checks.fileRuleKind
                        : newJobStrings.checks.commandKind}
                  </span>
                  <button
                    type="button"
                    aria-label={newJobStrings.checks.remove(run)}
                    onClick={() => useNewJobDraft.getState().removeCommandCheck(run)}
                    className={`flex items-center justify-center w-[32px] h-[32px] rounded-sm border-0 bg-transparent text-faint cursor-pointer ${FOCUS_RING}`}
                  >
                    <Icon name="close" size={11} weight={2.4} />
                  </button>
                </div>
              );
            })}
            {(values.auditLines ?? []).map((audit) => {
              const line = typeof audit === 'string' ? { id: audit, text: audit } : audit;
              return (
                <div key={line.id} className="flex items-center gap-4 px-5 py-9px border-b border-line2">
                  <Icon name="shield" size={14} className="text-ok-dot" />
                  <input
                    type="text"
                    className="flex-auto px-3 py-1 rounded-md border border-line bg-bg text-text font-sans text-xs focus-visible:outline-2 focus-visible:outline-focus focus-visible:outline-offset-2"
                    value={line.text}
                    placeholder={newJobStrings.checks.auditPlaceholder}
                    aria-label="Audit criterion text"
                    onChange={(e) => useNewJobDraft.getState().updateAuditLine(line.id, e.target.value)}
                  />
                  <span className="text-muted2 text-xs">{newJobStrings.checks.auditKind}</span>
                  <button
                    type="button"
                    aria-label={newJobStrings.checks.removeAudit}
                    onClick={() => useNewJobDraft.getState().removeAuditLine(line.id)}
                    className={`flex items-center justify-center w-[32px] h-[32px] rounded-sm border-0 bg-transparent text-faint cursor-pointer ${FOCUS_RING}`}
                  >
                    <Icon name="close" size={11} weight={2.4} />
                  </button>
                </div>
              );
            })}
            <div className="flex flex-wrap gap-2 items-center px-5 py-9px bg-panel2">
              <span className="text-muted2 text-sm">{newJobStrings.checks.add}</span>
              {addablePresets.map((run) => (
                <button
                  key={run}
                  type="button"
                  onClick={() => useNewJobDraft.getState().addCommandCheck(run)}
                  className={`flex items-center gap-5px px-4 py-5px min-h-[30px] rounded-pill border border-btnline bg-btn text-text text-sm cursor-pointer ${FOCUS_RING}`}
                >
                  <Icon name="plus" size={11} weight={2.4} />
                  {run}
                </button>
              ))}
              <button
                type="button"
                onClick={() => useNewJobDraft.getState().addAuditLine()}
                className={`flex items-center gap-5px px-4 py-5px min-h-[30px] rounded-pill border border-btnline bg-btn text-text text-sm cursor-pointer ${FOCUS_RING}`}
              >
                <Icon name="plus" size={11} weight={2.4} />
                {newJobStrings.checks.addAuditLine}
              </button>
            </div>
          </div>
        </section>

        {/* 5b. Starts after */}
        <div className="flex flex-col gap-2">
          <div className="flex flex-col gap-2px">
            <label htmlFor={specSearchId} className="font-semibold">
              {newJobStrings.startsAfter.label}
            </label>
            <p className="m-0 text-muted2 text-sm">{newJobStrings.startsAfter.helper}</p>
          </div>
          <div className="flex flex-col border border-line rounded-lg bg-panel overflow-hidden">
            <div className="px-5 py-4 border-b border-line2 bg-panel2">
              <input
                id={specSearchId}
                type="search"
                value={specSearch}
                placeholder={newJobStrings.startsAfter.search}
                aria-label={newJobStrings.startsAfter.search}
                onChange={(e) => setSpecSearch(e.target.value)}
                className={`w-full bg-bg border border-line rounded-md text-text font-sans text-sm py-2 px-3 leading-normal ${FOCUS_RING}`}
              />
            </div>
            {shownQueueSpecs.length === 0 ? (
              <p className="m-0 px-5 py-4 text-muted2 text-sm">{newJobStrings.startsAfter.empty}</p>
            ) : (
              shownQueueSpecs.map((spec) => {
                const checkboxId = `newspec-after-${spec.id}`;
                return (
                  <div
                    key={spec.id}
                    className="flex items-center gap-4 px-5 py-3 border-b border-line2 last:border-b-0"
                  >
                    <input
                      type="checkbox"
                      id={checkboxId}
                      checked={draft.dependsOn.includes(spec.id)}
                      onChange={() => useNewJobDraft.getState().toggleDependsOn(spec.id)}
                      className={`w-7 h-7 accent-accent ${FOCUS_RING}`}
                    />
                    <label htmlFor={checkboxId} className="flex-auto cursor-pointer text-12p5">
                      <span className="font-mono text-muted2">{spec.id}</span> · {spec.title}
                    </label>
                  </div>
                );
              })
            )}
          </div>
        </div>

        {/* 6. Checkbox "Run next" */}
        <div className="flex items-center gap-4 px-5 py-4 border border-line rounded-lg bg-panel">
          <input
            type="checkbox"
            id="newspec-run-next"
            checked={draft.runNext}
            onChange={(e) => useNewJobDraft.getState().setRunNext(e.target.checked)}
            className={`w-[17px] h-[17px] accent-accent ${FOCUS_RING}`}
          />
          <label htmlFor="newspec-run-next" className="flex flex-col cursor-pointer">
            <span className="font-medium">{newJobStrings.runNext.label}</span>
            <span className="text-muted2 text-xs">{newJobStrings.runNext.description}</span>
          </label>
        </div>

        {/* Footer */}
        <div className="flex flex-wrap items-center gap-4 p-5 border border-line rounded-xl bg-panel">
          <code className="grow shrink basis-[320px] min-w-0 font-mono text-xs text-text3 whitespace-pre-wrap break-words">
            {cli.status === 'ready' ? cli.command : cli.status === 'failed' ? newJobStrings.errors.cliFailed : ''}
          </code>
          <button
            type="button"
            onClick={onCancel}
            className={`px-6 py-3 min-h-[38px] rounded-md border border-line bg-transparent text-text text-base cursor-pointer ${FOCUS_RING}`}
          >
            {newJobStrings.footer.cancel}
          </button>
          <button
            type="button"
            disabled={!canSubmit}
            onClick={() => void onSubmit()}
            className={`flex items-center gap-7px px-15px py-3 min-h-[38px] rounded-md border-0 bg-accent-solid text-on-accent font-semibold text-base cursor-pointer disabled:bg-raised disabled:text-disabled disabled:cursor-not-allowed ${FOCUS_RING}`}
          >
            <Icon name="plus" size={13} />
            {newJobStrings.footer.addSpec}
          </button>
        </div>
        {startError ? (
          <div role="alert" className="px-5 py-4 rounded-lg border border-err-line bg-err-bg text-err text-sm">
            {startError}
          </div>
        ) : null}
      </div>
    </div>
  );
}

function toneClass(tone: ReturnType<typeof accountTone>): string {
  switch (tone) {
    case 'ok':
      return 'bg-ok-dot';
    case 'warn':
      return 'bg-warn-solid';
    case 'err':
      return 'bg-err-dot';
    case 'neutral':
      return 'bg-muted2';
  }
}
