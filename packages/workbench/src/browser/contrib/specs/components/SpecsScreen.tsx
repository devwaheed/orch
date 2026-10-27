import { useEffect, useMemo, type CSSProperties } from 'react';
import type { SpecAdvance, SpecOnFail, SpecOrder, SpecQueue } from '@orchagents/contracts';
import { Icon } from '../../../../../../../design/icons/Icon.js';
import type { IconName } from '../../../../../../../design/icons/icons.js';
import { useWorkbenchStore } from '../../../services/workbenchStore.js';
import { useAccountsStore } from '../../../services/stores/accounts.js';
import { useSpecsStore } from '../../../services/stores/specs.js';
import { specsServices } from '../services.js';
import { useSpecsUiStore } from '../stores/specsUi.js';
import {
  loadFactoryStatus,
  loadQueue,
  moveSpec,
  pauseQueue,
  resumeQueue,
  retrySpec,
  skipSpec,
  updateQueueSettings,
} from '../actions.js';
import {
  mapViewModel,
  nowLine,
  progressSegments,
  queueCounts,
  rulesOptions,
  specRows,
  type GroupRowVM,
  type SpecRowVM,
  type ToneName,
} from '../specsView.js';
import { specStrings as S } from '../strings.js';
import { TerminalDock } from '../../../parts/terminal/index.js';
import { WorkView, openJobRun } from '../../work/index.js';
import { FactoryStrip } from './FactoryStrip.js';
import { PlanView } from './PlanView.js';
import { cx } from './cx.js';

const PILL_TONE: Record<ToneName, string> = {
  ok: 'border border-transparent bg-ok-bg text-ok',
  info: 'border border-transparent bg-info-bg text-info',
  warn: 'border border-transparent bg-warn-bg text-warn',
  err: 'border border-transparent bg-err-bg text-err',
  neutral: 'border border-strongline bg-transparent text-text3',
};

const DOT_TONE: Record<ToneName, string> = {
  ok: 'bg-ok-dot',
  info: 'bg-info-dot',
  warn: 'bg-warn-solid',
  err: 'bg-err-dot',
  neutral: 'bg-faint',
};

const BAR_TONE: Record<ToneName, string> = {
  ok: 'bg-ok-dot',
  info: 'bg-info-dot',
  warn: 'bg-warn-solid',
  err: 'bg-err-dot',
  neutral: 'bg-transparent',
};

const NOW_TONE: Record<ToneName, string> = {
  ok: 'bg-info-bg text-info-strong',
  info: 'bg-info-bg text-info-strong',
  warn: 'bg-warn-bg2 text-warn-text',
  err: 'bg-warn-bg2 text-warn-text',
  neutral: 'bg-neutral text-text2',
};

const DW_TONE: Record<ToneName, string> = {
  ok: 'text-ok',
  info: 'text-ok',
  warn: 'text-muted',
  err: 'text-muted',
  neutral: 'text-muted',
};

const CRITERION_ICON: Record<'met' | 'not_met' | 'running' | 'pending', IconName> = {
  met: 'check',
  not_met: 'x',
  running: 'sync',
  pending: 'clock',
};

const CRITERION_TONE: Record<ToneName, string> = {
  ok: 'text-ok',
  info: 'text-ok',
  warn: 'text-warn',
  err: 'text-err',
  neutral: 'text-faint',
};

const AGENT_TILE_CLASS: Record<'cc' | 'cx' | 'gm' | 'oc' | 'ag', string> = {
  cc: 'bg-cc-bg text-cc-fg',
  cx: 'bg-cx-bg text-cx-fg',
  gm: 'bg-gm-bg text-gm-fg',
  oc: 'bg-oc-bg text-oc-fg',
  ag: 'bg-ag-bg text-ag-fg',
};

/** The title line of every map node: weight depends on the node type. */
const MAP_TITLE = 'flex items-center gap-3 text-base text-text';

