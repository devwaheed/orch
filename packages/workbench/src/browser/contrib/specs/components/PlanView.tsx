/**
 * The Plan view: the spec queue as a dependency graph, with the same selection everywhere
 * (left list, graph, events strip and details). Pure data comes from ../planView.ts; this
 * file is layout, state and the small SVG charts.
 *
 * The graph and charts are inline SVG. They go through `Svg` (createElement) rather than a
 * JSX <svg> tag because design/lint reserves JSX SVG for the icon set; colours still come
 * only from CSS-module classes backed by design tokens.
 */
import {
  createElement,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
  type SVGProps,
} from 'react';
import type { Account, SpecQueue, SpecRun, SpecUsageHour } from '@orchagents/contracts';
import { Icon } from '../../../../../../../design/icons/Icon.js';
import type { IconName } from '../../../../../../../design/icons/icons.js';
import { useWorkbenchStore } from '../../../services/workbenchStore.js';
import { insertIntoTerminal } from '../../../parts/terminal/index.js';
import { specsServices } from '../services.js';
import { useSpecsUiStore } from '../stores/specsUi.js';
import { loadSpecUsage } from '../actions.js';
import {
  criterionByVMs,
  specStatus,
  type CriterionVM,
  type ToneName,
} from '../specsView.js';
import {
  agentBadge,
  affectedPath,
  axisTicks,
  clock,
  computeWaves,
  dependentsOf,
  groupLabel,
  historyRows,
  hourLabel,
  graphSpecs,
  layoutGraph,
  maxWave,
  planEvents,
  planGroups,
  progressPercent,
  shippedProgress,
  specGroup,
  stageRows,
  PLAN_GROUP_ORDER,
  type AgentBadge,
  type EventTone,
  type PlanGroup,
  type StageRow,
  type StageTone,
} from '../planView.js';
import { specStrings as S } from '../strings.js';
import styles from './PlanView.module.css';
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

const GROUP_DOT: Record<PlanGroup, string | undefined> = {
  coding: styles.dotInfo,
  review: styles.dotInfo,
  waiting: styles.dotErr,
  ready: styles.dotNeutral,
  blocked: styles.dotNeutral,
  shipped: styles.dotOk,
  skipped: styles.dotWarn,
};

const GROUP_NODE: Record<PlanGroup, string | undefined> = {
  coding: styles.nodeInfo,
  review: styles.nodeInfo,
  waiting: styles.nodeErr,
  ready: styles.nodeNeutral,
  blocked: styles.nodeNeutral,
  shipped: styles.nodeOk,
  skipped: styles.nodeWarn,
};

const STAGE_BAR: Record<StageTone, string | undefined> = {
  stable: styles.barStable,
  warning: styles.barWarning,
  critical: styles.barCritical,
};

const STAGE_SWATCH: Record<StageTone, string | undefined> = {
  stable: styles.swatchStable,
  warning: styles.swatchWarning,
  critical: styles.swatchCritical,
};

const MARKER_TONE: Record<EventTone, string | undefined> = {
  healthy: styles.markerHealthy,
  warning: styles.markerWarning,
  critical: styles.markerCritical,
};

const AGENT_TILE_CLASS: Record<AgentBadge['tile'], string | undefined> = {
  cc: styles.agentCc,
  cx: styles.agentCx,
  gm: styles.agentGm,
  oc: styles.agentOc,
  ag: styles.agentAg,
};

