import type { Session } from '@orchagents/contracts';
import { Icon } from '../../../../../../../design/icons/Icon.js';
import { useAccountsStore } from '../../../services/stores/accounts.js';
import { useJobsStore } from '../../../services/stores/work.js';
import { useSessionsStore } from '../../../services/stores/sessions.js';
import { useWorkbenchStore } from '../../../services/workbenchStore.js';
import { sessionsServices } from '../services.js';
import { resumeSession } from '../actions.js';
import { useSessionsUiStore } from '../stores/sessionsUi.js';
import { useResumeOptions } from '../hooks/useResumeOptions.js';
import {
  buildResumeRequest,
  cliLine,
  effectiveResumeMode,
  filterCounts,
  filterOptions,
  filterSessions,
  isLive,
  resolveSelection,
  resumeButtonLabel,
  resumeRows,
  sessionDetails,
  sessionListRow,
  type ToneName,
} from '../model/sessionsView.js';
import { sessionsStrings as S } from '../strings.js';
import styles from './SessionsScreen.module.css';
import { cx } from './cx.js';

const PILL_TONE: Record<ToneName, string | undefined> = {
  info: styles.pillInfo,
  warn: styles.pillWarn,
  err: styles.pillErr,
  neutral: styles.pillNeutral,
};

const DOT_TONE: Record<ToneName, string | undefined> = {
  info: styles.dotInfo,
  warn: styles.dotWarn,
  err: styles.dotErr,
  neutral: styles.dotNeutral,
};

const NOTE_TONE: Record<ToneName, string | undefined> = {
  info: styles.noteInfo,
  warn: styles.noteWarn,
  err: styles.noteErr,
  neutral: styles.noteInfo,
};

const AGENT_TONE: Record<'cc' | 'cx' | 'gm' | 'oc' | 'ag', string | undefined> = {
  cc: styles.agentCc,
  cx: styles.agentCx,
  gm: styles.agentGm,
  oc: styles.agentOc,
  ag: styles.agentAg,
};

function StatusPill({ tone, label }: { tone: ToneName; label: string }) {
  return (
    <span className={cx(styles.pill, PILL_TONE[tone])}>
      <span className={cx(styles.dot, DOT_TONE[tone])} aria-hidden="true" />
      {label}
    </span>
  );
}

