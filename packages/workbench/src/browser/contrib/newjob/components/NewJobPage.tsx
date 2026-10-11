/**
 * The New job screen (route /jobs/new). Layout, copy and states follow
 * design/screens.md ("Start a job") and the NewJob artboards in the prototype.
 */
import { useId, useMemo, useState } from 'react';
import type { AgentChoice, AgentId, AgentInfo, JobMode, LimitPolicy } from '@orch/contracts';
import { Icon } from '../../../../../../../design/icons/Icon.js';
import type { IconName } from '../../../../../../../design/icons/icons.js';
import { useAccountsStore } from '../../../services/stores/accounts.js';
import { useQuotaStore } from '../../../services/stores/quota.js';
import { useWorkbenchStore } from '../../../services/workbenchStore.js';
import { useAutoPicks, startNewJob, useCliLine } from '../hooks/useNewJob.js';
import {
  AGENT_ORDER,
  PRESET_COMMAND_CHECKS,
  accountOptionSub,
  accountTone,
  autoOptionSub,
  buildJobSpec,
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
  startButtonLabel,
  GUARDRAIL_CHECKS,
} from '../newJobModel.js';
import { AutoloopPanel, ComparePanel, CouncilPanel } from '../modes/index.js';
import { newJobStrings } from '../strings.js';
import { effectiveValues, useNewJobDraft } from '../stores/newJobStore.js';
import styles from './NewJobPage.module.css';

/** Joins class names, skipping empty ones (CSS module lookups may be undefined). */
function cls(...names: ReadonlyArray<string | false | null | undefined>): string {
  return names.filter((name): name is string => typeof name === 'string' && name !== '').join(' ');
}

const MODE_CARDS: readonly { id: JobMode; icon: IconName }[] = [
  { id: 'single', icon: 'logo' },
  { id: 'compare', icon: 'layers' },
  { id: 'council', icon: 'users' },
  { id: 'autoloop', icon: 'sync' },
];

const LIMIT_CARDS: readonly { id: LimitPolicy; icon: IconName; copy: { label: string; desc: string } }[] = [
  { id: 'switch-account', icon: 'swap', copy: newJobStrings.limits.options.switch_account },
  { id: 'switch-agent', icon: 'robot', copy: newJobStrings.limits.options.switch_agent },
  { id: 'ask', icon: 'bell', copy: newJobStrings.limits.options.ask },
];

/** Agent badge: mono tile and its colour class (badge colours are for agent badges only). */
const AGENT_BADGE: Record<AgentId, { mono: string; className: string }> = {
  claude: { mono: 'CC', className: styles.badgeClaude ?? '' },
  codex: { mono: 'CX', className: styles.badgeCodex ?? '' },
  agy: { mono: 'AG', className: styles.badgeAgy ?? '' },
  gemini: { mono: 'GM', className: styles.badgeGemini ?? '' },
  opencode: { mono: 'OC', className: styles.badgeOpencode ?? '' },
};

function badgeOf(agent: AgentId): { mono: string; className: string } {
  return AGENT_BADGE[agent];
}

function isSameChoice(choice: AgentChoice | null, agent: AgentId, account: AgentChoice['account']): boolean {
  return choice !== null && choice.agent === agent && choice.account === account;
}