function isGroupRow(row: SpecRowVM | GroupRowVM): row is GroupRowVM {
  return 'range' in row;
}

function formatEstimate(queue: SpecQueue | null): string {
  if (!queue) return '';
  const verifiedSpecs = queue.specs.filter(
    (s) => s.state === 'verified' || s.state === 'approved' || s.state === 'merged',
  );
  const remaining = queue.specs.length - verifiedSpecs.length;
  if (remaining <= 0) return '';
  let totalMs = 0;
  let count = 0;
  for (const s of verifiedSpecs) {
    if (s.startedAt && s.finishedAt) {
      const start = Date.parse(s.startedAt);
      const end = Date.parse(s.finishedAt);
      if (!Number.isNaN(start) && !Number.isNaN(end) && end > start) {
        totalMs += end - start;
        count++;
      }
    }
  }
  if (count > 0) {
    const avgMs = totalMs / count;
    const remMs = avgMs * remaining;
    const hours = Math.round(remMs / 3600000);
    if (hours >= 1) {
      return `about ${hours} h left at today’s pace`;
    }
    const mins = Math.round(remMs / 60000);
    return `about ${Math.max(1, mins)}m left at today’s pace`;
  }
  // ponytail: no finished spec yet = no pace to estimate from; show nothing rather than a guess.
  return '';
}

