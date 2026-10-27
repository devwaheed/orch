/**
 * The Plan view's view-model: pure functions from a SpecQueue to the dependency graph,
 * status groups, stage times, 24-hour events and the affected path. No React, no services.
 *
 * Group meanings, layout rules and copy come from the Plan story. The status colours are
 * the ones the Queue pills already use (docs/specs/spec-queue.md §12), so the Plan view
 * never invents a state colour of its own.
 */
import type { SpecAdvance, SpecRun, SpecState } from '@orchagents/contracts';
import { AGENT_MONO, specStrings as S } from './strings.js';
import { AGENT_TILE, isDependencySatisfied } from './specsView.js';

export type PlanGroup = 'coding' | 'review' | 'waiting' | 'ready' | 'blocked' | 'shipped' | 'skipped';
export type PlanTone = 'ok' | 'info' | 'warn' | 'err' | 'neutral';
export type EventTone = 'healthy' | 'warning' | 'critical';
export type StageKey = 'code' | 'verify' | 'review' | 'fix' | 'merge';
export type StageTone = 'stable' | 'warning' | 'critical';

/** The left list's group order. */
export const PLAN_GROUP_ORDER: readonly PlanGroup[] = [
  'coding',
  'review',
  'waiting',
  'ready',
  'blocked',
  'shipped',
  'skipped',
];

/** Each group uses the same colour token as the Queue pill for its state. */
export const GROUP_TONE: Record<PlanGroup, PlanTone> = {
  coding: 'info',
  review: 'info',
  waiting: 'err',
  ready: 'neutral',
  blocked: 'neutral',
  shipped: 'ok',
  skipped: 'warn',
};

export const STAGE_ORDER: readonly StageKey[] = ['code', 'verify', 'review', 'fix', 'merge'];

export interface PlanGroupSection {
  readonly group: PlanGroup;
  readonly label: string;
  readonly tone: PlanTone;
  readonly specs: readonly SpecRun[];
}

export interface PlanProgress {
  readonly merged: number;
  readonly total: number;
  readonly pct: number;
}

export interface PlanEvent {
  readonly id: string;
  readonly title: string;
  readonly at: number;
  /** Position on the 24 h axis, 0–100. */
  readonly xPct: number;
  readonly group: PlanGroup;
  readonly tone: EventTone;
  readonly attempt: number;
}

export interface AxisTick {
  readonly pct: number;
  readonly label: string;
}

export interface StageRow {
  readonly stage: StageKey;
  readonly label: string;
  readonly minutes: number;
  readonly tone: StageTone;
}

export interface HistoryRow {
  readonly key: string;
  readonly at: number;
  readonly time: string;
  readonly group: PlanGroup;
  readonly attempt: number;
}

export interface AgentBadge {
  readonly agent: NonNullable<SpecRun['implementer']>['agent'];
  readonly mono: string;
  readonly tile: 'cc' | 'cx' | 'gm' | 'oc' | 'ag';
}

export interface GraphNode {
  readonly spec: SpecRun;
  readonly wave: number;
  readonly x: number;
  readonly y: number;
}

export interface GraphWire {
  readonly key: string;
  readonly d: string;
  readonly merged: boolean;
}

export interface PlanGraph {
  readonly nodes: readonly GraphNode[];
  readonly wires: readonly GraphWire[];
  readonly width: number;
  readonly height: number;
  readonly maxWave: number;
}

const NODE_W = 76;
const NODE_H = 64;
const GAP_X = 24;
const ROW_H = 94;
const LABEL_W = 40;
const PAD = 22;

export function groupLabel(group: PlanGroup): string {
  return S.plan.groups[group];
}

/**
 * Wave = 1 + the longest chain of dependencies below the spec. Unknown dependencies are
 * ignored (the queue reports them as load problems) and a cycle falls back to wave 1 for
 * the back edge, so a bad queue still draws.
 */
export function computeWaves(specs: readonly SpecRun[]): Map<string, number> {
  const byId = new Map<string, SpecRun>(specs.map((spec) => [spec.id, spec]));
  const memo = new Map<string, number>();
  const visiting = new Set<string>();

  const waveOf = (id: string): number => {
    const cached = memo.get(id);
    if (cached !== undefined) return cached;
    if (visiting.has(id)) return 1;
    const spec = byId.get(id);
    if (!spec) return 0;
    visiting.add(id);
    let deepest = 0;
    for (const depId of spec.spec.depends_on) {
      if (!byId.has(depId)) continue;
      deepest = Math.max(deepest, waveOf(depId));
    }
    visiting.delete(id);
    const wave = deepest + 1;
    memo.set(id, wave);
    return wave;
  };

  for (const spec of specs) waveOf(spec.id);
  return memo;
}