export function NewJobPage() {
  const accounts = useAccountsStore((s) => s.accounts);
  const agentInfos = useAccountsStore((s) => s.agents);
  const limits = useQuotaStore((s) => s.limits);
  const repoPath = useWorkbenchStore((s) => s.activeProject);
  const setActiveArea = useWorkbenchStore((s) => s.setActiveArea);
  const draft = useNewJobDraft();
  const [starting, setStarting] = useState(false);
  const [startError, setStartError] = useState<string | null>(null);
  const goalId = useId();

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
  const spec = useMemo(() => buildJobSpec(values, repoPath), [values, repoPath]);
  const cli = useCliLine(spec);
  const autoPicks = useAutoPicks(accounts);

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
  const startLabel = startButtonLabel(values.mode, pinned, values.compareAgents.length);
  const canStart = spec !== null && !starting;

  const onStart = async () => {
    if (spec === null) return;
    setStarting(true);
    setStartError(null);
    const outcome = await startNewJob(spec);
    setStarting(false);
    if (outcome.ok) {
      useNewJobDraft.getState().reset();
      setActiveArea('work');
      return;
    }
    setStartError(cls(outcome.error.message, outcome.error.fix));
  };

  const toggleWorker = (agent: AgentId) => {
    const next = values.workers.includes(agent)
      ? values.workers.filter((a) => a !== agent)
      : AGENT_ORDER.filter((a) => a === agent || values.workers.includes(a));
    useNewJobDraft.getState().setWorkers(next);
  };

  const guardrailText = (rule: 'no_new_suppressions' | 'protected_files') => newJobStrings.checks.guardrails[rule];
  const addablePresets = PRESET_COMMAND_CHECKS.filter((run) => !values.commandChecks.includes(run));

  return (
    <div className={styles.page}>
      <div className={styles.header}>
        <h1 className={styles.title}>{newJobStrings.title}</h1>
        <p className={styles.subtitle}>{newJobStrings.subtitle}</p>
      </div>

      <div className={styles.field}>
        <label htmlFor={goalId} className={styles.label}>
          {newJobStrings.goal.label}
        </label>
        <textarea
          id={goalId}
          rows={3}
          value={draft.goal}
          onChange={(e) => useNewJobDraft.getState().setGoal(e.target.value)}
          className={styles.goal}
        />
      </div>

      <section aria-labelledby="newjob-mode-h" className={styles.section}>
        <div className={styles.sectionHead}>
          <h2 id="newjob-mode-h" className={styles.sectionTitle}>{newJobStrings.modes.heading}</h2>
          <p className={styles.sectionIntro}>{newJobStrings.modes.intro}</p>
        </div>
        <div role="radiogroup" aria-label={newJobStrings.modes.groupLabel} className={styles.modeGrid}>
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
                className={cls(styles.modeCard, checked ? styles.selected : '', available ? '' : styles.unavailable)}
              >
                <span className={cls(styles.modeIcon, checked ? styles.modeIconOn : '')}>
                  <Icon name={icon} size={17} />
                </span>
                <span className={styles.modeText}>
                  <span className={styles.modeLabel}>{copy.label}</span>
                  <span className={styles.modeDesc}>{copy.desc}</span>
                  <span className={styles.modeBest}>{newJobStrings.modes.bestFor(copy.best)}</span>
                </span>
              </button>
            );
          })}
        </div>
      </section>

      {values.mode === 'single' ? (
        <>
          <section aria-labelledby="newjob-orch-h" className={styles.section}>
            <div className={styles.sectionHead}>
              <h2 id="newjob-orch-h" className={styles.sectionTitle}>{newJobStrings.orchestrator.heading}</h2>
              <p className={styles.sectionIntro}>{newJobStrings.orchestrator.intro}</p>
            </div>
            {agentsShown.map((agent) => {
              const badge = badgeOf(agent.id);
              const agentAccounts = accounts.filter((a) => a.agent === agent.id);
              const autoSub = autoOptionSub(autoPicks[agent.id], accountName);
              return (
                <div key={agent.id} className={styles.group}>
                  <div className={styles.groupName}>
                    <span className={cls(styles.badge, badge.className)}>{badge.mono}</span>
                    <span className={styles.groupText}>
                      <span className={styles.groupTitle}>{agent.displayName}</span>
                      <span className={styles.groupCmd}>{agent.command}</span>
                    </span>
                  </div>
                  <button
                    type="button"
                    aria-pressed={isSameChoice(values.orchestrator, agent.id, 'auto')}
                    onClick={() => useNewJobDraft.getState().pickOrchestrator({ agent: agent.id, account: 'auto' })}
                    className={cls(styles.option, isSameChoice(values.orchestrator, agent.id, 'auto') ? styles.selected : '')}
                  >
                    <span className={styles.optionTop}>
                      <Icon name="auto" size={12} className={cls(styles.optionIcon)} />
                      <span className={styles.optionTitle}>{newJobStrings.orchestrator.auto}</span>
                    </span>
                    <span className={styles.optionSub}>{autoSub}</span>
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
                        className={cls(styles.option, pressed ? styles.selected : '', signedOut ? styles.optionOff : '')}
                      >
                        <span className={styles.optionTop}>
                          <Icon name="pin" size={12} className={cls(styles.optionIcon)} />
                          <span className={styles.optionTitle}>{account.name}</span>
                          <span className={cls(styles.dot, toneClass(tone))} />
                        </span>
                        <span className={styles.optionSub}>
                          {accountOptionSub(account, limits[account.id]?.resetsAt)}
                        </span>
                      </button>
                    );
                  })}
                </div>
              );
            })}
            {warning ? (
              <div role="status" className={styles.warning}>
                <Icon name="alert" size={15} className={cls(styles.warningIcon)} />
                <span>{warning}</span>
              </div>
            ) : null}
          </section>

          <section aria-labelledby="newjob-work-h" className={styles.section}>
            <h2 id="newjob-work-h" className={styles.sectionTitle}>{newJobStrings.workers.heading}</h2>
            <div className={styles.workerGrid}>
              {agentsShown.map((agent) => {
                const badge = badgeOf(agent.id);
                const agentAccounts = accounts.filter((a) => a.agent === agent.id);
                const usable = agentAccounts.filter(isUsable).length;
                const checkboxId = `newjob-worker-${agent.id}`;
                return (
                  <div key={agent.id} className={styles.workerRow}>
                    <input
                      type="checkbox"
                      id={checkboxId}
                      checked={values.workers.includes(agent.id)}
                      onChange={() => toggleWorker(agent.id)}
                      className={styles.checkbox}
                    />
                    <span className={cls(styles.badgeSmall, badge.className)}>{badge.mono}</span>
                    <label htmlFor={checkboxId} className={styles.workerLabel}>
                      <span className={styles.workerName}>{agent.displayName}</span>
                      <span className={styles.workerSub}>
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

      {values.mode !== 'compare' ? (
        <section aria-labelledby="newjob-checks-h" className={styles.section}>
          <div className={styles.sectionHead}>
            <h2 id="newjob-checks-h" className={styles.sectionTitle}>{newJobStrings.checks.heading}</h2>
            <p className={styles.sectionIntro}>{newJobStrings.checks.intro}</p>
          </div>
          <div className={styles.checkList}>
            {GUARDRAIL_CHECKS.map((check) => {
              if (check.kind !== 'guardrail') return null;
              return (
                <div key={check.rule} className={styles.guardRow}>
                  <Icon name="lock" size={14} className={cls(styles.guardIcon)} />
                  <span className={styles.checkText}>{guardrailText(check.rule)}</span>
                  <span className={styles.guardTag}>{newJobStrings.checks.guardrailTag}</span>
                </div>
              );
            })}
            {values.commandChecks.map((run) => (
              <div key={run} className={styles.checkRow}>
                <Icon name="terminal" size={14} className={cls(styles.checkIcon)} />
                <span className={styles.checkCommand}>{run}</span>
                <span className={styles.checkKind}>{newJobStrings.checks.commandKind}</span>
                <button
                  type="button"
                  aria-label={newJobStrings.checks.remove(run)}
                  onClick={() => useNewJobDraft.getState().removeCommandCheck(run)}
                  className={styles.removeButton}
                >
                  <Icon name="close" size={11} weight={2.4} />
                </button>
              </div>
            ))}
            {addablePresets.length > 0 ? (
              <div className={styles.addRow}>
                <span className={styles.addLabel}>{newJobStrings.checks.add}</span>
                {addablePresets.map((run) => (
                  <button
                    key={run}
                    type="button"
                    onClick={() => useNewJobDraft.getState().addCommandCheck(run)}
                    className={styles.addButton}
                  >
                    <Icon name="plus" size={11} weight={2.4} />
                    {run}
                  </button>
                ))}
              </div>
            ) : null}
          </div>
        </section>
      ) : null}

      <section aria-labelledby="newjob-limit-h" className={styles.section}>
        <h2 id="newjob-limit-h" className={styles.sectionTitle}>{newJobStrings.limits.heading}</h2>
        <div className={styles.limitGrid}>
          {LIMIT_CARDS.map(({ id, icon, copy }) => {
            const pressed = values.onLimit === id;
            return (
              <button
                key={id}
                type="button"
                aria-pressed={pressed}
                onClick={() => useNewJobDraft.getState().setOnLimit(id)}
                className={cls(styles.limitCard, pressed ? styles.selected : '')}
              >
                <Icon name={icon} size={15} className={cls(styles.limitIcon)} />
                <span className={styles.limitText}>
                  <span className={styles.limitLabel}>{copy.label}</span>
                  <span className={styles.limitDesc}>{copy.desc}</span>
                </span>
              </button>
            );
          })}
        </div>
      </section>

      <div className={styles.footer}>
        <code className={styles.cli}>
          {cli.status === 'ready' ? cli.command : cli.status === 'failed' ? newJobStrings.errors.cliFailed : ''}
        </code>
        <button type="button" onClick={() => setActiveArea('work')} className={styles.cancel}>
          {newJobStrings.footer.cancel}
        </button>
        <button
          type="button"
          disabled={!canStart}
          onClick={() => void onStart()}
          className={styles.start}
        >
          <Icon name="playFill" size={13} />
          {startLabel}
        </button>
      </div>
      {startError ? (
        <div role="alert" className={styles.startError}>
          {startError}
        </div>
      ) : null}
    </div>
  );
}

function toneClass(tone: ReturnType<typeof accountTone>): string | undefined {
  switch (tone) {
    case 'ok':
      return styles.toneOk;
    case 'warn':
      return styles.toneWarn;
    case 'err':
      return styles.toneErr;
    case 'neutral':
      return styles.toneNeutral;
  }
}