export function SpecsScreen() {
  const activeProject = useWorkbenchStore((s) => s.activeProject);
  const queues = useSpecsStore((s) => s.queues);
  const accounts = useAccountsStore((s) => s.accounts);

  const view = useSpecsUiStore((s) => s.view);
  const setView = useSpecsUiStore((s) => s.setView);
  const expandedId = useSpecsUiStore((s) => s.expandedId);
  const setExpandedId = useSpecsUiStore((s) => s.setExpandedId);
  const selectedId = useSpecsUiStore((s) => s.selectedId);
  const setSelectedId = useSpecsUiStore((s) => s.setSelectedId);
  const problems = useSpecsUiStore((s) => s.problems);
  const loadError = useSpecsUiStore((s) => s.loadError);

  useEffect(() => {
    const services = specsServices();
    if (services && activeProject) {
      void loadQueue(services.specs);
    }
  }, [activeProject]);

  useEffect(() => {
    const services = specsServices();
    if (!services || !activeProject) {
      useSpecsUiStore.getState().setFactory(null, null);
      return;
    }
    void loadFactoryStatus(services.specs, activeProject);
  }, [activeProject]);

  const queue = useMemo(() => {
    return queues.find((q) => q.repoPath === activeProject) ?? queues[0] ?? null;
  }, [queues, activeProject]);

  const viewContext = useMemo(
    () => ({
      accounts,
      now: new Date(),
    }),
    [accounts],
  );

  const counts = useMemo(() => {
    if (!queue) return null;
    return queueCounts(queue.specs, queue.settings);
  }, [queue]);

  const segments = useMemo(() => {
    if (!queue) return [];
    return progressSegments(queue.specs, queue.settings);
  }, [queue]);

  const currentNowLine = useMemo(() => {
    if (!queue) return null;
    return nowLine(queue);
  }, [queue]);

  const rules = useMemo(() => {
    if (!queue) return null;
    return rulesOptions(queue.settings);
  }, [queue]);

  const rows = useMemo(() => {
    if (!queue) return [];
    return specRows(
      queue.specs,
      {
        advance: queue.settings.advance,
        selectedId: expandedId,
      },
      viewContext,
    );
  }, [queue, expandedId, viewContext]);

  const mapVm = useMemo(() => {
    if (!queue) return null;
    return mapViewModel(queue, viewContext, selectedId);
  }, [queue, viewContext, selectedId]);

  const handleTogglePause = () => {
    if (!queue) return;
    const services = specsServices();
    if (!services) return;
    if (queue.paused) {
      void resumeQueue(services.specs, queue.id);
    } else {
      void pauseQueue(services.specs, queue.id);
    }
  };

  const handleOrderChange = (order: string) => {
    if (!queue) return;
    const services = specsServices();
    if (!services) return;
    void updateQueueSettings(services.specs, queue.id, { order: order as SpecOrder });
  };

  const handleAdvanceChange = (advance: string) => {
    if (!queue) return;
    const services = specsServices();
    if (!services) return;
    void updateQueueSettings(services.specs, queue.id, { advance: advance as SpecAdvance });
  };

  const handleOnFailChange = (onFail: string) => {
    if (!queue) return;
    const services = specsServices();
    if (!services) return;
    void updateQueueSettings(services.specs, queue.id, { on_fail: onFail as SpecOnFail });
  };

  const handleToggleRow = (id: string) => {
    setExpandedId(expandedId === id ? null : id);
  };

  const handleWatchLive = (specId: string) => {
    if (!queue) return;
    const spec = queue.specs.find((s) => s.id === specId);
    if (!spec) return;
    setSelectedId(spec.id);
    setView('live');
    if (spec.jobId) {
      openJobRun(spec.jobId);
    }
  };

  const handleSkipSpec = (specId: string) => {
    if (!queue) return;
    const services = specsServices();
    if (!services) return;
    void skipSpec(services.specs, queue.id, specId);
  };

  const handleRetrySpec = (specId: string) => {
    if (!queue) return;
    const services = specsServices();
    if (!services) return;
    void retrySpec(services.specs, queue.id, specId);
  };

  const handleMoveSpec = (specId: string, direction: -1 | 1) => {
    if (!queue) return;
    const services = specsServices();
    if (!services) return;
    const spec = queue.specs.find((s) => s.id === specId);
    if (!spec) return;
    const toPos = spec.position + direction;
    if (toPos < 1 || toPos > queue.specs.length) return;
    void moveSpec(services.specs, queue.id, specId, toPos);
  };

  const sourceFolder = queue?.settings.source ?? 'docs/specs';
  const totalSpecs = queue?.specs.length ?? 0;
  const sourceParts = sourceFolder.match(/^([^(]+)(\s*\(.+\))$/);
  const sourceBase = sourceParts?.[1]?.trim() ?? sourceFolder;
  const sourceLabel = sourceParts?.[2] ? ` ${sourceParts[2].trim()}` : '';

  const isEmpty = (!queue || queue.specs.length === 0) && problems.length === 0;
  const fitWindow = view === 'plan' || view === 'live' || isEmpty;

  return (
    <div
      className={cx(
        'flex flex-col text-base text-text font-sans',
        fitWindow ? 'flex-auto min-h-0 overflow-hidden' : 'pb-10',
      )}
      data-fit-window={fitWindow ? '' : undefined}
    >
      <div className="flex flex-wrap items-end gap-5 px-9 pt-22px pb-7">
        <div className="flex flex-[1_1_380px] flex-col gap-3px">
          <h1 className="m-0 text-xl font-semibold">{S.title}</h1>
          <p className="m-0 text-muted">
            {totalSpecs} {totalSpecs === 1 ? 'story' : 'stories'} from <span className="font-mono text-sm">{sourceBase}</span>{sourceLabel}. orch runs them in
            order and moves to the next one on its own.
          </p>
        </div>

        <div role="group" aria-label="View" className="flex rounded-9px border border-line bg-panel2 p-3px">
          <button
            type="button"
            onClick={() => setView('list')}
            aria-pressed={view === 'list'}
            className="min-h-10 cursor-pointer whitespace-nowrap rounded-sm border-0 bg-transparent px-4 py-5px text-sm text-muted aria-pressed:bg-seg aria-pressed:text-text"
          >
            {S.views.queue}
          </button>
          <button
            type="button"
            onClick={() => setView('map')}
            aria-pressed={view === 'map'}
            className="min-h-10 cursor-pointer whitespace-nowrap rounded-sm border-0 bg-transparent px-4 py-5px text-sm text-muted aria-pressed:bg-seg aria-pressed:text-text"
          >
            {S.views.map}
          </button>
          <button
            type="button"
            onClick={() => setView('plan')}
            aria-pressed={view === 'plan'}
            className="min-h-10 cursor-pointer whitespace-nowrap rounded-sm border-0 bg-transparent px-4 py-5px text-sm text-muted aria-pressed:bg-seg aria-pressed:text-text"
          >
            {S.views.plan}
          </button>
          <button
            type="button"
            onClick={() => setView('live')}
            aria-pressed={view === 'live'}
            className="min-h-10 cursor-pointer whitespace-nowrap rounded-sm border-0 bg-transparent px-4 py-5px text-sm text-muted aria-pressed:bg-seg aria-pressed:text-text"
          >
            {S.views.live}
          </button>
        </div>

        {queue && (
          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={handleTogglePause}
              className="flex min-h-[36px] cursor-pointer items-center gap-2 rounded-md border border-btnline bg-btn px-13px py-3 text-base text-text"
            >
              <Icon name={queue.paused ? 'play' : 'pause'} size={13} weight={2.2} />
              {queue.paused ? S.queueButton.resume : S.queueButton.pause}
            </button>
          </div>
        )}
      </div>

      {view === 'live' ? (
        <div className="flex flex-auto min-h-0 min-w-0 border-t border-line">
          <WorkView />
        </div>
      ) : (
        <div
          className={cx(
            'flex flex-col gap-7 px-9',
            view === 'plan' ? 'flex-auto min-h-0 overflow-hidden pb-9' : '',
          )}
        >
          <FactoryStrip />

          {loadError && (
            <div className="flex flex-col gap-3 rounded-xl border border-err-line bg-err-bg px-7 py-6 text-err-strong" role="alert">
              <h2 className="m-0 text-md font-semibold">{loadError.message}</h2>
              <p className="m-0 text-sm">{loadError.fix}</p>
            </div>
          )}

          {problems.length > 0 && (
            <section
              aria-label="Problems"
              className="flex flex-col gap-3 rounded-xl border border-err-line bg-err-bg px-7 py-6 text-err-strong"
            >
              <h2 className="m-0 text-md font-semibold">{S.states.problems}</h2>
              <p className="m-0 text-sm">{S.states.problemsIntro}</p>
              {problems.map((prob, idx) => (
                <div key={idx} className="flex gap-3 text-sm">
                  <span className="font-mono font-medium">{prob.file}:</span>
                  <span>{prob.message}</span>
                </div>
              ))}
            </section>
          )}

          {queue && !isEmpty && (
            <>
              {view !== 'plan' && (
                <>
                  <section aria-label="Progress" className="flex flex-col gap-4 rounded-xl border border-line bg-panel px-7 py-6">
                    <div className="flex h-4 overflow-hidden rounded-5px bg-line">
                      {segments.map((sb, idx) => (
                        <span
                          key={idx}
                          title={sb.title}
                          className={cx('block h-4 w-(--seg-w)', BAR_TONE[sb.tone])}
                          style={{ '--seg-w': sb.width } as CSSProperties}
                        />
                      ))}
                    </div>

                    {counts && (
                      <div className="flex flex-wrap items-center gap-x-18px gap-y-2 text-12p5">
                        <span className="inline-flex items-center gap-2 text-text2">
                          <span className={cx('h-3 w-3 rounded-full', DOT_TONE.ok)} />
                          <strong className="font-semibold text-text">{counts.verified}</strong> {S.counts.verified}
                        </span>
                        <span className="inline-flex items-center gap-2 text-text2">
                          <span className={cx('h-3 w-3 rounded-full', DOT_TONE.info)} />
                          <strong className="font-semibold text-text">{counts.running}</strong> {S.counts.running}
                        </span>
                        <span className="inline-flex items-center gap-2 text-text2">
                          <span className={cx('h-3 w-3 rounded-full', DOT_TONE[counts.badTone])} />
                          <strong className="font-semibold text-text">{counts.bad}</strong> {counts.badLabel}
                        </span>
                        <span className="inline-flex items-center gap-2 text-text2">
                          <span className={cx('h-3 w-3 rounded-full', DOT_TONE.neutral)} />
                          <strong className="font-semibold text-text">{counts.queued}</strong> {S.counts.queued}
                        </span>
                        <span className="flex-auto" />
                        <span className="text-muted2">{formatEstimate(queue)}</span>
                      </div>
                    )}

                    {currentNowLine && (
                      <div className={cx('flex items-center gap-3 rounded-md px-11px py-9px text-12p5', NOW_TONE[currentNowLine.tone])}>
                        <Icon name={currentNowLine.icon} size={14} weight={2} />
                        <span>{currentNowLine.text}</span>
                      </div>
                    )}
                  </section>

                  {rules && (
                    <section aria-label="Queue rules" className="flex flex-wrap items-center gap-x-22px gap-y-4 text-12p5">
                      <span className="flex items-center gap-3">
                        <span className="text-muted">{S.rules.order}</span>
                        <div role="group" aria-label={S.rules.order} className="flex rounded-9px border border-line bg-panel2 p-3px">
                          {rules.order.map((opt) => (
                            <button
                              key={opt.value}
                              type="button"
                              onClick={() => handleOrderChange(opt.value)}
                              aria-pressed={opt.pressed}
                              className="min-h-10 cursor-pointer whitespace-nowrap rounded-sm border-0 bg-transparent px-4 py-5px text-sm text-muted aria-pressed:bg-seg aria-pressed:text-text"
                            >
                              {opt.label}
                            </button>
                          ))}
                        </div>
                      </span>

                      <span className="flex items-center gap-3">
                        <span className="text-muted">{S.rules.advance}</span>
                        <div role="group" aria-label={S.rules.advance} className="flex rounded-9px border border-line bg-panel2 p-3px">
                          {rules.advance.map((opt) => (
                            <button
                              key={opt.value}
                              type="button"
                              onClick={() => handleAdvanceChange(opt.value)}
                              aria-pressed={opt.pressed}
                              className="min-h-10 cursor-pointer whitespace-nowrap rounded-sm border-0 bg-transparent px-4 py-5px text-sm text-muted aria-pressed:bg-seg aria-pressed:text-text"
                            >
                              {opt.label}
                            </button>
                          ))}
                        </div>
                      </span>

                      <span className="flex items-center gap-3">
                        <span className="text-muted">{S.rules.onFail}</span>
                        <div role="group" aria-label={S.rules.onFail} className="flex rounded-9px border border-line bg-panel2 p-3px">
                          {rules.onFail.map((opt) => (
                            <button
                              key={opt.value}
                              type="button"
                              onClick={() => handleOnFailChange(opt.value)}
                              aria-pressed={opt.pressed}
                              className="min-h-10 cursor-pointer whitespace-nowrap rounded-sm border-0 bg-transparent px-4 py-5px text-sm text-muted aria-pressed:bg-seg aria-pressed:text-text"
                            >
                              {opt.label}
                            </button>
                          ))}
                        </div>
                      </span>
                    </section>
                  )}
                </>
              )}

              {view === 'list' && (
                <section aria-label="Spec queue" className="overflow-hidden rounded-xl border border-line bg-panel">
                  {rows.map((row) => (
                    <div
                      key={row.key}
                      id={isGroupRow(row) ? undefined : `spec-row-${row.number}`}
                      className="border-b border-line2 last:border-b-0"
                    >
                      {isGroupRow(row) ? (
                        <div className="flex items-center gap-5 bg-panel2 px-7 py-4 text-12p5 text-muted">
                          <Icon
                            name={row.icon}
                            size={14}
                            weight={2}
                            className={cx(row.tone === 'info' ? 'text-ok-dot' : 'text-faint')}
                          />
                          <span className="font-mono text-text2">{row.range}</span>
                          <span className="flex-auto">{row.text}</span>
                        </div>
                      ) : (
                        <>
                          <button
                            type="button"
                            onClick={() => handleToggleRow(row.number)}
                            aria-expanded={row.expanded}
                            className={cx(
                              'grid w-full min-w-[720px] cursor-pointer grid-cols-[34px_minmax(0,1fr)_150px_70px_150px_80px] items-center gap-5 border-0 px-7 py-4 text-left text-base text-text',
                              'min-h-[48px]',
                              row.expanded ? 'bg-rowsel' : 'bg-transparent',
                            )}
                          >
                            <span className="font-mono text-sm text-muted2">{row.number}</span>
                            <span className="flex min-w-0 flex-col">
                              <span className="truncate font-medium">{row.title}</span>
                              <span className="text-xs text-muted2">{row.meta}</span>
                            </span>
                            <span className="flex">
                              <span className={cx('inline-flex items-center gap-5px whitespace-nowrap rounded-pill px-9px py-3px text-xs', PILL_TONE[row.status.tone])}>
                                <span className={cx('h-2 w-2 rounded-full', DOT_TONE[row.status.tone])} />
                                {row.status.pill}
                              </span>
                            </span>
                            <span title="Done-when criteria met" className={cx('font-mono text-sm', DW_TONE[row.doneWhenColor])}>
                              {row.doneWhen}
                            </span>
                            <span className="flex min-w-0 items-center gap-7px text-sm text-text2">
                              {row.agent && (
                                <span
                                  className={cx(
                                    'flex h-18px w-18px shrink-0 grow-0 basis-18px items-center justify-center rounded-5px font-mono text-7p5 font-semibold',
                                    AGENT_TILE_CLASS[row.tileTone],
                                  )}
                                >
                                  {row.mono}
                                </span>
                              )}
                              <span className="whitespace-nowrap">{row.who}</span>
                            </span>
                            <span className="text-right font-mono text-xs text-muted2">{row.cost}</span>
                          </button>

                          {row.expanded && (
                            <div className="flex flex-wrap gap-7 bg-rowsel pb-7 pl-62px pr-7 pt-1">
                              <div className="flex min-w-0 flex-[2_1_380px] flex-col gap-2">
                                <span className="text-sm font-semibold text-text2">{S.row.doneWhen}</span>
                                {row.criteria.map((c, cIdx) => (
                                  <div key={cIdx} className="flex items-start gap-3 text-12p5">
                                    <Icon
                                      name={CRITERION_ICON[c.state]}
                                      size={14}
                                      weight={2.3}
                                      className={cx('mt-2px shrink-0 grow-0 basis-6', CRITERION_TONE[c.tone])}
                                    />
                                    <span className="flex-auto">{c.text}</span>
                                    <span className="flex-none whitespace-nowrap rounded-sm bg-neutral px-7px py-1px text-11px text-muted">{c.by}</span>
                                  </div>
                                ))}
                              </div>

                              <div className="flex flex-[1_1_220px] flex-col gap-3 text-sm text-muted">
                                <span>
                                  <span className="text-muted2">{S.row.dependsOn} </span>
                                  {row.dependsOn}
                                </span>
                                <span>
                                  <span className="text-muted2">{S.row.mayChange} </span>
                                  <span className="font-mono text-xs text-text2">{row.scope}</span>
                                </span>
                                <div className="mt-1 flex flex-wrap gap-2">
                                  {queue?.specs.find((spec) => spec.id === row.number)?.jobId ? (
                                    <button
                                      type="button"
                                      onClick={() => handleWatchLive(row.number)}
                                      className="flex min-h-hit-min cursor-pointer items-center gap-2 rounded-7px border border-btnline bg-btn px-4 py-2 text-sm text-text"
                                    >
                                      <Icon name="terminal" size={12} weight={2} />
                                      {S.row.openInWork}
                                    </button>
                                  ) : null}
                                  <button
                                    type="button"
                                    onClick={() => handleSkipSpec(row.number)}
                                    className="flex min-h-hit-min cursor-pointer items-center gap-2 rounded-7px border border-btnline bg-transparent px-4 py-2 text-sm text-text disabled:cursor-not-allowed disabled:border-line2 disabled:text-disabled"
                                  >
                                    <Icon name="chevRight" size={12} weight={2} />
                                    {S.row.skip}
                                  </button>
                                  {queue?.specs.find((spec) => spec.id === row.number)?.state === 'needs_you' ? (
                                    <button
                                      type="button"
                                      onClick={() => handleRetrySpec(row.number)}
                                      className="flex min-h-hit-min cursor-pointer items-center gap-2 rounded-7px border border-btnline bg-transparent px-4 py-2 text-sm text-text disabled:cursor-not-allowed disabled:border-line2 disabled:text-disabled"
                                    >
                                      <Icon name="sync" size={12} weight={2} />
                                      {S.row.retry}
                                    </button>
                                  ) : null}
                                  {queue?.specs.find((spec) => spec.id === row.number)?.state === 'queued' ||
                                  queue?.specs.find((spec) => spec.id === row.number)?.state === 'blocked' ? (
                                    <>
                                      <button
                                        type="button"
                                        onClick={() => handleMoveSpec(row.number, -1)}
                                        className="flex min-h-hit-min cursor-pointer items-center gap-2 rounded-7px border border-btnline bg-transparent px-4 py-2 text-sm text-text disabled:cursor-not-allowed disabled:border-line2 disabled:text-disabled"
                                        title="Move up"
                                      >
                                        <Icon name="arrowUp" size={12} weight={2} />
                                      </button>
                                      <button
                                        type="button"
                                        onClick={() => handleMoveSpec(row.number, 1)}
                                        className="flex min-h-hit-min cursor-pointer items-center gap-2 rounded-7px border border-btnline bg-transparent px-4 py-2 text-sm text-text disabled:cursor-not-allowed disabled:border-line2 disabled:text-disabled"
                                        title="Move down"
                                      >
                                        <Icon name="chevDown" size={12} weight={2} />
                                      </button>
                                    </>
                                  ) : null}
                                </div>
                              </div>
                            </div>
                          )}
                        </>
                      )}
                    </div>
                  ))}
                </section>
              )}

              {view === 'map' && mapVm && (
                <section aria-label="Agent map" className="flex flex-col gap-6 overflow-x-auto rounded-xl border border-line bg-panel p-7">
                  <span className="text-12p5 text-muted">{S.map.clickHint(queue.settings.order === 'waves' ? 6 : 5)}</span>
                  <div className="flex min-w-[900px] items-center gap-0">
                    <div className="shrink-0 grow-0 basis-[250px]">
                      <div className="flex flex-col gap-3px rounded-lg border border-btnline bg-panel2 px-13px py-11px">
                        <span className={cx(MAP_TITLE, 'font-semibold')}>
                          <span className={cx('h-3 w-3 rounded-full', DOT_TONE.info)} />
                          {mapVm.runner.title}
                        </span>
                        <span className="text-xs text-muted2">{mapVm.runner.sub}</span>
                      </div>
                    </div>

                    <div className="h-1px shrink-0 grow-0 basis-10 bg-strongline" />

                    <div className="flex shrink-0 grow-0 basis-[300px] flex-col gap-4 border-l border-strongline py-2">
                      {mapVm.specNodes.map((node) => (
                        <div key={node.id} className="flex items-center">
                          <span className="h-1px shrink-0 grow-0 basis-18px bg-strongline" />
                          <button
                            type="button"
                            onClick={() => {
                              handleWatchLive(node.id);
                            }}
                            className={cx(
                              'flex min-h-[44px] flex-auto cursor-pointer flex-col gap-3px rounded-lg border px-5 py-4 text-left text-base text-text',
                              mapVm.selectedId === node.id ? 'border-accent bg-sel' : 'border-btnline bg-panel2',
                            )}
                          >
                            <span className={cx(MAP_TITLE, 'font-regular')}>
                              <span className={cx('h-3 w-3 rounded-full', DOT_TONE[node.tone])} />
                              {node.title}
                            </span>
                            <span className="text-xs text-muted2">{node.sub}</span>
                          </button>
                        </div>
                      ))}
                    </div>

                    <div className="h-1px shrink-0 grow-0 basis-10 bg-strongline" />

                    <div className="flex shrink-0 grow-0 basis-[300px] flex-col gap-4 border-l border-strongline py-2">
                      {mapVm.steps.map((step, idx) => (
                        <div key={idx} className="flex items-center">
                          <span className="h-1px shrink-0 grow-0 basis-18px bg-strongline" />
                          <div className="flex min-h-[44px] flex-auto flex-col gap-3px rounded-lg border border-btnline bg-panel2 px-5 py-4 text-left text-base text-text">
                            <span className={cx(MAP_TITLE, 'font-regular')}>
                              <span className={cx('h-3 w-3 rounded-full', DOT_TONE[step.tone])} />
                              {step.title}
                            </span>
                            <span className="text-xs text-muted2">{step.sub}</span>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>

                  {mapVm.backgroundTasks.length > 0 && (
                    <div className="flex flex-col gap-3 border-t border-line2 pt-2 text-12p5 text-muted">
                      <span>
                        {mapVm.backgroundTasks.length === 1
                          ? S.map.backgroundTaskOne
                          : `${mapVm.backgroundTasks.length} background tasks`}
                      </span>
                      {mapVm.backgroundTasks.map((t) => (
                        <div key={t.id} className="flex min-w-[260px] flex-col gap-3px self-start rounded-lg border border-btnline bg-panel2 px-5 py-4">
                          <span className={cx(MAP_TITLE, 'font-regular')}>
                            <span className={cx('h-3 w-3 rounded-full', DOT_TONE.info)} />
                            {t.title}
                          </span>
                          <span className="text-xs text-muted2">{t.sub}</span>
                        </div>
                      ))}
                    </div>
                  )}
                </section>
              )}

              {view === 'plan' && (
                <>
                  <PlanView queue={queue} accounts={accounts} />
                  {/* The dock lives under Work; Plan shows it too, so "Insert in terminal" lands where you can see it. */}
                  <TerminalDock />
                </>
              )}
            </>
          )}

          {isEmpty && (
            <div className="flex flex-col items-center justify-center gap-3 rounded-xl border border-dashed border-line bg-panel p-10 text-center">
              <span className="text-lg font-semibold text-text">{S.states.empty.title}</span>
              <span className="text-sm text-muted max-w-[480px]">{S.states.empty.description}</span>
              <button
                type="button"
                onClick={() => useWorkbenchStore.getState().setActiveRoute('/jobs/new')}
                className="mt-2 inline-flex items-center gap-2 px-5 py-7px min-h-[34px] rounded-md border-0 bg-accent-solid text-on-accent font-semibold text-sm cursor-pointer hover:opacity-92"
              >
                <Icon name="plus" size={13} weight={2.6} />
                <span>{S.states.empty.button}</span>
              </button>
            </div>
          )}
          {/* Specs is the start screen now, so ⌃` must work before the first spec exists. */}
          {isEmpty && <TerminalDock />}
        </div>
      )}
    </div>
  );
}