export function maxWave(waves: ReadonlyMap<string, number>): number {
  let max = 0;
  for (const wave of waves.values()) {
    if (wave > max) max = wave;
  }
  return max;
}

function dependenciesMet(
  spec: SpecRun,
  byId: ReadonlyMap<string, SpecRun>,
  advance: SpecAdvance,
): boolean {
  for (const depId of spec.spec.depends_on) {
    const dep = byId.get(depId);
    if (!dep || !isDependencySatisfied(dep.state, advance)) return false;
  }
  return true;
}

/** The Plan-only status group for a spec (the same state colours as the Queue pills). */
export function specGroup(
  spec: SpecRun,
  allSpecs: readonly SpecRun[],
  advance: SpecAdvance,
): PlanGroup {
  const byId = new Map<string, SpecRun>(allSpecs.map((entry) => [entry.id, entry]));
  return groupForState(spec.state, spec, byId, advance);
}

function groupForState(
  state: SpecState,
  spec: SpecRun,
  byId: ReadonlyMap<string, SpecRun>,
  advance: SpecAdvance,
): PlanGroup {
  switch (state) {
    case 'merged':
      return 'shipped';
    case 'running':
      return 'coding';
    case 'verifying':
    case 'auditing':
    case 'verified':
    case 'approved':
      return 'review';
    case 'needs_you':
      return 'waiting';
    case 'queued':
      return dependenciesMet(spec, byId, advance) ? 'ready' : 'blocked';
    case 'blocked':
    case 'waiting_quota':
      return 'blocked';
    case 'skipped':
    case 'cancelled':
      return 'skipped';
  }
}

/** Search matches the spec id or its title, case-insensitively. */
export function matchesSearch(spec: SpecRun, search: string): boolean {
  const term = search.trim().toLowerCase();
  if (term.length === 0) return true;
  return spec.id.toLowerCase().includes(term) || spec.spec.title.toLowerCase().includes(term);
}

/** Groups in the Plan order, with empty groups omitted after the search filter. */
export function planGroups(
  specs: readonly SpecRun[],
  advance: SpecAdvance,
  search = '',
): PlanGroupSection[] {
  const byId = new Map<string, SpecRun>(specs.map((spec) => [spec.id, spec]));
  const buckets = new Map<PlanGroup, SpecRun[]>();
  for (const spec of specs) {
    if (!matchesSearch(spec, search)) continue;
    const group = groupForState(spec.state, spec, byId, advance);
    const list = buckets.get(group) ?? [];
    list.push(spec);
    buckets.set(group, list);
  }
  const sections: PlanGroupSection[] = [];
  for (const group of PLAN_GROUP_ORDER) {
    const list = buckets.get(group);
    if (!list || list.length === 0) continue;
    sections.push({
      group,
      label: groupLabel(group),
      tone: GROUP_TONE[group],
      specs: [...list].sort((a, b) => a.position - b.position),
    });
  }
  return sections;
}

/** Criteria met / criteria total, rounded. */
export function progressPercent(spec: SpecRun): number {
  const total = spec.criteria.length;
  if (total === 0) return 0;
  const met = spec.criteria.filter((criterion) => criterion.state === 'met').length;
  return Math.round((met / total) * 100);
}

/** Overall shipped progress: merged / total, rounded. */
export function shippedProgress(specs: readonly SpecRun[]): PlanProgress {
  const total = specs.length;
  const merged = specs.filter((spec) => spec.state === 'merged').length;
  return { merged, total, pct: total === 0 ? 0 : Math.round((merged / total) * 100) };
}

/**
 * The selected spec plus all its transitive dependencies (ancestors) and all specs that
 * transitively depend on it (descendants). Used by "Show affected path only".
 */