export function SessionsScreen() {
  const services = sessionsServices();
  const sessions = useSessionsStore((s) => s.sessions);
  const jobs = useJobsStore((s) => s.jobs);
  const agents = useAccountsStore((s) => s.agents);
  const accounts = useAccountsStore((s) => s.accounts);
  const filter = useSessionsUiStore((s) => s.filter);
  const selectedId = useSessionsUiStore((s) => s.selectedId);
  const chosenMode = useSessionsUiStore((s) => s.chosenMode);
  const resuming = useSessionsUiStore((s) => s.resuming);
  const error = useSessionsUiStore((s) => s.error);
  const setFilter = useSessionsUiStore((s) => s.setFilter);
  const select = useSessionsUiStore((s) => s.select);
  const chooseMode = useSessionsUiStore((s) => s.chooseMode);
  const setActiveArea = useWorkbenchStore((s) => s.setActiveArea);

  const now = new Date();
  const counts = filterCounts(sessions);
  const filtered = filterSessions(sessions, filter);
  const selected: Session | null = resolveSelection(filtered, selectedId);
  const options = useResumeOptions(selected);

  const jobTitle = (session: Session): string => jobs.find((j) => j.id === session.jobId)?.title ?? '';
  const selectedOptionMode = selected && !isLive(selected) ? effectiveResumeMode(options, chosenMode) : null;
  const selectedOption = options.find((o) => o.mode === selectedOptionMode);
  const rows = resumeRows(options, selectedOptionMode);
  const request = selected ? buildResumeRequest(selected.id, selectedOptionMode, selectedOption) : null;
  const details = selected ? sessionDetails(selected, { jobTitle: jobTitle(selected), agents, accounts, now }) : null;

  const onResume = () => {
    if (!services || !request) return;
    void resumeSession(services, request);
  };

  return (
    <div className={styles.screen}>
      <div className={styles.header}>
        <div className={styles.headerText}>
          <h1 className={styles.title}>{S.title}</h1>
          <p className={styles.intro}>{S.intro}</p>
        </div>
        <div role="group" aria-label={S.filter.group} className={styles.segment}>
          {filterOptions(counts, filter).map((f) => (
            <button
              key={f.id}
              type="button"
              className={styles.segmentButton}
              aria-pressed={f.pressed}
              onClick={() => setFilter(f.id)}
            >
              {f.label}
            </button>
          ))}
        </div>
      </div>

      <div className={styles.body}>
        <section aria-label={S.list.label} className={styles.list}>
          {filtered.map((session) => {
            const row = sessionListRow(session, { jobTitle: jobTitle(session), agents, accounts, now });
            const on = selected?.id === session.id;
            return (
              <button
                key={session.id}
                type="button"
                className={cx(styles.row, on && styles.rowSelected)}
                aria-pressed={on}
                onClick={() => select(session.id)}
              >
                <span className={cx(styles.agentTile, AGENT_TONE[row.badge.tone])}>{row.badge.mono}</span>
                <span className={styles.rowText}>
                  <span className={styles.rowTitle}>{row.title}</span>
                  <span className={styles.rowMeta}>
                    {row.jobTitle} · {row.agentName} · {row.accountName}
                  </span>
                </span>
                <span className={styles.rowRight}>
                  <StatusPill tone={row.status.tone} label={row.status.label} />
                  <span className={styles.rowTime}>{row.last}</span>
                </span>
              </button>
            );
          })}
        </section>

        {selected && details && (
          <section aria-label={S.details.label} className={styles.details}>
            <div className={styles.detailsHead}>
              <span className={cx(styles.agentTileLarge, AGENT_TONE[details.badge.tone])}>{details.badge.mono}</span>
              <div className={styles.detailsTitleBlock}>
                <h2 className={styles.detailsTitle}>{details.title}</h2>
                <span className={styles.idLine}>{details.idLine}</span>
              </div>
              <StatusPill tone={details.status.tone} label={details.status.label} />
            </div>

            <dl className={styles.facts}>
              {details.facts.map((fact) => (
                <div key={fact.key} className={styles.fact}>
                  <dt className={styles.factKey}>{fact.key}</dt>
                  <dd className={styles.factValue}>{fact.value}</dd>
                </div>
              ))}
            </dl>

            {details.note && <div className={cx(styles.note, NOTE_TONE[details.note.tone])}>{details.note.text}</div>}

            {details.isLive && (
              <div className={styles.actionRow}>
                <button type="button" className={styles.primary} onClick={() => setActiveArea('work')}>
                  <Icon name="terminal" size={14} />
                  {S.details.openInWorkspace}
                </button>
              </div>
            )}

            {!details.isLive && (
              <div className={styles.resume}>
                <h3 className={styles.resumeTitle}>{S.details.resume}</h3>
                <div role="radiogroup" aria-label={S.details.resumeOptions} className={styles.options}>
                  {rows.map((row) => (
                    <button
                      key={row.mode}
                      type="button"
                      role="radio"
                      aria-checked={row.checked}
                      disabled={!row.available}
                      className={cx(styles.option, row.checked && styles.optionChecked, !row.available && styles.optionOff)}
                      onClick={() => chooseMode(row.mode)}
                    >
                      <span className={cx(styles.optionIcon, row.checked && styles.optionIconChecked)}>
                        <Icon name={row.icon} size={14} />
                      </span>
                      <span className={styles.optionText}>
                        <span className={styles.optionTitle}>{row.title}</span>
                        <span className={styles.optionDesc}>{row.description}</span>
                      </span>
                    </button>
                  ))}
                </div>
                <div className={styles.cliRow}>
                  <code className={styles.cli}>{cliLine(selected.id, selectedOptionMode, selectedOption, accounts)}</code>
                  <button
                    type="button"
                    className={styles.primary}
                    disabled={!services || !request || resuming}
                    onClick={onResume}
                  >
                    <Icon name="playFill" size={13} />
                    {resumeButtonLabel(selectedOptionMode, selectedOption, { agents, accounts })}
                  </button>
                </div>
                {error && (
                  <p role="alert" className={styles.error}>
                    {error.message} {error.fix}
                  </p>
                )}
              </div>
            )}
          </section>
        )}
      </div>
    </div>
  );
}
