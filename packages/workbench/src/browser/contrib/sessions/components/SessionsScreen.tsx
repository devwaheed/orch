import type { RunLine, Session } from '@orchagents/contracts';
import { useEffect } from 'react';
import { Icon } from '../../../../../../../design/icons/Icon.js';
import { useAccountsStore } from '../../../services/stores/accounts.js';
import { useJobsStore } from '../../../services/stores/work.js';
import { useSessionsStore } from '../../../services/stores/sessions.js';
import { useRunsStore } from '../../../services/stores/work.js';
import { openSpecsLive } from '../../specs/index.js';
import { openJobRun } from '../../work/index.js';
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
import { cx } from './cx.js';

const PILL_TONE: Record<ToneName, string | undefined> = {
  info: 'bg-info-bg text-info',
  warn: 'bg-warn-bg text-warn',
  err: 'bg-err-bg text-err',
  neutral: 'bg-neutral text-text3',
};

const DOT_TONE: Record<ToneName, string | undefined> = {
  info: 'bg-info-dot',
  warn: 'bg-warn-solid',
  err: 'bg-err-dot',
  neutral: 'bg-faint',
};

const NOTE_TONE: Record<ToneName, string | undefined> = {
  info: 'bg-info-bg text-info-strong',
  warn: 'bg-warn-bg2 text-warn-text',
  err: 'bg-err-bg text-err-strong',
  neutral: 'bg-info-bg text-info-strong',
};

const AGENT_TONE: Record<'cc' | 'cx' | 'gm' | 'oc' | 'ag', string | undefined> = {
  cc: 'bg-cc-bg text-cc-fg',
  cx: 'bg-cx-bg text-cx-fg',
  gm: 'bg-gm-bg text-gm-fg',
  oc: 'bg-oc-bg text-oc-fg',
  ag: 'bg-ag-bg text-ag-fg',
};

const EMPTY_ACTIVITY: readonly RunLine[] = [];
const ACTIVITY_KIND_CLASS: Partial<Record<RunLine['kind'], string | undefined>> = {
  diff_add: 'text-ok',
  ok: 'text-ok',
  diff_del: 'text-err',
  err: 'text-err',
  limit: 'text-warn',
  spawn: 'text-spawn',
};
const DEMO_ORPHANED_ACTIVITY = [
  { kind: 'tool', text: 'Bash npm test -- --repeat 20' },
  { kind: 'err', text: '3 of 20 runs failed: ECONNRESET in callback retry' },
  { kind: 'message', text: 'Adding exponential backoff around the token exchange…' },
] as const;
const DEMO_MERGED_ACTIVITY = [
  { kind: 'tool', text: 'Edit package.json (engines.node → 22)' },
  { kind: 'ok', text: 'All 212 tests passed' },
  { kind: 'message', text: 'Upgrade complete. Merged after your approval.' },
] as const;

function activityFor(session: Session, lines: readonly RunLine[], demo: boolean) {
  if (demo && session.id === 's-2d18') return DEMO_ORPHANED_ACTIVITY;
  if (demo && session.id === 's-e57a') return DEMO_MERGED_ACTIVITY;
  return lines.filter((line) => line.kind !== 'meta').slice(-3);
}

function activityGlyph(kind: RunLine['kind']): string {
  if (kind === 'tool') return '⏺';
  if (kind === 'ok') return '✓';
  if (kind === 'err') return '✗';
  if (kind === 'limit') return '!';
  if (kind === 'spawn') return '↳';
  return ' ';
}