export function affectedPath(specs: readonly SpecRun[], selectedId: string | null): Set<string> {
  const result = new Set<string>();
  if (!selectedId) return result;
  const byId = new Map<string, SpecRun>(specs.map((spec) => [spec.id, spec]));
  if (!byId.has(selectedId)) return result;

  result.add(selectedId);
  const ancestors = [selectedId];
  while (ancestors.length > 0) {
    const current = ancestors.pop();
    if (!current) continue;
    const spec = byId.get(current);
    if (!spec) continue;
    for (const depId of spec.spec.depends_on) {
      if (!byId.has(depId) || result.has(depId)) continue;
      result.add(depId);
      ancestors.push(depId);
    }
  }

  const reverse = new Map<string, string[]>();
  for (const spec of specs) {
    for (const depId of spec.spec.depends_on) {
      if (!byId.has(depId)) continue;
      const list = reverse.get(depId) ?? [];
      list.push(spec.id);
      reverse.set(depId, list);
    }
  }
  const descendants = [selectedId];
  while (descendants.length > 0) {
    const current = descendants.pop();
    if (!current) continue;
    for (const childId of reverse.get(current) ?? []) {
      if (result.has(childId)) continue;
      result.add(childId);
      descendants.push(childId);
    }
  }
  return result;
}

/** Direct dependents of a spec, in queue order. */
export function dependentsOf(specs: readonly SpecRun[], id: string): string[] {
  return [...specs]
    .sort((a, b) => a.position - b.position)
    .filter((spec) => spec.spec.depends_on.includes(id))
    .map((spec) => spec.id);
}

function stageFor(state: SpecState, attempt: number | null): StageKey | null {
  switch (state) {
    case 'running':
      return (attempt ?? 1) > 1 ? 'fix' : 'code';
    case 'verifying':
      return 'verify';
    case 'auditing':
      return 'review';
    case 'approved':
      return 'merge';
    default:
      return null;
  }
}

/**
 * Minutes per stage from the spec's history. Each entry's stage runs until the next entry;
 * the last open stage runs until now. Rounded to whole minutes.
 */
export function stageMinutes(spec: SpecRun, now: Date): Record<StageKey, number> {
  const totals: Record<StageKey, number> = { code: 0, verify: 0, review: 0, fix: 0, merge: 0 };
  const history = spec.history ?? [];
  const nowMs = now.getTime();
  for (let index = 0; index < history.length; index++) {
    const entry = history[index];
    if (!entry) continue;
    const stage = stageFor(entry.state, entry.attempt);
    if (!stage) continue;
    const start = Date.parse(entry.at);
    const next = history[index + 1];
    const end = next ? Date.parse(next.at) : nowMs;
    if (Number.isNaN(start) || Number.isNaN(end) || end <= start) continue;
    totals[stage] += (end - start) / 60_000;
  }
  for (const stage of STAGE_ORDER) {
    totals[stage] = Math.round(totals[stage]);
  }
  return totals;
}

/** The stage the spec was in immediately before its most recent needs_you entry. */
export function criticalStage(spec: SpecRun): StageKey | null {
  const history = spec.history ?? [];
  for (let index = history.length - 1; index >= 0; index--) {
    const entry = history[index];
    if (entry?.state !== 'needs_you') continue;
    const previous = history[index - 1];
    return previous ? stageFor(previous.state, previous.attempt) : null;
  }
  return null;
}

/** Stage rows for the Overview bar chart, with the legend tones from the story. */
export function stageRows(spec: SpecRun, now: Date): StageRow[] {
  const minutes = stageMinutes(spec, now);
  const critical = criticalStage(spec);
  return STAGE_ORDER.map((stage) => {
    const tone: StageTone =
      stage === critical ? 'critical' : stage === 'fix' ? 'warning' : 'stable';
    return { stage, label: S.plan.stages[stage], minutes: minutes[stage], tone };
  });
}

function eventTone(state: SpecState, attempt: number | null): EventTone | null {
  switch (state) {
    case 'verified':
    case 'approved':
    case 'merged':
      return 'healthy';
    case 'running':
      return (attempt ?? 1) > 1 ? 'warning' : null;
    case 'waiting_quota':
      return 'warning';
    case 'needs_you':
    case 'skipped':
    case 'cancelled':
      return 'critical';
    default:
      return null;
  }
}

/** Every marker-worthy history entry in the last 24 h, oldest first. */
export function planEvents(
  specs: readonly SpecRun[],
  advance: SpecAdvance,
  now: Date,
): PlanEvent[] {
  const byId = new Map<string, SpecRun>(specs.map((spec) => [spec.id, spec]));
  const end = now.getTime();
  const start = end - 24 * 60 * 60 * 1000;
  const span = end - start;
  const events: PlanEvent[] = [];
  for (const spec of specs) {
    for (const entry of spec.history ?? []) {
      const tone = eventTone(entry.state, entry.attempt);
      if (!tone) continue;
      const at = Date.parse(entry.at);
      if (Number.isNaN(at) || at < start || at > end) continue;
      events.push({
        id: spec.id,
        title: spec.spec.title,
        at,
        xPct: ((at - start) / span) * 100,
        group: groupForState(entry.state, spec, byId, advance),
        tone,
        attempt: entry.attempt ?? 1,
      });
    }
  }
  return events.sort((a, b) => a.at - b.at);
}

