/**
 * The Plan view: the spec queue as a dependency graph, with the same selection everywhere
 * (left list, graph, events strip and details). Pure data comes from ../planView.ts; this
 * file is layout, state and the small SVG charts.
 *
 * The graph and charts are inline SVG. They go through `Svg` (createElement) rather than a
 * JSX <svg> tag because design/lint reserves JSX SVG for the icon set; colours still come
 * only from Tailwind utilities backed by design tokens.
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
import { loadSpecUsage, retrySpec, skipSpec } from '../actions.js';
import {
  criterionByVMs,
  formatTokens,
  specStatus,
  type CriterionVM,
  type ToneName,
} from '../specsView.js';
import { findFactoryStory } from '../factoryView.js';
import {
  agentBadge,
  affectedPath,
  axisTicks,
  clock,
  computeWaves,
  defaultPlanSpec,
  dependentsOf,
  groupLabel,
  historyRows,
  hourLabel,
  graphSpecs,
  layoutGraph,
  maxWave,
  planDuration,
  planEvents,
  planGroups,
  progressPercent,
  shippedProgress,
  specActions,
  specGroup,
  stageRows,
  GRAPH_NODE,
  PLAN_GROUP_ORDER,
  type AgentBadge,
  type EventTone,
  type PlanAction,
  type PlanGroup,
  type StageRow,
  type StageTone,
} from '../planView.js';
import { specStrings as S } from '../strings.js';
import { cx } from './cx.js';

/** The 2px focus ring every control in this view shares. */
const FOCUS = 'focus-visible:outline-2 focus-visible:outline-focus focus-visible:outline-offset-2';

const PILL_BASE = 'inline-flex items-center gap-5px whitespace-nowrap rounded-pill px-5px py-1px text-2xs';

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

const GROUP_DOT: Record<PlanGroup, string> = {
  coding: 'bg-info-dot',
  review: 'bg-info-dot',
  waiting: 'bg-err-dot',
  ready: 'bg-faint',
  blocked: 'bg-faint',
  shipped: 'bg-ok-dot',
  skipped: 'bg-warn-solid',
};

const GROUP_NODE: Record<PlanGroup, string | undefined> = {
  coding: 'drop-shadow-[0_0_6px_var(--info-line)]',
  review: 'drop-shadow-[0_0_6px_var(--info-line)]',
  waiting: 'drop-shadow-[0_0_6px_var(--err-line)]',
  ready: undefined,
  blocked: undefined,
  shipped: 'drop-shadow-[0_0_6px_var(--ok-dot)]',
  skipped: 'drop-shadow-[0_0_6px_var(--warn-line)]',
};

const GROUP_STROKE: Record<PlanGroup, string> = {
  coding: 'stroke-info-dot',
  review: 'stroke-info-dot',
  waiting: 'stroke-err-dot',
  ready: 'stroke-strongline',
  blocked: 'stroke-strongline',
  shipped: 'stroke-ok-dot',
  skipped: 'stroke-warn-solid',
};

const STAGE_BAR: Record<StageTone, string> = {
  stable: 'fill-info-dot',
  warning: 'fill-warn-solid',
  critical: 'fill-err-dot',
};

const STAGE_SWATCH: Record<StageTone, string> = {
  stable: 'bg-info-dot',
  warning: 'bg-warn-solid',
  critical: 'bg-err-dot',
};

/** The diamond behind an event marker. */
const MARKER_TONE: Record<EventTone, string> = {
  healthy: 'after:bg-ok-dot',
  warning: 'after:bg-warn-solid',
  critical: 'after:bg-err-dot',
};

/** The legend dot that matches an event marker. */
const LEGEND_TONE: Record<EventTone, string> = {
  healthy: 'bg-ok-dot',
  warning: 'bg-warn-solid',
  critical: 'bg-err-dot',
};

const AGENT_TILE_CLASS: Record<AgentBadge['tile'], string> = {
  cc: 'fill-cc-bg',
  cx: 'fill-cx-bg',
  gm: 'fill-gm-bg',
  oc: 'fill-oc-bg',
  ag: 'fill-ag-bg',
};

const AGENT_TILE_TEXT: Record<AgentBadge['tile'], string> = {
  cc: 'fill-cc-fg',
  cx: 'fill-cx-fg',
  gm: 'fill-gm-fg',
  oc: 'fill-oc-fg',
  ag: 'fill-ag-fg',
};