function StatusPill({ tone, label }: { tone: ToneName; label: string }) {
  return (
    <span className={cx('inline-flex items-center gap-5px px-3 py-2px rounded-pill text-11px whitespace-nowrap', PILL_TONE[tone])}>
      <span className={cx('shrink-0 w-[6px] h-[6px] rounded-pill', DOT_TONE[tone])} aria-hidden="true" />
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

  const demo = window.orch?.app.demo === true;
  const now = demo ? new Date(Date.UTC(2026, 9, 11, 12, 50)) : new Date();
  const counts = filterCounts(sessions);
  const filtered = filterSessions(sessions, filter);
  const selected: Session | null = resolveSelection(filtered, selectedId);
  const selectedRunLines = useRunsStore((state) => selected?.runId ? state.lines[selected.runId] ?? EMPTY_ACTIVITY : EMPTY_ACTIVITY);
  useEffect(() => {
    const runId = selected?.runId;
    if (!services || !runId) return undefined;
    let cancelled = false;
    const known = useRunsStore.getState().lines[runId] ?? EMPTY_ACTIVITY;
    const afterSeq = known.reduce((max, line) => Math.max(max, line.seq), -1);
    void services.runs.lines(runId, afterSeq).then((result) => {
      if (cancelled || !result.ok) return;
      for (const line of result.value) useRunsStore.getState().appendLine(line);
    });
    return () => { cancelled = true; };
  }, [services, selected?.runId]);
  const options = useResumeOptions(selected);

  const jobTitle = (session: Session): string => jobs.find((j) => j.id === session.jobId)?.title ?? '';
  const selectedOptionMode = selected && !isLive(selected) ? effectiveResumeMode(options, chosenMode) : null;
  const selectedOption = options.find((o) => o.mode === selectedOptionMode);
  const rows = resumeRows(options, selectedOptionMode);
  const request = selected ? buildResumeRequest(selected.id, selectedOptionMode, selectedOption) : null;
  const details = selected ? sessionDetails(selected, { jobTitle: jobTitle(selected), agents, accounts, now, useUtcTime: demo }) : null;
  const activity = selected ? activityFor(selected, selectedRunLines, demo) : EMPTY_ACTIVITY;

  const onResume = () => {
    if (!services || !request) return;
    void resumeSession(services, request);
  };

  return (
    <div className="flex flex-col gap-7 px-9 pt-22px pb-10 text-text font-sans text-base">
      <div className="flex flex-wrap items-end gap-6">
        <div className="flex flex-[1_1_320px] flex-col gap-1">
          <h1 className="m-0 text-xl font-semibold">{S.title}</h1>
          <p className="m-0 text-muted">{S.intro}</p>
        </div>
        <div role="group" aria-label={S.filter.group} className="flex p-3px rounded-9px bg-panel2 border border-line">
          {filterOptions(counts, filter).map((f) => (
            <button
              key={f.id}
              type="button"
              className={cx(
                'min-h-[30px] px-5 py-2 border-none rounded-sm text-sm cursor-pointer focus-visible:outline-2 focus-visible:outline-focus focus-visible:outline-offset-2',
                f.pressed ? 'bg-seg text-text' : 'bg-transparent text-muted'
              )}
              aria-pressed={f.pressed}
              onClick={() => setFilter(f.id)}
            >
              {f.label}
            </button>
          ))}
        </div>
      </div>

      <div className="flex flex-wrap items-start gap-7">
        <section aria-label={S.list.label} className="flex flex-[1_1_420px] min-w-0 flex-col overflow-hidden border border-line rounded-xl bg-panel">
          {filtered.map((session) => {
            const row = sessionListRow(session, { jobTitle: jobTitle(session), agents, accounts, now, useUtcTime: demo });
            const on = selected?.id === session.id;
            return (
              <button
                key={session.id}
                type="button"
                className={cx(
                  'flex items-center gap-5 w-full min-h-[60px] px-6 py-5 border-0 border-b border-solid border-b-line2 text-base font-regular text-text text-left cursor-pointer focus-visible:outline-2 focus-visible:outline-focus focus-visible:outline-offset-2',
                  on ? 'bg-rowsel shadow-[inset_2px_0_0_var(--accent)]' : 'bg-transparent shadow-none'
                )}
                aria-pressed={on}
                onClick={() => select(session.id)}
              >
                <span className={cx('flex shrink-0 items-center justify-center w-10 h-10 rounded-7px font-mono text-10px font-semibold', AGENT_TONE[row.badge.tone])}>{row.badge.mono}</span>
                <span className="flex flex-[1_1_auto] min-w-0 flex-col gap-2px">
                  <span className="overflow-hidden text-ellipsis whitespace-nowrap font-medium">{row.title}</span>
                  <span className="overflow-hidden text-ellipsis whitespace-nowrap text-muted2 text-11px">
                    {row.jobTitle} · {row.agentName} · {row.accountName}
                  </span>
                </span>
                <span className="flex flex-col items-end gap-1">
                  <StatusPill tone={row.status.tone} label={row.status.label} />
                  <span className="text-faint font-mono text-11px whitespace-nowrap">{row.last}</span>
                </span>
              </button>
            );
          })}
        </section>

        {selected && details && (
          <section aria-label={S.details.label} className="flex flex-[1_1_400px] min-w-0 flex-col border border-line rounded-xl bg-panel">
            <div className="flex items-center gap-5 p-7 border-b border-line2">
              <span className={cx('flex shrink-0 items-center justify-center w-[calc(var(--space-10)+var(--space-3))] h-[calc(var(--space-10)+var(--space-3))] rounded-9px font-mono text-sm font-semibold', AGENT_TONE[details.badge.tone])}>{details.badge.mono}</span>
              <div className="flex flex-[1_1_auto] min-w-0 flex-col gap-2px">
                <h2 className="m-0 text-lg font-semibold">{details.title}</h2>
                <span className="overflow-hidden text-ellipsis whitespace-nowrap text-muted2 font-mono text-sm">{details.idLine}</span>
              </div>
              <StatusPill tone={details.status.tone} label={details.status.label} />
            </div>

            <dl className="grid grid-cols-2 gap-x-7 gap-y-5 m-0 px-7 py-6 border-b border-line2">
              {details.facts.map((fact) => (
                <div key={fact.key} className="flex min-w-0 flex-col gap-0">
                  <dt className="text-faint text-11px">{fact.key}</dt>
                  <dd className="m-0 overflow-hidden text-ellipsis whitespace-nowrap text-sm">{fact.value}</dd>
                </div>
              ))}
            </dl>

            {details.note && <div className={cx('mx-7 mt-6 mb-0 px-5 py-4 rounded-md text-sm', NOTE_TONE[details.note.tone])}>{details.note.text}</div>}

            {activity.length > 0 && (
              <div className="flex flex-col gap-2 px-7 py-6">
                <span className="text-faint text-11px">{S.details.lastActivity}</span>
                <div className="flex flex-col gap-2px px-5 py-4 border border-line2 rounded-md bg-term font-mono text-xs [line-height:1.6]">
                  {activity.map((line, index) => (
                    <div key={`${line.kind}-${index}`} className="flex gap-3">
                      <span className={cx('shrink-0 w-3', ACTIVITY_KIND_CLASS[line.kind])}>{activityGlyph(line.kind)}</span>
                      <span className={cx('whitespace-pre-wrap [word-break:break-word]', ACTIVITY_KIND_CLASS[line.kind])}>{line.text}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {details.isLive && (
              <div className="flex px-7 pt-0 pb-7">
                <button
                  type="button"
                  className="inline-flex items-center gap-7px min-h-[38px] px-6 py-9px border-none rounded-md bg-accent-solid text-on-accent text-base font-semibold cursor-pointer disabled:opacity-50 disabled:cursor-default focus-visible:outline-2 focus-visible:outline-focus focus-visible:outline-offset-2"
                  onClick={() => {
                    openSpecsLive();
                    if (selected?.jobId) {
                      openJobRun(selected.jobId, selected.runId ?? undefined);
                    }
                  }}
                >
                  <Icon name="terminal" size={14} />
                  {S.details.openInWorkspace}
                </button>
              </div>
            )}

            {!details.isLive && (
              <div className="flex flex-col gap-4 px-7 pt-0 pb-7">
                <h3 className="mx-0 mt-1 mb-0 text-base font-semibold">{S.details.resume}</h3>
                <div role="radiogroup" aria-label={S.details.resumeOptions} className="flex flex-col gap-2">
                  {rows.map((row) => (
                    <button
                      key={row.mode}
                      type="button"
                      role="radio"
                      aria-checked={row.checked}
                      disabled={!row.available}
                      className={cx(
                        'flex items-start gap-4 min-h-[44px] px-5 py-4 rounded-9px text-base font-regular text-text text-left focus-visible:outline-2 focus-visible:outline-focus focus-visible:outline-offset-2',
                        row.checked ? 'border-2 border-accent bg-sel' : 'border border-line bg-panel2',
                        row.available ? 'cursor-pointer' : 'opacity-75 cursor-default'
                      )}
                      onClick={() => chooseMode(row.mode)}
                    >
                      <span className={cx('flex shrink-0 items-center justify-center w-[28px] h-[28px] rounded-7px bg-raised', row.checked ? 'text-accent' : 'text-muted')}>
                        <Icon name={row.icon} size={14} />
                      </span>
                      <span className="flex min-w-0 flex-col gap-2px">
                        <span className="font-medium">{row.title}</span>
                        <span className="text-muted2 text-sm">{row.description}</span>
                      </span>
                    </button>
                  ))}
                </div>
                <div className="flex flex-wrap items-center gap-4 pt-1">
                  <code className="flex-[1_1_240px] min-w-0 px-4 py-9px border border-line2 rounded-md bg-term text-text3 font-mono text-xs whitespace-pre-wrap [word-break:break-word]">{cliLine(selected.id, selectedOptionMode, selectedOption, accounts)}</code>
                  <button
                    type="button"
                    className="inline-flex items-center gap-7px min-h-[38px] px-6 py-9px border-none rounded-md bg-accent-solid text-on-accent text-base font-semibold cursor-pointer disabled:opacity-50 disabled:cursor-default focus-visible:outline-2 focus-visible:outline-focus focus-visible:outline-offset-2"
                    disabled={!services || !request || resuming}
                    onClick={onResume}
                  >
                    <Icon name="playFill" size={13} />
                    {resumeButtonLabel(selectedOptionMode, selectedOption, { agents, accounts })}
                  </button>
                </div>
                {error && (
                  <p role="alert" className="m-0 px-5 py-4 rounded-md bg-err-bg text-err-strong text-sm">
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