/**
 * Seven labels every four hours across the 24 h window: 00:00 at the left edge (24 h ago)
 * and 24:00 at the right edge (now). Markers use local HH:MM in their titles.
 */
export function axisTicks(): AxisTick[] {
  const ticks: AxisTick[] = [];
  for (let index = 0; index <= 6; index++) {
    const hours = index * 4;
    ticks.push({ pct: (index / 6) * 100, label: `${hours < 10 ? '0' : ''}${hours}:00` });
  }
  return ticks;
}

function pad(value: number): string {
  return value < 10 ? `0${value}` : String(value);
}

/** Local HH:MM for a timestamp. */
export function clock(at: string | number): string {
  const date = new Date(at);
  if (Number.isNaN(date.getTime())) return '';
  return `${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

/** Local HH:00 for an axis tick. */
export function hourLabel(at: number): string {
  const date = new Date(at);
  if (Number.isNaN(date.getTime())) return '';
  return `${pad(date.getHours())}:00`;
}

/** The spec's history newest first, for the Events tab. */
export function historyRows(
  spec: SpecRun,
  allSpecs: readonly SpecRun[],
  advance: SpecAdvance,
): HistoryRow[] {
  const byId = new Map<string, SpecRun>(allSpecs.map((entry) => [entry.id, entry]));
  return [...(spec.history ?? [])]
    .reverse()
    .map((entry, index) => {
      const at = Date.parse(entry.at);
      return {
        key: `${spec.id}-${index}-${entry.at}`,
        at,
        time: clock(entry.at),
        group: groupForState(entry.state, spec, byId, advance),
        attempt: entry.attempt ?? 1,
      };
    });
}

/** The agent badge under a node: the implementer, else the spec's preferred agent. */
export function agentBadge(spec: SpecRun): AgentBadge | null {
  const agent = spec.implementer?.agent ?? (spec.spec.agent === 'auto' ? null : spec.spec.agent);
  if (!agent) return null;
  return { agent, mono: AGENT_MONO[agent], tile: AGENT_TILE[agent] };
}

/**
 * Places one row per wave, top to bottom. Within a row nodes keep queue order. Wires are
 * cubic curves from the bottom of the dependency to the top of the spec.
 */
export function layoutGraph(specs: readonly SpecRun[], waves: ReadonlyMap<string, number>): PlanGraph {
  const max = maxWave(waves);
  const rows = new Map<number, SpecRun[]>();
  for (const spec of specs) {
    const wave = waves.get(spec.id) ?? 1;
    const list = rows.get(wave) ?? [];
    list.push(spec);
    rows.set(wave, list);
  }
  let widest = 1;
  for (const list of rows.values()) {
    if (list.length > widest) widest = list.length;
  }

  const nodes: GraphNode[] = [];
  const position = new Map<string, GraphNode>();
  for (let wave = 1; wave <= max; wave++) {
    const list = [...(rows.get(wave) ?? [])].sort((a, b) => a.position - b.position);
    list.forEach((spec, index) => {
      const node: GraphNode = {
        spec,
        wave,
        x: LABEL_W + PAD + index * (NODE_W + GAP_X),
        y: PAD + (wave - 1) * ROW_H,
      };
      nodes.push(node);
      position.set(spec.id, node);
    });
  }

  const wires: GraphWire[] = [];
  for (const spec of specs) {
    const to = position.get(spec.id);
    if (!to) continue;
    for (const depId of spec.spec.depends_on) {
      const from = position.get(depId);
      if (!from) continue;
      const x1 = from.x + NODE_W / 2;
      const y1 = from.y + NODE_H;
      const x2 = to.x + NODE_W / 2;
      const y2 = to.y;
      const mid = y1 + (y2 - y1) / 2;
      wires.push({
        key: `${depId}->${spec.id}`,
        d: `M ${x1} ${y1} C ${x1} ${mid}, ${x2} ${mid}, ${x2} ${y2}`,
        merged: from.spec.state === 'merged',
      });
    }
  }

  return {
    nodes,
    wires,
    width: LABEL_W + PAD + widest * (NODE_W + GAP_X),
    height: PAD + max * ROW_H + PAD,
    maxWave: max,
  };
}

export const GRAPH_NODE = { width: NODE_W, height: NODE_H, labelWidth: LABEL_W, pad: PAD } as const;