const CRITERION_ICON: Record<CriterionVM['state'], IconName> = {
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

type PlanTab = 'overview' | 'needs' | 'events';

type SvgRootProps = SVGProps<SVGSVGElement> & { readonly children?: ReactNode };

/** The one place the Plan view draws <svg>; see the file header. */
function Svg({ children, ...rest }: SvgRootProps) {
  return createElement('svg', rest, children);
}

interface PlanViewProps {
  readonly queue: SpecQueue;
  readonly accounts: readonly Account[];
}

export function PlanView({ queue, accounts }: PlanViewProps) {
  const selectedId = useSpecsUiStore((s) => s.selectedId);
  const setSelectedId = useSpecsUiStore((s) => s.setSelectedId);
  const planSearch = useSpecsUiStore((s) => s.planSearch);
  const setPlanSearch = useSpecsUiStore((s) => s.setPlanSearch);
  const affectedOnly = useSpecsUiStore((s) => s.affectedOnly);
  const setAffectedOnly = useSpecsUiStore((s) => s.setAffectedOnly);
  const layers = useSpecsUiStore((s) => s.layers);
  const setLayer = useSpecsUiStore((s) => s.setLayer);

  const [zoom, setZoom] = useState(1);
  const [tab, setTab] = useState<PlanTab>('overview');
  const [usage, setUsage] = useState<readonly SpecUsageHour[] | null>(null);
  const [usageError, setUsageError] = useState<string | null>(null);
  const [inserted, setInserted] = useState<{ readonly text: string; readonly undo: (() => void) | null } | null>(null);

  const advance = queue.settings.advance;
  const now = useMemo(() => new Date(), [queue]);

  const ordered = useMemo(
    () => [...queue.specs].sort((a, b) => a.position - b.position),
    [queue.specs],
  );
  const byId = useMemo(() => new Map<string, SpecRun>(queue.specs.map((spec) => [spec.id, spec])), [queue.specs]);
  const waves = useMemo(() => computeWaves(queue.specs), [queue.specs]);
  const max = useMemo(() => maxWave(waves), [waves]);
  const groups = useMemo(
    () => planGroups(queue.specs, advance, planSearch),
    [queue.specs, advance, planSearch],
  );
  const groupById = useMemo(
    () => new Map<string, PlanGroup>(queue.specs.map((spec) => [spec.id, specGroup(spec, queue.specs, advance)])),
    [queue.specs, advance],
  );

  const defaultId = useMemo(() => {
    const coding = ordered.find((spec) => groupById.get(spec.id) === 'coding');
    if (coding) return coding.id;
    const nonShipped = ordered.find((spec) => groupById.get(spec.id) !== 'shipped');
    return nonShipped?.id ?? ordered[0]?.id ?? null;
  }, [ordered, groupById]);

  const resolvedId = selectedId && byId.has(selectedId) ? selectedId : defaultId;
  const selected = resolvedId ? byId.get(resolvedId) ?? null : null;

  useEffect(() => {
    if (resolvedId && resolvedId !== selectedId) setSelectedId(resolvedId);
  }, [resolvedId, selectedId, setSelectedId]);

  // Picking a spec in the list or the events strip brings its node into view.
  const graphScroll = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    if (!resolvedId) return;
    graphScroll.current?.querySelector(`[data-spec-node="${resolvedId}"]`)?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  }, [resolvedId]);

  useEffect(() => {
    if (!selected) {
      setUsage(null);
      setUsageError(null);
      return undefined;
    }
    const services = specsServices();
    if (!services) {
      setUsage(null);
      setUsageError(null);
      return undefined;
    }
    let stale = false;
    setUsage(null);
    setUsageError(null);
    void loadSpecUsage(services.specs, queue.id, selected.id).then((reply) => {
      if (stale) return;
      if (!reply.ok) {
        setUsage([]);
        setUsageError(reply.error.message);
        return;
      }
      setUsage(reply.value);
    });
    return () => {
      stale = true;
    };
  }, [queue.id, selected?.id]);

  const visibleCount = groups.reduce((count, section) => count + section.specs.length, 0);
  const shipped = shippedProgress(queue.specs);
  const events = useMemo(
    () => planEvents(queue.specs, advance, now),
    [queue.specs, advance, now],
  );
  const ticks = axisTicks(now);
  const layout = useMemo(
    () => layoutGraph(layers.shipped ? queue.specs : graphSpecs(queue.specs), waves),
    [queue.specs, waves, layers.shipped],
  );
  const pathIds = useMemo(
    () => affectedPath(queue.specs, selected?.id ?? null),
    [queue.specs, selected?.id],
  );

  const selectedGroup = selected ? groupById.get(selected.id) ?? 'blocked' : null;
  const selectedWave = selected ? waves.get(selected.id) ?? 1 : 0;
  const selectedStatus = selected ? specStatus(selected, queue.specs, advance) : null;
  const selectedPct = selected ? progressPercent(selected) : 0;
  const selectedUsage = usage ?? [];
  const unblocks = selected ? dependentsOf(queue.specs, selected.id) : [];
  const reviewer = selected?.criteria.find((criterion) => criterion.auditor)?.auditor ?? null;
  const criteria = selected ? criterionByVMs(selected) : [];
  const history = selected ? historyRows(selected, queue.specs, advance) : [];

  const handleInsert = (spec: SpecRun) => {
    const text = `@${spec.file} `;
    setInserted({ text, undo: insertIntoTerminal(text) });
  };

  const handleUndo = () => {
    inserted?.undo?.();
    setInserted(null);
  };

  const openInWork = (spec: SpecRun) => {
    setSelectedId(spec.id);
    useWorkbenchStore.getState().setActiveArea('work');
  };

  return (
    <div className={styles.plan}>
      <aside className={styles.left} aria-label={S.title}>
        <div className={styles.leftHead}>
          <span className={styles.leftTitle}>{S.title}</span>
          <span className={styles.leftCount}>{S.plan.inPlan(visibleCount)}</span>
        </div>
        <input
          type="search"
          className={styles.search}
          placeholder={S.plan.searchPlaceholder}
          aria-label={S.plan.searchPlaceholder}
          value={planSearch}
          onChange={(event) => setPlanSearch(event.target.value)}
        />

        <div className={styles.groupList}>
          {groups.map((section) => (
            <section key={section.group} className={styles.groupSection}>
              <h3 className={styles.groupHeading}>
                {S.plan.groupHeading(section.label, section.specs.length)}
              </h3>
              {section.specs.map((spec) => {
                const status = specStatus(spec, queue.specs, advance);
                const wave = waves.get(spec.id) ?? 1;
                return (
                  <button
                    key={spec.id}
                    type="button"
                    onClick={() => setSelectedId(spec.id)}
                    aria-pressed={selected?.id === spec.id}
                    className={cx(styles.row, selected?.id === spec.id && styles.rowSelected)}
                  >
                    <span className={styles.rowLine}>
                      <span className={styles.rowId}>{spec.id}</span>
                      <span className={styles.rowTitle}>{spec.spec.title}</span>
                    </span>
                    <span className={styles.rowMeta}>
                      <span className={styles.waveChip}>{S.plan.waveChip(wave)}</span>
                      <span className={cx(styles.pill, PILL_TONE[status.tone])}>
                        <span className={cx(styles.pillDot, DOT_TONE[status.tone])} />
                        {status.pill}
                      </span>
                    </span>
                  </button>
                );
              })}
            </section>
          ))}
        </div>

        <div className={styles.leftFoot}>
          <label className={styles.check}>
            <input
              type="checkbox"
              checked={affectedOnly}
              onChange={(event) => setAffectedOnly(event.target.checked)}
            />
            {S.plan.affectedOnly}
          </label>

          <span className={styles.layersTitle}>{S.plan.viewLayers}</span>
          {(['wires', 'waves', 'agents', 'shipped'] as const).map((layer) => (
            <label key={layer} className={styles.check}>
              <input type="checkbox" checked={layers[layer]} onChange={(event) => setLayer(layer, event.target.checked)} />
              {S.plan.layers[layer]}
            </label>
          ))}

          <div className={styles.shippedRow}>
            <span>{S.plan.shipped}</span>
            <span className={styles.shippedPct}>{S.plan.shippedPct(shipped.pct)}</span>
          </div>
          <div
            className={styles.shippedTrack}
            role="progressbar"
            aria-valuenow={shipped.pct}
            aria-valuemin={0}
            aria-valuemax={100}
            aria-label={S.plan.shipped}
          >
            <span
              className={styles.shippedFill}
              style={{ '--progress': `${shipped.pct}%` } as CSSProperties}
            />
          </div>
        </div>
      </aside>

      <section className={styles.center} aria-label={S.plan.wirePlan}>
        <header className={styles.centerHead}>
          <h2 className={styles.centerTitle}>{S.plan.wirePlan}</h2>

          <div className={styles.legend}>
            {PLAN_GROUP_ORDER.map((group) => (
              <span key={group} className={styles.legendItem}>
                <span className={cx(styles.legendDot, GROUP_DOT[group])} />
                {groupLabel(group)}
              </span>
            ))}
          </div>

          <div className={styles.headActions}>
            <button
              type="button"
              className={styles.insertButton}
              disabled={!selected}
              onClick={() => selected && handleInsert(selected)}
            >
              <Icon name="terminal" size={12} weight={2} />
              {selected ? S.plan.insertInTerminal(selected.id) : S.plan.insertInTerminal('')}
            </button>
            <div className={styles.zoomGroup} role="group">
              <button
                type="button"
                aria-label={S.plan.zoomOut}
                className={styles.zoomButton}
                onClick={() => setZoom((value) => Math.max(0.5, Number((value - 0.2).toFixed(1))))}
              >
                −
              </button>
              <button
                type="button"
                aria-label={S.plan.zoomIn}
                className={styles.zoomButton}
                onClick={() => setZoom((value) => Math.min(2, Number((value + 0.2).toFixed(1))))}
              >
                +
              </button>
              <button
                type="button"
                aria-label={S.plan.fit}
                className={styles.zoomButton}
                onClick={() => setZoom(1)}
              >
                {S.plan.fit}
              </button>
            </div>
          </div>
        </header>

        <div ref={graphScroll} className={styles.graphScroll}>
          <div
            className={styles.graphCanvas}
            style={
              {
                '--graph-width': `${Math.ceil(layout.width * zoom)}px`,
                '--graph-height': `${Math.ceil(layout.height * zoom)}px`,
              } as CSSProperties
            }
          >
            <Svg
              className={styles.graphSvg}
              viewBox={`0 0 ${layout.width} ${layout.height}`}
              role="img"
              aria-label={S.plan.wirePlan}
            >
              {layers.waves &&
                Array.from({ length: layout.maxWave }, (_, index) => {
                  const wave = index + 1;
                  return (
                    <text
                      key={`wave-${wave}`}
                      x={8}
                      y={22 + index * 94 + 32}
                      className={styles.waveLabel}
                    >
                      {S.plan.waveChip(wave)}
                    </text>
                  );
                })}

              {layers.wires &&
                layout.wires.map((wire) => {
                  const [fromId] = wire.key.split('->');
                  const dim = affectedOnly && (!fromId || !pathIds.has(fromId));
                  return (
                    <path
                      key={wire.key}
                      d={wire.d}
                      className={cx(
                        styles.wire,
                        wire.merged ? styles.wireMerged : styles.wireOpen,
                        dim && styles.dimmed,
                      )}
                    />
                  );
                })}

              {layout.nodes.map((node) => {
                const group = groupById.get(node.spec.id) ?? 'blocked';
                const badge = agentBadge(node.spec);
                const isSelected = selected?.id === node.spec.id;
                const dim = affectedOnly && !pathIds.has(node.spec.id);
                return (
                  <g
                    data-spec-node={node.spec.id}
                    key={node.spec.id}
                    role="button"
                    tabIndex={0}
                    aria-label={S.plan.nodeLabel(node.spec.id, node.spec.spec.title, groupLabel(group))}
                    className={cx(
                      styles.node,
                      GROUP_NODE[group],
                      isSelected && styles.nodeSelected,
                      dim && styles.dimmed,
                    )}
                    onClick={() => setSelectedId(node.spec.id)}
                    onDoubleClick={() => openInWork(node.spec)}
                    onKeyDown={(event) => {
                      if (event.key === 'Enter' || event.key === ' ') {
                        event.preventDefault();
                        setSelectedId(node.spec.id);
                      }
                    }}
                  >
                    <rect
                      x={node.x}
                      y={node.y}
                      width={76}
                      height={64}
                      rx={11}
                      className={styles.nodeRect}
                    />
                    <text
                      x={node.x + 38}
                      y={node.y + 26}
                      textAnchor="middle"
                      className={styles.nodeId}
                    >
                      {node.spec.id}
                    </text>
                    {layers.agents && badge && (
                      <g>
                        <rect
                          x={node.x + 26}
                          y={node.y + 34}
                          width={24}
                          height={16}
                          rx={4}
                          className={cx(styles.agentTile, AGENT_TILE_CLASS[badge.tile])}
                        />
                        <text
                          x={node.x + 38}
                          y={node.y + 45}
                          textAnchor="middle"
                          className={styles.agentMono}
                        >
                          {badge.mono}
                        </text>
                      </g>
                    )}
                  </g>
                );
              })}
            </Svg>
          </div>
        </div>

        {inserted && (
          <div className={styles.insertBar}>
            <span className={styles.insertLabel}>{S.plan.inserted}</span>
            <code className={styles.insertText}>{inserted.text}</code>
            <button type="button" className={styles.undoButton} onClick={handleUndo}>
              {S.plan.undo}
            </button>
          </div>
        )}

        <section className={styles.events} aria-label={S.plan.events}>
          <div className={styles.eventsHead}>
            <div className={styles.eventsTitles}>
              <span className={styles.eventsTitle}>{S.plan.events}</span>
              <span className={styles.eventsSub}>{S.plan.last24}</span>
            </div>
            <div className={styles.chartLegend}>
              {(['healthy', 'warning', 'critical'] as const).map((tone) => (
                <span key={tone} className={styles.legendItem}>
                  <span className={cx(styles.legendDot, MARKER_TONE[tone])} />
                  {tone === 'healthy' ? S.plan.healthy : tone === 'warning' ? S.plan.warning : S.plan.critical}
                </span>
              ))}
            </div>
          </div>

          <div className={styles.axis}>
            {ticks.map((tick, index) => (
              <span
                key={`tick-${index}`}
                className={styles.axisLabel}
                style={{ '--pct': `${tick.pct}%` } as CSSProperties}
              >
                {tick.label}
              </span>
            ))}
            {events.map((event, index) => {
              const title = S.plan.eventTitle(event.id, event.title, groupLabel(event.group), clock(event.at));
              return (
                <button
                  key={`${event.id}-${event.at}-${index}`}
                  type="button"
                  className={cx(styles.marker, MARKER_TONE[event.tone])}
                  style={{ '--pct': `${event.xPct}%` } as CSSProperties}
                  title={title}
                  aria-label={title}
                  onClick={() => setSelectedId(event.id)}
                />
              );
            })}
          </div>
          {events.length === 0 && <p className={styles.eventsEmpty}>{S.plan.noEvents}</p>}
        </section>
      </section>

      <aside className={styles.right} aria-label={selected ? S.plan.detailLabel(selected.id, selected.spec.title) : S.title}>
        {selected && selectedGroup && selectedStatus ? (
          <>
            <div className={styles.detailHead}>
              <h2 className={styles.detailTitle}>
                <span className={styles.detailId}>{selected.id}</span> {selected.spec.title}
              </h2>
              <span className={styles.detailGroup}>
                <span className={cx(styles.legendDot, GROUP_DOT[selectedGroup])} />
                {groupLabel(selectedGroup)}
              </span>
              <div className={styles.bigPct}>{S.plan.shippedPct(selectedPct)}</div>
              <span className={styles.waveOf}>{S.plan.waveOf(selectedWave, max)}</span>
              {selectedUsage.length > 0 && <Sparkline usage={selectedUsage} />}
            </div>

            {selectedStatus.secondLine.length > 0 && (
              <div className={styles.infoBox}>{selectedStatus.secondLine}</div>
            )}

            <dl className={styles.facts}>
              <div className={styles.fact}>
                <dt>{S.plan.worktree}</dt>
                <dd className={styles.mono}>{selected.worktree ?? S.plan.noneYet}</dd>
              </div>
              <div className={styles.fact}>
                <dt>{S.plan.coder}</dt>
                <dd>
                  {selected.implementer
                    ? `${S.agentName(selected.implementer.agent)} · ${accountName(accounts, selected.implementer.accountId)}`
                    : S.plan.notAssigned}
                </dd>
              </div>
              <div className={styles.fact}>
                <dt>{S.plan.reviewer}</dt>
                <dd>
                  {reviewer
                    ? `${S.agentName(reviewer.agent)} · ${accountName(accounts, reviewer.accountId)}`
                    : S.plan.notAssigned}
                </dd>
              </div>
              <div className={styles.fact}>
                <dt>{S.plan.dependsOn}</dt>
                <dd className={styles.mono}>
                  {selected.spec.depends_on.length > 0
                    ? selected.spec.depends_on.map((id) => (
                        <button
                          key={id}
                          type="button"
                          className={styles.linkButton}
                          onClick={() => setSelectedId(id)}
                        >
                          {id}
                        </button>
                      ))
                    : S.plan.none}
                </dd>
              </div>
              <div className={styles.fact}>
                <dt>{S.plan.unblocks}</dt>
                <dd>
                  {unblocks.length > 0
                    ? unblocks.map((id) => (
                        <button
                          key={id}
                          type="button"
                          className={styles.linkButton}
                          onClick={() => setSelectedId(id)}
                        >
                          {id}
                        </button>
                      ))
                    : S.plan.none}
                </dd>
              </div>
            </dl>

            <button
              type="button"
              className={styles.insertFileButton}
              onClick={() => handleInsert(selected)}
            >
              <Icon name="terminal" size={12} weight={2} />
              {S.plan.insertFile(selected.file)}
            </button>

            <div role="tablist" aria-label={S.title} className={styles.tabs}>
              {(['overview', 'needs', 'events'] as const).map((key) => (
                <button
                  key={key}
                  type="button"
                  role="tab"
                  aria-selected={tab === key}
                  className={cx(styles.tab, tab === key && styles.tabActive)}
                  onClick={() => setTab(key)}
                >
                  {S.plan.tabs[key]}
                </button>
              ))}
            </div>

            <div className={styles.tabPanel} role="tabpanel">
              {tab === 'overview' && (
                <>
                  {usageError && (
                    <div role="alert" className={styles.chartError}>
                      {usageError}
                    </div>
                  )}
                  <StageChart rows={stageRows(selected, now)} />
                  <CostChart usage={usage} />
                </>
              )}

              {tab === 'needs' && (
                <div className={styles.criteriaColumn}>
                  <span className={styles.criteriaTitle}>{S.row.doneWhen}</span>
                  {criteria.map((criterion, index) => (
                    <div key={index} className={styles.criterionRow}>
                      <Icon
                        name={CRITERION_ICON[criterion.state]}
                        size={14}
                        weight={2.3}
                        className={cx(styles.criterionIcon, CRITERION_TONE[criterion.tone])}
                      />
                      <span className={styles.criterionText}>{criterion.text}</span>
                      <span className={styles.criterionBy}>{criterion.by}</span>
                    </div>
                  ))}
                </div>
              )}

              {tab === 'events' && (
                <div className={styles.historyList}>
                  {history.map((row) => (
                    <span key={row.key} className={styles.historyRow}>
                      {S.plan.eventRow(row.time, groupLabel(row.group), row.attempt)}
                    </span>
                  ))}
                </div>
              )}
            </div>
          </>
        ) : null}
      </aside>
    </div>
  );
}

