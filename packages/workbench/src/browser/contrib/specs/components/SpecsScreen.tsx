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
import { PlanView } from './PlanView.js';
import styles from './SpecsScreen.module.css';
import { cx } from './cx.js';

const PILL_TONE: Record<ToneName, string | undefined> = {
  ok: styles.pillOk,
  info: styles.pillInfo,
  warn: styles.pillWarn,
  err: styles.pillErr,
  neutral: styles.pillNeutral,
};

const DOT_TONE: Record<ToneName, string | undefined> = {
  ok: styles.dotOk,
  info: styles.dotInfo,
  warn: styles.dotWarn,
  err: styles.dotErr,
  neutral: styles.dotNeutral,
};

const BAR_TONE: Record<ToneName, string | undefined> = {
  ok: styles.barOk,
  info: styles.barInfo,
  warn: styles.barWarn,
  err: styles.barErr,
  neutral: styles.barNeutral,
};

const NOW_TONE: Record<ToneName, string | undefined> = {
  ok: styles.nowInfo,
  info: styles.nowInfo,
  warn: styles.nowWarn,
  err: styles.nowWarn,
  neutral: styles.nowNeutral,
};

const DW_TONE: Record<ToneName, string | undefined> = {
  ok: styles.dwInfo,
  info: styles.dwInfo,
  warn: styles.dwNeutral,
  err: styles.dwNeutral,
  neutral: styles.dwNeutral,
};

const CRITERION_ICON: Record<'met' | 'not_met' | 'running' | 'pending', IconName> = {
  met: 'check',
  not_met: 'x',
  running: 'sync',
  pending: 'clock',
};

const CRITERION_TONE: Record<ToneName, string | undefined> = {
  ok: styles.iconInfo,
  info: styles.iconInfo,
  warn: styles.iconWarn,
  err: styles.iconErr,
  neutral: styles.iconNeutral,
};