const CRITERION_ICON: Record<CriterionVM['state'], IconName> = {
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

const ACTION_ICON: Record<PlanAction, IconName> = {
  retry: 'sync',
  skip: 'chevRight',
  review: 'review',
  openInWork: 'terminal',
};

const ACTION_LABEL: Record<PlanAction, string> = {
  retry: S.row.retry,
  skip: S.row.skip,
  review: S.plan.review,
  openInWork: S.row.openInWork,
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
  const factoryStatus = useSpecsUiStore((s) => s.factoryStatus);

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

  const defaultId = useMemo(() => defaultPlanSpec(ordered, groupById), [ordered, groupById]);

  const resolvedId = selectedId && byId.has(selectedId) ? selectedId : defaultId;
  const selected = resolvedId ? byId.get(resolvedId) ?? null : null;

  useEffect(() => {
    if (resolvedId && resolvedId !== selectedId) setSelectedId(resolvedId);
  }, [resolvedId, selectedId, setSelectedId]);

  // Picking a spec in the list or the events strip brings its node into view. Scroll only
  // the graph container (not the page) so this also works the first time the view opens.
  const graphScroll = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    const container = graphScroll.current;
    if (!container || !resolvedId) return;
    const node = container.querySelector(`[data-spec-node="${resolvedId}"]`);
    if (!node) return;
    const box = container.getBoundingClientRect();
    const rect = node.getBoundingClientRect();
    if (rect.top < box.top) container.scrollTop -= box.top - rect.top;
    else if (rect.bottom > box.bottom) container.scrollTop += rect.bottom - box.bottom;
    if (rect.left < box.left) container.scrollLeft -= box.left - rect.left;
    else if (rect.right > box.right) container.scrollLeft += rect.right - box.right;
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
  const factoryStory = selected ? findFactoryStory(factoryStatus, selected.file) : null;
  const actions = selected ? specActions(selected.state) : [];
  const usageTokens = selectedUsage.reduce((sum, hour) => sum + hour.tokens, 0);
  const usageUsd = selectedUsage.reduce((sum, hour) => sum + hour.usd, 0);
  const summary = selected?.startedAt
    ? [
        planDuration(selected.startedAt, selected.finishedAt, now),
        usageTokens > 0 ? `${formatTokens(usageTokens)} tokens` : '',
        usageUsd > 0 ? `$${usageUsd.toFixed(2)}` : '',
      ]
        .filter((part) => part !== '')
        .join(' · ')
    : '';

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

  const handleRetry = (spec: SpecRun) => {
    const services = specsServices();
    if (services) void retrySpec(services.specs, queue.id, spec.id);
  };

  const handleSkip = (spec: SpecRun) => {
    const services = specsServices();
    if (services) void skipSpec(services.specs, queue.id, spec.id);
  };

  const handleAction = (action: PlanAction, spec: SpecRun) => {
    switch (action) {
      case 'retry':
        handleRetry(spec);
        return;
      case 'skip':
        handleSkip(spec);
        return;
      case 'review':
        useWorkbenchStore.getState().setActiveArea('review');
        return;
      case 'openInWork':
        openInWork(spec);
        return;
    }
  };

  return (
    <div className="flex min-h-0 min-w-0 flex-auto overflow-hidden rounded-xl border border-line bg-panel in-data-[menu-side=right]:flex-row-reverse">
      <aside
        className="flex min-h-0 shrink-0 grow-0 basis-[240px] flex-col overflow-y-auto border-r border-line in-data-[menu-side=right]:border-l in-data-[menu-side=right]:border-r-0"
        aria-label={S.title}
      >
        <div className="flex items-baseline justify-between gap-2 px-5 pb-2 pt-4">
          <span className="text-lg font-semibold text-text">{S.title}</span>
          <span className="text-xs text-muted2">{S.plan.inPlan(visibleCount)}</span>
        </div>
        <input
          type="search"
          className="mx-5 mb-2 mt-0 min-h-hit-min rounded-md border border-btnline bg-panel2 px-4 py-2 font-sans text-sm text-text focus-visible:outline-2 focus-visible:outline-focus focus-visible:outline-offset-1 placeholder:text-faint2"
          placeholder={S.plan.searchPlaceholder}
          aria-label={S.plan.searchPlaceholder}
          value={planSearch}
          onChange={(event) => setPlanSearch(event.target.value)}
        />

        <div className="flex flex-[1_0_auto] flex-col gap-2 px-2 pb-3">
          {groups.map((section) => (
            <section key={section.group} className="flex flex-col gap-1px">
              <h3 className="m-0 px-3 pb-1px pt-2 text-2xs font-semibold uppercase tracking-[0.04em] text-muted2">
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
                    className={cx(
                      'flex min-h-[42px] w-full cursor-pointer flex-col gap-1px rounded-md border px-3 py-2 text-left text-base text-text hover:bg-rowsel',
                      'focus-visible:-outline-offset-1 focus-visible:outline-2 focus-visible:outline-focus',
                      selected?.id === spec.id ? 'border-accent bg-sel' : 'border-transparent bg-transparent',
                    )}
                  >
                    <span className="flex min-w-0 items-baseline gap-2">
                      <span className="flex-none font-mono text-xs text-muted2">{spec.id}</span>
                      <span className="min-w-0 truncate text-12p5 text-text2">{spec.spec.title}</span>
                    </span>
                    <span className="flex flex-wrap items-center gap-2 pl-4">
                      <span className="rounded-xs bg-neutral px-1px font-mono text-2xs text-text3">
                        {S.plan.waveChip(wave)}
                      </span>
                      <span className={cx(PILL_BASE, PILL_TONE[status.tone])}>
                        <span className={cx('h-2 w-2 rounded-full', DOT_TONE[status.tone])} />
                        {status.pill}
                      </span>
                    </span>
                  </button>
                );
              })}
            </section>
          ))}
        </div>

        <div className="flex flex-none flex-col gap-2 border-t border-line2 bg-panel2 px-4 py-3">
          <label className="flex min-h-hit-min cursor-pointer items-center gap-2 text-xs text-text2">
            <input
              type="checkbox"
              className="accent-accent"
              checked={affectedOnly}
              onChange={(event) => setAffectedOnly(event.target.checked)}
            />
            {S.plan.affectedOnly}
          </label>

          <span className="mt-1 text-2xs font-semibold tracking-[0.04em] text-muted2">{S.plan.viewLayers}</span>
          {(['wires', 'waves', 'agents', 'shipped'] as const).map((layer) => (
            <label key={layer} className="flex min-h-hit-min cursor-pointer items-center gap-2 text-xs text-text2">
              <input
                type="checkbox"
                className="accent-accent"
                checked={layers[layer]}
                onChange={(event) => setLayer(layer, event.target.checked)}
              />
              {S.plan.layers[layer]}
            </label>
          ))}

          <div className="mt-2 flex items-center justify-between text-xs text-muted2">
            <span>{S.plan.shipped}</span>
            <span className="font-mono text-text2">{S.plan.shippedPct(shipped.pct)}</span>
          </div>
          <div
            className="h-1 overflow-hidden rounded-pill bg-line"
            role="progressbar"
            aria-valuenow={shipped.pct}
            aria-valuemin={0}
            aria-valuemax={100}
            aria-label={S.plan.shipped}
          >
            <span
              className="block h-full w-(--progress) rounded-pill bg-ok-dot"
              style={{ '--progress': `${shipped.pct}%` } as CSSProperties}
            />
          </div>
        </div>
      </aside>

      <section className="flex min-h-0 min-w-0 flex-auto flex-col overflow-hidden bg-panel" aria-label={S.plan.wirePlan}>
        <header className="flex flex-none flex-wrap items-center gap-3 border-b border-line2 px-5 py-4">
          <h2 className="m-0 text-md font-semibold text-text">{S.plan.wirePlan}</h2>

          <div className="flex flex-wrap items-center gap-x-3 gap-y-2 text-2xs text-muted2">
            {PLAN_GROUP_ORDER.map((group) => (
              <span key={group} className="inline-flex items-center gap-1px whitespace-nowrap">
                <span className={cx('h-2 w-2 rounded-full', GROUP_DOT[group])} />
                {groupLabel(group)}
              </span>
            ))}
          </div>

          <div className="ml-auto flex items-center gap-2">
            <div className="flex items-center gap-1px rounded-md border border-line bg-panel2 p-1px" role="group">
              <button
                type="button"
                aria-label={S.plan.zoomOut}
                className={cx(
                  'min-h-hit-min min-w-hit-min cursor-pointer rounded-sm border-0 bg-transparent px-2 py-1 text-sm text-text2',
                  FOCUS,
                )}
                onClick={() => setZoom((value) => Math.max(0.5, Number((value - 0.2).toFixed(1))))}
              >
                −
              </button>
              <button
                type="button"
                aria-label={S.plan.zoomIn}
                className={cx(
                  'min-h-hit-min min-w-hit-min cursor-pointer rounded-sm border-0 bg-transparent px-2 py-1 text-sm text-text2',
                  FOCUS,
                )}
                onClick={() => setZoom((value) => Math.min(2, Number((value + 0.2).toFixed(1))))}
              >
                +
              </button>
              <button
                type="button"
                aria-label={S.plan.fit}
                className={cx(
                  'min-h-hit-min min-w-hit-min cursor-pointer rounded-sm border-0 bg-transparent px-2 py-1 text-sm text-text2',
                  FOCUS,
                )}
                onClick={() => setZoom(1)}
              >
                {S.plan.fit}
              </button>
            </div>
          </div>
        </header>

        <div ref={graphScroll} className="min-h-0 flex-auto overflow-auto bg-panel">
          <div
            className="h-(--graph-height) w-(--graph-width) min-w-full"
            style={
              {
                '--graph-width': `${Math.ceil(layout.width * zoom)}px`,
                '--graph-height': `${Math.ceil(layout.height * zoom)}px`,
              } as CSSProperties
            }
          >
            <Svg
              className="block h-(--graph-height) w-(--graph-width)"
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
                      y={GRAPH_NODE.pad + index * GRAPH_NODE.rowHeight + 24}
                      className="fill-faint2 font-mono text-10px"
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
                        'fill-none',
                        wire.merged ? 'stroke-ok-dot stroke-[1.8px]' : 'stroke-strongline stroke-[1.4px] [stroke-dasharray:5_4]',
                        dim && 'opacity-25',
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
                      'group/node cursor-pointer outline-none',
                      isSelected ? 'drop-shadow-[0_0_10px_var(--accent)]' : GROUP_NODE[group],
                      dim && 'opacity-25',
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
                      width={GRAPH_NODE.width}
                      height={GRAPH_NODE.height}
                      rx={9}
                      className={cx(
                        'fill-panel2',
                        isSelected ? 'stroke-accent stroke-[3px]' : cx(GROUP_STROKE[group], 'stroke-[1.5px]'),
                        'group-focus-visible/node:stroke-focus group-focus-visible/node:stroke-[2.5px]',
                      )}
                    />
                    <text
                      x={node.x + GRAPH_NODE.width / 2}
                      y={node.y + (layers.agents && badge ? 15 : 24)}
                      textAnchor="middle"
                      className="fill-text font-mono text-sm font-semibold"
                    >
                      {node.spec.id}
                    </text>
                    {layers.agents && badge && (
                      <g>
                        <rect
                          x={node.x + GRAPH_NODE.width / 2 - 10}
                          y={node.y + 19}
                          width={20}
                          height={12}
                          rx={3}
                          className={cx('stroke-none', AGENT_TILE_CLASS[badge.tile])}
                        />
                        <text
                          x={node.x + GRAPH_NODE.width / 2}
                          y={node.y + 27.5}
                          textAnchor="middle"
                          className={cx('font-mono text-2xs font-semibold', AGENT_TILE_TEXT[badge.tile])}
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
          <div className="flex flex-none items-center gap-2 border-t border-line2 bg-info-bg px-5 py-2 text-xs text-info-strong">
            <span className="flex-none">{S.plan.inserted}</span>
            <code className="min-w-0 flex-auto truncate font-mono text-xs text-info">{inserted.text}</code>
            <button
              type="button"
              className={cx(
                'min-h-hit-min flex-none cursor-pointer rounded-sm border border-info-line bg-transparent px-3 py-1 text-xs text-info-strong',
                FOCUS,
              )}
              onClick={handleUndo}
            >
              {S.plan.undo}
            </button>
          </div>
        )}

        <section className="flex-none border-t border-line2 bg-panel2 px-5 pb-4 pt-3" aria-label={S.plan.events}>
          <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-2">
            <div className="flex items-baseline gap-2">
              <span className="text-sm font-semibold text-text">{S.plan.events}</span>
              <span className="text-2xs text-muted2">{S.plan.last24}</span>
            </div>
            <div className="flex flex-wrap items-center gap-x-3 gap-y-2 text-2xs text-muted2">
              {(['healthy', 'warning', 'critical'] as const).map((tone) => (
                <span key={tone} className="inline-flex items-center gap-1px whitespace-nowrap">
                  <span className={cx('h-2 w-2 rounded-full', LEGEND_TONE[tone])} />
                  {tone === 'healthy' ? S.plan.healthy : tone === 'warning' ? S.plan.warning : S.plan.critical}
                </span>
              ))}
            </div>
          </div>

          <div className="relative mt-2 h-40px border-b border-line">
            {ticks.map((tick, index) => (
              <span
                key={`tick-${index}`}
                className="absolute bottom-0 left-(--pct) -translate-x-1/2 whitespace-nowrap font-mono text-2xs text-faint2 [&:first-of-type]:translate-x-0 [&:last-of-type]:-translate-x-full"
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
                  className={cx(
                    'absolute left-(--pct) top-0 h-hit-min w-hit-min -translate-x-1/2 cursor-pointer border-0 bg-transparent p-0',
                    'after:absolute after:left-1/2 after:top-1/2 after:h-2 after:w-2 after:-translate-x-1/2 after:-translate-y-1/2 after:rotate-45 after:rounded-2px',
                    MARKER_TONE[event.tone],
                    FOCUS,
                  )}
                  style={{ '--pct': `${event.xPct}%` } as CSSProperties}
                  title={title}
                  aria-label={title}
                  onClick={() => setSelectedId(event.id)}
                />
              );
            })}
          </div>
          {events.length === 0 && <p className="mb-0 mt-2 text-xs text-muted2">{S.plan.noEvents}</p>}
        </section>
      </section>

      <aside
        className="flex min-h-0 shrink-0 grow-0 basis-[320px] flex-col gap-4 overflow-y-auto border-l border-line bg-panel p-5 in-data-[menu-side=right]:border-l-0 in-data-[menu-side=right]:border-r"
        aria-label={selected ? S.plan.detailLabel(selected.id, selected.spec.title) : S.title}
      >
        {selected && selectedGroup && selectedStatus ? (
          <>
            <div className="flex flex-col gap-2">
              <h2 className="m-0 text-md font-semibold text-text">
                <span className="font-mono text-muted2">{selected.id}</span> {selected.spec.title}
              </h2>
              <span className="inline-flex items-center gap-2 text-xs text-text2">
                <span className={cx('h-2 w-2 rounded-full', GROUP_DOT[selectedGroup])} />
                {groupLabel(selectedGroup)}
              </span>
              <div className="text-2xl font-semibold text-text">{S.plan.shippedPct(selectedPct)}</div>
              <span className="text-xs text-muted">{S.plan.waveOf(selectedWave, max)}</span>
              {selectedUsage.length > 0 && <Sparkline usage={selectedUsage} />}
            </div>

            {selectedStatus.secondLine.length > 0 && (
              <div className="rounded-md bg-info-bg px-4 py-3 text-xs text-info-strong">{selectedStatus.secondLine}</div>
            )}

            {actions.length > 0 && (
              <div className="flex flex-wrap gap-2">
                {actions.map((entry) => (
                  <button
                    key={entry.action}
                    type="button"
                    className={cx(
                      'inline-flex items-center gap-2 rounded-md border px-4 py-2 text-sm',
                      FOCUS,
                      entry.primary
                        ? 'min-h-[44px] border-transparent bg-accent-solid font-semibold text-on-accent'
                        : 'min-h-hit-min border-btnline bg-transparent text-text',
                    )}
                    onClick={() => handleAction(entry.action, selected)}
                  >
                    <Icon name={ACTION_ICON[entry.action]} size={12} weight={2} />
                    {ACTION_LABEL[entry.action]}
                  </button>
                ))}
              </div>
            )}

            <dl className="m-0 flex flex-col gap-2 [&_dd]:m-0 [&_dd]:text-right [&_dd]:text-text2 [&_dt]:flex-none [&_dt]:text-muted2">
              <div className="flex items-baseline justify-between gap-3 text-xs">
                <dt>{S.plan.worktree}</dt>
                <dd className="font-mono">{selected.worktree ?? S.plan.noneYet}</dd>
              </div>
              {factoryStory && (
                <div className="flex items-baseline justify-between gap-3 text-xs">
                  <dt>{S.factory.story}</dt>
                  <dd>
                    <span className="font-mono">{factoryStory.key}</span> · {factoryStory.status} ·{' '}
                    {factoryStory.spec
                      ? factoryStory.openSpecTasks != null && factoryStory.openSpecTasks > 0
                        ? S.factory.specTasksOpen(factoryStory.openSpecTasks)
                        : S.factory.specTasksDone
                      : S.factory.noSpec}
                  </dd>
                </div>
              )}
              <div className="flex items-baseline justify-between gap-3 text-xs">
                <dt>{S.plan.coder}</dt>
                <dd>
                  {selected.implementer
                    ? `${S.agentName(selected.implementer.agent)} · ${accountName(accounts, selected.implementer.accountId)}`
                    : S.plan.notAssigned}
                </dd>
              </div>
              <div className="flex items-baseline justify-between gap-3 text-xs">
                <dt>{S.plan.reviewer}</dt>
                <dd>
                  {reviewer
                    ? `${S.agentName(reviewer.agent)} · ${accountName(accounts, reviewer.accountId)}`
                    : S.plan.notAssigned}
                </dd>
              </div>
              <div className="flex items-baseline justify-between gap-3 text-xs">
                <dt>{S.plan.dependsOn}</dt>
                <dd className="font-mono">
                  {selected.spec.depends_on.length > 0
                    ? selected.spec.depends_on.map((id) => (
                        <button
                          key={id}
                          type="button"
                          className={cx(
                            'cursor-pointer border-0 bg-transparent p-0 font-mono text-xs text-accent [&+button]:ml-2',
                            FOCUS,
                          )}
                          onClick={() => setSelectedId(id)}
                        >
                          {id}
                        </button>
                      ))
                    : S.plan.none}
                </dd>
              </div>
              <div className="flex items-baseline justify-between gap-3 text-xs">
                <dt>{S.plan.unblocks}</dt>
                <dd>
                  {unblocks.length > 0
                    ? unblocks.map((id) => (
                        <button
                          key={id}
                          type="button"
                          className={cx(
                            'cursor-pointer border-0 bg-transparent p-0 font-mono text-xs text-accent [&+button]:ml-2',
                            FOCUS,
                          )}
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
              className={cx(
                'flex min-h-hit-min w-full cursor-pointer items-center justify-center gap-2 rounded-md border border-btnline bg-btn px-4 py-2 text-sm text-text',
                FOCUS,
              )}
              onClick={() => handleInsert(selected)}
            >
              <Icon name="terminal" size={12} weight={2} />
              {S.plan.insertFile(selected.file)}
            </button>

            {summary && <div className="font-mono text-xs text-text2">{summary}</div>}

            <div role="tablist" aria-label={S.title} className="flex gap-1 border-b border-line">
              {(['overview', 'needs', 'events'] as const).map((key) => (
                <button
                  key={key}
                  type="button"
                  role="tab"
                  aria-selected={tab === key}
                  className={cx(
                    'min-h-hit-min cursor-pointer border-x-0 border-t-0 border-b-2 bg-transparent px-3 py-2 text-sm',
                    FOCUS,
                    tab === key ? 'border-b-accent text-text' : 'border-b-transparent text-muted',
                  )}
                  onClick={() => setTab(key)}
                >
                  {S.plan.tabs[key]}
                </button>
              ))}
            </div>

            <div className="flex flex-col gap-4" role="tabpanel">
              {tab === 'overview' && (
                <>
                  {usageError && (
                    <div role="alert" className="rounded-md bg-err-bg p-3 text-xs text-err-strong">
                      {usageError}
                    </div>
                  )}
                  <StageChart rows={stageRows(selected, now)} />
                  <CostChart usage={usage} />
                </>
              )}

              {tab === 'needs' && (
                <div className="flex flex-col gap-2">
                  <span className="text-sm font-semibold text-text2">{S.row.doneWhen}</span>
                  {criteria.map((criterion, index) => (
                    <div key={index} className="flex items-start gap-3 text-12p5">
                      <Icon
                        name={CRITERION_ICON[criterion.state]}
                        size={14}
                        weight={2.3}
                        className={cx('mt-2px shrink-0 grow-0 basis-6', CRITERION_TONE[criterion.tone])}
                      />
                      <span className="flex-auto text-text2">{criterion.text}</span>
                      <span className="flex-none whitespace-nowrap rounded-sm bg-neutral px-7px py-1px text-11px text-muted">
                        {criterion.by}
                      </span>
                    </div>
                  ))}
                </div>
              )}

              {tab === 'events' && (
                <div className="flex flex-col gap-2">
                  {history.map((row) => (
                    <span key={row.key} className="font-mono text-xs text-text2">
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
    <Svg className="h-8 w-full" viewBox={`0 0 ${width} ${height}`} aria-hidden="true">
      <path d={d} className="fill-none stroke-info-dot stroke-[1.5px]" />
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
    <div className="flex flex-col gap-2 rounded-lg border border-line bg-panel2 p-3">
      <h4 className="m-0 text-xs font-semibold text-text2">{S.plan.timePerStage}</h4>
      <Svg
        className="h-auto w-full"
        viewBox={`0 0 ${width} ${height}`}
        role="img"
        aria-label={S.plan.timePerStage}
      >
        <line x1={0} x2={width} y1={baseY} y2={baseY} className="stroke-line stroke-1" />
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
                className={cx('stroke-none', STAGE_BAR[row.tone])}
              />
              <text x={x + barWidth / 2} y={y - 4} textAnchor="middle" className="fill-text2 font-mono text-2xs">
                {row.minutes}
              </text>
              <text
                x={x + barWidth / 2}
                y={baseY + 14}
                textAnchor="middle"
                className="fill-faint2 font-sans text-2xs"
              >
                {row.label}
              </text>
            </g>
          );
        })}
      </Svg>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2 text-2xs text-muted2">
        {(['stable', 'warning', 'critical'] as const).map((tone) => (
          <span key={tone} className="inline-flex items-center gap-1px whitespace-nowrap">
            <span className={cx('h-2 w-2 rounded-2px', STAGE_SWATCH[tone])} />
            {tone === 'stable' ? S.plan.stable : tone === 'warning' ? S.plan.warning : S.plan.critical}
          </span>
        ))}
      </div>
    </div>
  );
}

function CostChart({ usage }: { readonly usage: readonly SpecUsageHour[] | null }) {
  const heading = <h4 className="m-0 text-xs font-semibold text-text2">{S.plan.costByHour}</h4>;
  if (!usage || usage.length === 0) {
    return (
      <div className="flex flex-col gap-2 rounded-lg border border-line bg-panel2 p-3">
        {heading}
        <p className="m-0 text-xs text-muted2">{S.plan.noRuns}</p>
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
    <div className="flex flex-col gap-2 rounded-lg border border-line bg-panel2 p-3">
      {heading}
      <Svg
        className="h-auto w-full"
        viewBox={`0 0 ${width} ${height}`}
        role="img"
        aria-label={S.plan.costByHour}
      >
        <line
          x1={padLeft}
          x2={width - padRight}
          y1={padTop + innerHeight}
          y2={padTop + innerHeight}
          className="stroke-line stroke-1"
        />
        <text x={0} y={padTop + 4} className="fill-faint2 font-mono text-2xs">
          {max.toFixed(2)}
        </text>
        <text x={0} y={padTop + innerHeight + 4} className="fill-faint2 font-mono text-2xs">
          0
        </text>
        {area && <path d={area} className="fill-info-bg stroke-none" />}
        {line && <path d={line} className="fill-none stroke-info-dot stroke-[1.5px]" />}
        {points.map((point, index) => (
          <circle key={`point-${index}`} cx={point.x} cy={point.y} r={2} className="fill-info-dot" />
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
              className="fill-faint2 font-mono text-2xs"
            >
              {hourLabel(Date.parse(hour.hour))}
            </text>
          );
        })}
      </Svg>
    </div>
  );
}