function accountName(accounts: readonly Account[], id: string): string {
  const account = accounts.find((entry) => entry.id === id);
  return account ? account.name : id;
}

function Sparkline({ usage }: { readonly usage: readonly SpecUsageHour[] }) {
  const width = 200;
  const height = 28;
  const max = Math.max(...usage.map((hour) => hour.tokens), 1);
  const points = usage.map((hour, index) => ({
    x: usage.length === 1 ? width / 2 : (index / (usage.length - 1)) * width,
    y: height - (hour.tokens / max) * height,
  }));
  const d = points.map((point, index) => `${index === 0 ? 'M' : 'L'} ${point.x} ${point.y}`).join(' ');
  return (
    <Svg className={styles.sparkline} viewBox={`0 0 ${width} ${height}`} aria-hidden="true">
      <path d={d} className={styles.sparkLine} />
    </Svg>
  );
}

function StageChart({ rows }: { readonly rows: readonly StageRow[] }) {
  const width = 288;
  const height = 112;
  const chartHeight = 68;
  const baseY = 86;
  const max = Math.max(1, ...rows.map((row) => row.minutes));
  const slot = width / rows.length;
  return (
    <div className={styles.chartBlock}>
      <h4 className={styles.chartTitle}>{S.plan.timePerStage}</h4>
      <Svg
        className={styles.chartSvg}
        viewBox={`0 0 ${width} ${height}`}
        role="img"
        aria-label={S.plan.timePerStage}
      >
        <line x1={0} x2={width} y1={baseY} y2={baseY} className={styles.chartAxis} />
        {rows.map((row, index) => {
          const barWidth = 28;
          const x = index * slot + (slot - barWidth) / 2;
          const barHeight = (row.minutes / max) * chartHeight;
          const y = baseY - barHeight;
          return (
            <g key={row.stage}>
              <rect
                x={x}
                y={y}
                width={barWidth}
                height={barHeight}
                rx={3}
                className={cx(styles.stageBar, STAGE_BAR[row.tone])}
              />
              <text x={x + barWidth / 2} y={y - 4} textAnchor="middle" className={styles.stageValue}>
                {row.minutes}
              </text>
              <text
                x={x + barWidth / 2}
                y={baseY + 14}
                textAnchor="middle"
                className={styles.stageLabel}
              >
                {row.label}
              </text>
            </g>
          );
        })}
      </Svg>
      <div className={styles.chartLegend}>
        {(['stable', 'warning', 'critical'] as const).map((tone) => (
          <span key={tone} className={styles.legendItem}>
            <span className={cx(styles.legendSwatch, STAGE_SWATCH[tone])} />
            {tone === 'stable' ? S.plan.stable : tone === 'warning' ? S.plan.warning : S.plan.critical}
          </span>
        ))}
      </div>
    </div>
  );
}