const AGENT_TILE_CLASS: Record<'cc' | 'cx' | 'gm' | 'oc' | 'ag', string | undefined> = {
  cc: styles.agentCc,
  cx: styles.agentCx,
  gm: styles.agentGm,
  oc: styles.agentOc,
  ag: styles.agentAg,
};

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
  return 'about 3 h left at today’s pace';
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

  const handleOpenInWork = () => {
    useWorkbenchStore.getState().setActiveArea('work');
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

  return (
    <div className={cx(styles.screen, view === 'plan' && styles.screenPlan)} data-fit-window={view === 'plan' ? '' : undefined}>
      <div className={styles.headerRow}>
        <div className={styles.headerText}>
          <h1 className={styles.title}>{S.title}</h1>
          <p className={styles.intro}>
            {totalSpecs} stories from <span className={styles.introMono}>{sourceBase}</span>{sourceLabel}. orch runs them in
            order and moves to the next one on its own.
          </p>
        </div>

        <div role="group" aria-label="View" className={styles.segment}>
          <button
            type="button"
            onClick={() => setView('list')}
            aria-pressed={view === 'list'}
            className={styles.segmentButton}
          >
            {S.views.queue}
          </button>
          <button
            type="button"
            onClick={() => setView('map')}
            aria-pressed={view === 'map'}
            className={styles.segmentButton}
          >
            {S.views.map}
          </button>
          <button
            type="button"
            onClick={() => setView('plan')}
            aria-pressed={view === 'plan'}
            className={styles.segmentButton}
          >
            {S.views.plan}
          </button>
        </div>

        {queue && (
          <div className={styles.headerActions}>
            <button type="button" onClick={handleTogglePause} className={styles.queueButton}>
              <Icon name={queue.paused ? 'play' : 'pause'} size={13} weight={2.2} />
              {queue.paused ? S.queueButton.resume : S.queueButton.pause}
            </button>
          </div>
        )}
      </div>

      {loadError && (
        <div className={styles.problemsCard} role="alert">
          <h2 className={styles.problemsTitle}>{loadError.message}</h2>
          <p className={styles.problemsIntro}>{loadError.fix}</p>
        </div>
      )}

      {problems.length > 0 && (
        <section aria-label="Problems" className={styles.problemsCard}>
          <h2 className={styles.problemsTitle}>{S.states.problems}</h2>
          <p className={styles.problemsIntro}>{S.states.problemsIntro}</p>
          {problems.map((prob, idx) => (
            <div key={idx} className={styles.problemItem}>
              <span className={styles.problemFile}>{prob.file}:</span>
              <span>{prob.message}</span>
            </div>
          ))}
        </section>
      )}

      {queue && (
        <>
          {view !== 'plan' && (
            <>
              <section aria-label="Progress" className={styles.progressCard}>
                <div className={styles.progressBar}>
                  {segments.map((sb, idx) => (
                    <span
                      key={idx}
                      title={sb.title}
                      className={cx(styles.barSegment, BAR_TONE[sb.tone])}
                      style={{ '--seg-w': sb.width } as CSSProperties}
                    />
                  ))}
                </div>

                {counts && (
                  <div className={styles.countsRow}>
                    <span className={styles.countItem}>
                      <span className={cx(styles.countDot, styles.dotOk)} />
                      <strong className={styles.countNumber}>{counts.verified}</strong> {S.counts.verified}
                    </span>
                    <span className={styles.countItem}>
                      <span className={cx(styles.countDot, styles.dotInfo)} />
                      <strong className={styles.countNumber}>{counts.running}</strong> {S.counts.running}
                    </span>
                    <span className={styles.countItem}>
                      <span className={cx(styles.countDot, DOT_TONE[counts.badTone])} />
                      <strong className={styles.countNumber}>{counts.bad}</strong> {counts.badLabel}
                    </span>
                    <span className={styles.countItem}>
                      <span className={cx(styles.countDot, styles.dotNeutral)} />
                      <strong className={styles.countNumber}>{counts.queued}</strong> {S.counts.queued}
                    </span>
                    <span className={styles.countSpacer} />
                    <span className={styles.estimateText}>{formatEstimate(queue)}</span>
                  </div>
                )}

                {currentNowLine && (
                  <div className={cx(styles.nowLine, NOW_TONE[currentNowLine.tone])}>
                    <Icon name={currentNowLine.icon} size={14} weight={2} />
                    <span>{currentNowLine.text}</span>
                  </div>
                )}
              </section>

              {rules && (
                <section aria-label="Queue rules" className={styles.rulesRow}>
                  <span className={styles.ruleGroup}>
                    <span className={styles.ruleLabel}>{S.rules.order}</span>
                    <div role="group" aria-label={S.rules.order} className={styles.segment}>
                      {rules.order.map((opt) => (
                        <button
                          key={opt.value}
                          type="button"
                          onClick={() => handleOrderChange(opt.value)}
                          aria-pressed={opt.pressed}
                          className={styles.segmentButton}
                        >
                          {opt.label}
                        </button>
                      ))}
                    </div>
                  </span>

                  <span className={styles.ruleGroup}>
                    <span className={styles.ruleLabel}>{S.rules.advance}</span>
                    <div role="group" aria-label={S.rules.advance} className={styles.segment}>
                      {rules.advance.map((opt) => (
                        <button
                          key={opt.value}
                          type="button"
                          onClick={() => handleAdvanceChange(opt.value)}
                          aria-pressed={opt.pressed}
                          className={styles.segmentButton}
                        >
                          {opt.label}
                        </button>
                      ))}
                    </div>
                  </span>

                  <span className={styles.ruleGroup}>
                    <span className={styles.ruleLabel}>{S.rules.onFail}</span>
                    <div role="group" aria-label={S.rules.onFail} className={styles.segment}>
                      {rules.onFail.map((opt) => (
                        <button
                          key={opt.value}
                          type="button"
                          onClick={() => handleOnFailChange(opt.value)}
                          aria-pressed={opt.pressed}
                          className={styles.segmentButton}
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
            <section aria-label="Spec queue" className={styles.queueCard}>
              {rows.map((row) => (
                <div key={row.key} className={styles.rowWrapper}>
                  {isGroupRow(row) ? (
                    <div className={styles.groupRow}>
                      <Icon
                        name={row.icon}
                        size={14}
                        weight={2}
                        className={cx(row.tone === 'info' ? styles.groupIconInfo : styles.groupIconNeutral)}
                      />
                      <span className={styles.monoRange}>{row.range}</span>
                      <span className={styles.groupText}>{row.text}</span>
                    </div>
                  ) : (
                    <>
                      <button
                        type="button"
                        onClick={() => handleToggleRow(row.number)}
                        aria-expanded={row.expanded}
                        className={cx(styles.specRow, row.expanded && styles.specRowSelected)}
                      >
                        <span className={styles.rowNumber}>{row.number}</span>
                        <span className={styles.rowTitleBlock}>
                          <span className={styles.rowTitle}>{row.title}</span>
                          <span className={styles.rowMeta}>{row.meta}</span>
                        </span>
                        <span className={styles.pillCell}>
                          <span className={cx(styles.pill, PILL_TONE[row.status.tone])}>
                            <span className={cx(styles.pillDot, DOT_TONE[row.status.tone])} />
                            {row.status.pill}
                          </span>
                        </span>
                        <span
                          title="Done-when criteria met"
                          className={cx(styles.doneWhenCell, DW_TONE[row.doneWhenColor])}
                        >
                          {row.doneWhen}
                        </span>
                        <span className={styles.whoCell}>
                          {row.agent && (
                            <span className={cx(styles.agentTile, AGENT_TILE_CLASS[row.tileTone])}>{row.mono}</span>
                          )}
                          <span className={styles.whoText}>{row.who}</span>
                        </span>
                        <span className={styles.costCell}>{row.cost}</span>
                      </button>

                      {row.expanded && (
                        <div className={styles.rowDetail}>
                          <div className={styles.criteriaColumn}>
                            <span className={styles.criteriaTitle}>{S.row.doneWhen}</span>
                            {row.criteria.map((c, cIdx) => (
                              <div key={cIdx} className={styles.criterionRow}>
                                <Icon
                                  name={CRITERION_ICON[c.state]}
                                  size={14}
                                  weight={2.3}
                                  className={cx(styles.criterionIcon, CRITERION_TONE[c.tone])}
                                />
                                <span className={styles.criterionText}>{c.text}</span>
                                <span className={styles.criterionBy}>{c.by}</span>
                              </div>
                            ))}
                          </div>

                          <div className={styles.metaColumn}>
                            <span>
                              <span className={styles.metaLabel}>{S.row.dependsOn} </span>
                              {row.dependsOn}
                            </span>
                            <span>
                              <span className={styles.metaLabel}>{S.row.mayChange} </span>
                              <span className={styles.metaMono}>{row.scope}</span>
                            </span>
                            <div className={styles.detailActions}>
                              <button type="button" onClick={handleOpenInWork} className={styles.actionButton}>
                                <Icon name="terminal" size={12} weight={2} />
                                {S.row.openInWork}
                              </button>
                              <button
                                type="button"
                                onClick={() => handleSkipSpec(row.number)}
                                className={styles.actionSecondary}
                              >
                                <Icon name="chevRight" size={12} weight={2} />
                                {S.row.skip}
                              </button>
                              {queue?.specs.find((spec) => spec.id === row.number)?.state === 'needs_you' ? (
                                <button
                                  type="button"
                                  onClick={() => handleRetrySpec(row.number)}
                                  className={styles.actionSecondary}
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
                                    className={styles.actionSecondary}
                                    title="Move up"
                                  >
                                    <Icon name="arrowUp" size={12} weight={2} />
                                  </button>
                                  <button
                                    type="button"
                                    onClick={() => handleMoveSpec(row.number, 1)}
                                    className={styles.actionSecondary}
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
            <section aria-label="Agent map" className={styles.mapCard}>
              <span className={styles.mapNote}>{S.map.clickHint(queue.settings.order === 'waves' ? 6 : 5)}</span>
              <div className={styles.mapGrid}>
                <div className={styles.mapCol1}>
                  <div className={styles.runnerNode}>
                    <span className={styles.mapTitle}>
                      <span className={cx(styles.countDot, styles.dotInfo)} />
                      {mapVm.runner.title}
                    </span>
                    <span className={styles.mapSub}>{mapVm.runner.sub}</span>
                  </div>
                </div>

                <div className={styles.mapConnect} />

                <div className={styles.mapCol2}>
                  {mapVm.specNodes.map((node) => (
                    <div key={node.id} className={styles.mapBranchRow}>
                      <span className={styles.mapBranch} />
                      <button
                        type="button"
                        onClick={() => {
                          setSelectedId(node.id);
                          handleOpenInWork();
                        }}
                        className={cx(styles.mapNodeButton, mapVm.selectedId === node.id && styles.mapNodeSelected)}
                      >
                        <span className={styles.mapTitle}>
                          <span className={cx(styles.countDot, DOT_TONE[node.tone])} />
                          {node.title}
                        </span>
                        <span className={styles.mapSub}>{node.sub}</span>
                      </button>
                    </div>
                  ))}
                </div>

                <div className={styles.mapConnect} />

                <div className={styles.mapCol3}>
                  {mapVm.steps.map((step, idx) => (
                    <div key={idx} className={styles.mapBranchRow}>
                      <span className={styles.mapBranch} />
                      <div className={styles.stepNode}>
                        <span className={styles.mapTitle}>
                          <span className={cx(styles.countDot, DOT_TONE[step.tone])} />
                          {step.title}
                        </span>
                        <span className={styles.mapSub}>{step.sub}</span>
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              {mapVm.backgroundTasks.length > 0 && (
                <div className={styles.bgTasksSection}>
                  <span>
                    {mapVm.backgroundTasks.length === 1
                      ? S.map.backgroundTaskOne
                      : `${mapVm.backgroundTasks.length} background tasks`}
                  </span>
                  {mapVm.backgroundTasks.map((t) => (
                    <div key={t.id} className={styles.bgTaskCard}>
                      <span className={styles.mapTitle}>
                        <span className={cx(styles.countDot, styles.dotInfo)} />
                        {t.title}
                      </span>
                      <span className={styles.mapSub}>{t.sub}</span>
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

      {(!queue || queue.specs.length === 0) && problems.length === 0 && (
        <div className={styles.emptyView}>
          <span className={styles.emptyTitle}>{S.states.empty.title}</span>
          <span className={styles.emptyText}>{S.states.empty.description}</span>
        </div>
      )}
    </div>
  );
}