function CostChart({ usage }: { readonly usage: readonly SpecUsageHour[] | null }) {
  const heading = <h4 className={styles.chartTitle}>{S.plan.costByHour}</h4>;
  if (!usage || usage.length === 0) {
    return (
      <div className={styles.chartBlock}>
        {heading}
        <p className={styles.chartEmpty}>{S.plan.noRuns}</p>
      </div>
    );
  }

  const width = 288;
  const height = 104;
  const padLeft = 30;
  const padRight = 8;
  const padTop = 8;
  const padBottom = 20;
  const innerWidth = width - padLeft - padRight;
  const innerHeight = height - padTop - padBottom;
  const max = Math.max(...usage.map((hour) => hour.usd), 0);
  const yMax = max > 0 ? max : 1;
  const points = usage.map((hour, index) => ({
    x: padLeft + (usage.length === 1 ? innerWidth / 2 : (index / (usage.length - 1)) * innerWidth),
    y: padTop + innerHeight - (hour.usd / yMax) * innerHeight,
  }));
  const first = points[0];
  const last = points.at(-1);
  const line = points.map((point, index) => `${index === 0 ? 'M' : 'L'} ${point.x} ${point.y}`).join(' ');
  const area =
    first && last
      ? `M ${first.x} ${padTop + innerHeight} L ${points
          .map((point) => `${point.x} ${point.y}`)
          .join(' L ')} L ${last.x} ${padTop + innerHeight} Z`
      : '';
  const labelIndexes =
    usage.length <= 4 ? usage.map((_, index) => index) : [0, Math.floor((usage.length - 1) / 2), usage.length - 1];

  return (
    <div className={styles.chartBlock}>
      {heading}
      <Svg
        className={styles.chartSvg}
        viewBox={`0 0 ${width} ${height}`}
        role="img"
        aria-label={S.plan.costByHour}
      >
        <line
          x1={padLeft}
          x2={width - padRight}
          y1={padTop + innerHeight}
          y2={padTop + innerHeight}
          className={styles.chartAxis}
        />
        <text x={0} y={padTop + 4} className={styles.axisValue}>
          {max.toFixed(2)}
        </text>
        <text x={0} y={padTop + innerHeight + 4} className={styles.axisValue}>
          0
        </text>
        {area && <path d={area} className={styles.costArea} />}
        {line && <path d={line} className={styles.costLine} />}
        {points.map((point, index) => (
          <circle key={`point-${index}`} cx={point.x} cy={point.y} r={2} className={styles.costDot} />
        ))}
        {labelIndexes.map((index) => {
          const hour = usage[index];
          const point = points[index];
          if (!hour || !point) return null;
          return (
            <text
              key={`label-${index}`}
              x={point.x}
              y={height - 4}
              textAnchor={index === usage.length - 1 ? 'end' : index === 0 ? 'start' : 'middle'}
              className={styles.axisValue}
            >
              {hourLabel(Date.parse(hour.hour))}
            </text>
          );
        })}
      </Svg>
    </div>
  );
}
