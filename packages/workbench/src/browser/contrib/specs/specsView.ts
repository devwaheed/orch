/**
 * The Specs screen's view-model: pure functions from a SpecQueue to what the screen shows.
 * No React, no services, no Node built-ins (this file lives under src/browser).
 *
 * The state pills and second lines mirror docs/specs/spec-queue.md §12, implemented
 * word-for-word on the platform as packages/platform/src/specs/queue/common/labels.ts.
 * The UI cannot import that file (dep rules), so §12 is reimplemented here. Where the
 * prototype's sample text differs from §12, §12 wins.
 */
import type {
  Account,
  AgentId,
  SpecAdvance,
  SpecLoadProblem,
  SpecQueue,
  SpecQueueSettings,
  SpecRun,
  SpecState,
} from '@orchagents/contracts';
import { Check, SpecId } from '@orchagents/contracts';
import type { IconName } from '../../../../../../design/icons/icons.js';
import { AGENT_MONO, specStrings as S } from './strings.js';

export type ToneName = 'ok' | 'info' | 'warn' | 'err' | 'neutral';

export interface SpecsViewContext {
  /** The full account list, so a spec's implementer.accountId resolves to a display name. */
  readonly accounts: readonly Account[];
  readonly now: Date;
}

/** The spec row's status pill and second line (docs/specs/spec-queue.md §12). */
export interface SpecStatusVM {
  readonly pill: string;
  readonly secondLine: string;
  readonly tone: ToneName;
}

/**
 * A "done-when" criterion as shown in a spec row's expanded details. The summary (an
 * auditor's one-line reason, or a check's "14 passed") is surfaced on the map, not the
 * row.
 */
export interface CriterionVM {
  readonly text: string;
  readonly by: string;
  readonly state: 'pending' | 'running' | 'met' | 'not_met';
  readonly tone: ToneName;
}

export interface SpecRowVM {
  readonly key: string;
  readonly number: string;
  readonly title: string;
  readonly meta: string;
  readonly status: SpecStatusVM;
  readonly doneWhen: string;
  readonly doneWhenColor: ToneName;
  readonly agent: AgentId | null;
  readonly mono: string;
  readonly tileTone: 'cc' | 'cx' | 'gm' | 'oc' | 'ag';
  readonly who: string;
  readonly cost: string;
  readonly expanded?: boolean;
  readonly criteria: readonly CriterionVM[];
  readonly dependsOn: string;
  readonly scope: string;
}

export type SpecRowListVM = readonly (SpecRowVM | GroupRowVM)[];

export interface GroupRowVM {
  readonly key: string;
  readonly range: string;
  readonly text: string;
  readonly tone: ToneName;
  readonly icon: IconName;
}

export interface CountsVM {
  readonly verified: number;
  readonly running: number;
  readonly bad: number;
  readonly badLabel: string;
  readonly badTone: ToneName;
  readonly queued: number;
  readonly total: number;
}

export interface BarSegmentVM {
  readonly width: string;
  readonly tone: ToneName;
  readonly title: string;
}

export interface NowLineVM {
  readonly text: string;
  readonly tone: ToneName;
  readonly icon: IconName;
}

export interface RulesVM {
  readonly order: readonly RuleOptionVM[];
  readonly advance: readonly RuleOptionVM[];
  readonly onFail: readonly RuleOptionVM[];
}

export interface RuleOptionVM {
  readonly value: string;
  readonly label: string;
  readonly pressed: boolean;
}

export interface MapVM {
  readonly runner: MapNodeVM;
  readonly specNodes: readonly MapNodeVM[];
  readonly hasSelection: boolean;
  readonly steps: readonly MapStepVM[];
  readonly backgroundTasks: readonly MapNodeVM[];
}

export interface MapNodeVM {
  readonly id: string;
  readonly title: string;
  readonly sub: string;
  readonly tone: ToneName;
  readonly toneVariant?: 'faint' | undefined;
}

export interface MapStepVM {
  readonly title: string;
  readonly sub: string;
  readonly tone: ToneName;
}

const AGENT_TILE: Record<AgentId, 'cc' | 'cx' | 'gm' | 'oc' | 'ag'> = {
  claude: 'cc',
  codex: 'cx',
  gemini: 'gm',
  opencode: 'oc',
  agy: 'ag',
};

const STATE_TONE: Record<SpecState, ToneName> = {
  queued: 'neutral',
  blocked: 'neutral',
  waiting_quota: 'info',
  running: 'info',
  verifying: 'info',
  auditing: 'info',
  verified: 'info',
  approved: 'ok',
  merged: 'ok',
  needs_you: 'err',
  skipped: 'warn',
  cancelled: 'neutral',
};

function agentName(agent: AgentId): string {
  return S.agentName(agent);
}

function accountName(id: string | null | undefined, ctx: SpecsViewContext): string {
  if (!id) return '';
  const account = ctx.accounts.find((a) => a.id === id);
  return account ? account.name : id;
}

function isDependencySatisfied(depState: SpecState, advance: SpecAdvance): boolean {
  switch (advance) {
    case 'verified':
      return depState === 'verified' || depState === 'approved' || depState === 'merged';
    case 'approved':
      return depState === 'approved' || depState === 'merged';
    case 'merged':
      return depState === 'merged';
  }
}

function baseName(repoPath: string): string {
  return repoPath.replace(/\\/g, '/').split('/').filter(Boolean).pop() ?? repoPath;
}

/** Lowest direct dependency that is not yet satisfied for `advance`, or null. §12 / labels.ts. */
function lowestUnsatisfiedDep(
  spec: SpecRun,
  allSpecs: readonly SpecRun[],
  advance: SpecAdvance,
): string | null {
  const specMap = new Map<SpecId, SpecRun>(allSpecs.map((s) => [s.id, s]));
  for (const depId of spec.spec.depends_on) {
    const parsed = SpecId.safeParse(depId);
    if (!parsed.success) continue;
    const dep = specMap.get(parsed.data);
    if (!dep || !isDependencySatisfied(dep.state, advance)) {
      return depId;
    }
  }
  return null;
}

/**
 * The first spec (by position) that is queued or blocked and waits on a dependency,
 * skipping specs that depend on `excludeId` (the spec that needs you). Used for the
 * "now line" next-sentence and the otherwise case. Returns the spec and the dependency
 * it is waiting on.
 */
function nextWaitingSpec(
  allSpecs: readonly SpecRun[],
  advance: SpecAdvance,
  excludeId: SpecId | null,
): { spec: SpecRun; dep: string } | null {
  const ordered = [...allSpecs].sort((a, b) => a.position - b.position);
  const skip = new Set<string>();
  if (excludeId) {
    for (const id of transitiveDependents(excludeId, allSpecs)) {
      skip.add(id);
    }
    skip.add(excludeId);
  }
  for (const spec of ordered) {
    if (spec.state !== 'queued' && spec.state !== 'blocked') {
      continue;
    }
    if (skip.has(spec.id)) {
      continue;
    }
    let dep: string | null;
    if (spec.state === 'blocked') {
      dep = spec.blockedBy[0] ?? lowestUnsatisfiedDep(spec, allSpecs, advance);
    } else {
      dep = lowestUnsatisfiedDep(spec, allSpecs, advance);
      if (!dep) {
        continue; // ready-queued: would already be running, not a "starts when dep" case
      }
    }
    if (dep) {
      return { spec, dep };
    }
  }
  return null;
}

/** All spec ids that (transitively) depend on `id`. */
function transitiveDependents(id: SpecId, allSpecs: readonly SpecRun[]): string[] {
  const reverse = new Map<SpecId, string[]>();
  for (const s of allSpecs) {
    for (const dep of s.spec.depends_on) {
      const depParsed = SpecId.safeParse(dep);
      if (depParsed.success) {
        const list = reverse.get(depParsed.data) ?? [];
        list.push(s.id);
        reverse.set(depParsed.data, list);
      }
    }
  }
  const result: string[] = [];
  const seen = new Set<string>();
  const queue: SpecId[] = [id];
  while (queue.length > 0) {
    const cur = queue.shift()!;
    for (const depId of reverse.get(cur) ?? []) {
      if (seen.has(depId)) continue;
      seen.add(depId);
      result.push(depId);
      const parsed = SpecId.safeParse(depId);
      if (parsed.success) {
        queue.push(parsed.data);
      }
    }
  }
  return result;
}

const WHEN_VERB: Record<SpecAdvance, (dep: string) => string> = {
  verified: S.nowLine.when.verified,
  approved: S.nowLine.when.approved,
  merged: S.nowLine.when.merged,
};

/** §12: the "now line". Returns null when nothing is waiting on a dependency. */
export function nowLine(
  queue: SpecQueue,
): NowLineVM | null {
  const { settings, specs } = queue;
  const advance = settings.advance;
  const paused = queue.paused;

  const needsYou = specs.find((s) => s.state === 'needs_you');

  if (paused) {
    return { text: S.nowLine.paused, tone: 'neutral', icon: 'pauseCircle' };
  }

  if (needsYou) {
    const tries = needsYou.attempt ?? 1;
    let text = S.nowLine.stopped(needsYou.id, tries);
    const next = nextWaitingSpec(specs, advance, needsYou.id);
    if (next) {
      text += ' ' + S.nowLine.startsWhen(next.spec.id, WHEN_VERB[advance](next.dep));
    }
    return { text, tone: 'warn', icon: 'alert' };
  }

  const next = nextWaitingSpec(specs, advance, null);
  if (!next) {
    return null;
  }
  return {
    text: S.nowLine.startsWhen(next.spec.id, WHEN_VERB[advance](next.dep)),
    tone: 'info',
    icon: 'sync',
  };
}

/** §12 state pills and second lines, mirroring labels.ts exactly. */
export function specStatus(
  spec: SpecRun,
  allSpecs: readonly SpecRun[] = [],
  advance: SpecAdvance = 'verified',
): SpecStatusVM {
  const tryNum = spec.attempt ?? 1;
  const tone = STATE_TONE[spec.state];

  switch (spec.state) {
    case 'queued': {
      const dep = lowestUnsatisfiedDep(spec, allSpecs, advance);
      if (dep) {
        return { pill: `Waiting for ${dep}`, secondLine: `Starts automatically when ${dep} is ${advance}`, tone };
      }
      return { pill: 'Queued', secondLine: 'Next in line', tone };
    }
    case 'blocked': {
      const id = spec.blockedBy[0] ?? spec.spec.depends_on[0] ?? '';
      return { pill: `Blocked by ${id}`, secondLine: `Won't run until ${id} is retried`, tone };
    }
    case 'waiting_quota': {
      const agent = spec.implementer?.agent ?? (spec.spec.agent === 'auto' ? null : spec.spec.agent) ?? null;
      const agentText = agent ? agentName(agent) : 'an agent';
      return { pill: 'Waiting for an account', secondLine: `Starts when ${agentText} has room`, tone };
    }
    case 'running':
      return { pill: `Running · try ${tryNum}`, secondLine: 'Step 2 of 5 · implement', tone };
    case 'verifying':
      return { pill: `Running · try ${tryNum}`, secondLine: 'Step 2 of 3 · checks', tone };
    case 'auditing': {
      const auditor = spec.criteria.find((c) => c.auditor)?.auditor?.agent;
      const auditorAgent = auditor ? agentName(auditor) : 'an agent';
      return { pill: `Running · try ${tryNum}`, secondLine: `Step 3 of 3 · audit by ${auditorAgent}`, tone };
    }
    case 'verified':
      return { pill: 'Verified · your review', secondLine: spec.spec.depends_on.length > 0 ? `Depends on ${spec.spec.depends_on.join(', ')}` : '', tone };
    case 'approved': {
      const specMap = new Map<SpecId, SpecRun>(allSpecs.map((s) => [s.id, s]));
      const unmergedDep = spec.spec.depends_on.find((depId) => {
        const parsed = SpecId.safeParse(depId);
        if (!parsed.success) return false;
        const dep = specMap.get(parsed.data);
        return dep && dep.state !== 'merged';
      });
      return {
        pill: 'Verified · approved',
        secondLine: unmergedDep ? `Merges after ${unmergedDep}` : 'Merging',
        tone,
      };
    }
    case 'merged':
      return {
        pill: 'Verified · merged',
        secondLine: spec.spec.depends_on.length > 0 ? `Depends on ${spec.spec.depends_on.join(', ')}` : '',
        tone,
      };
    case 'needs_you':
      return { pill: `Stopped · ${tryNum} ${tryNum === 1 ? 'try' : 'tries'}`, secondLine: 'Queue paused here: needs you', tone };
    case 'skipped':
      return { pill: `Skipped · ${tryNum} ${tryNum === 1 ? 'try' : 'tries'}`, secondLine: 'Skipped; the queue moved on', tone };
    case 'cancelled':
      return { pill: 'Cancelled', secondLine: '', tone };
  }
}

/** §12 counts. verified = verified|approved|merged; running = running|verifying|auditing|waiting_quota; bad per on_fail; queued = queued|blocked. */
export function queueCounts(specs: readonly SpecRun[], settings: SpecQueueSettings): CountsVM {
  let verified = 0;
  let running = 0;
  let needsYou = 0;
  let skipped = 0;
  let queued = 0;
  for (const s of specs) {
    switch (s.state) {
      case 'verified':
      case 'approved':
      case 'merged':
        verified++;
        break;
      case 'running':
      case 'verifying':
      case 'auditing':
      case 'waiting_quota':
        running++;
        break;
      case 'needs_you':
        needsYou++;
        break;
      case 'skipped':
        skipped++;
        break;
      case 'queued':
      case 'blocked':
        queued++;
        break;
    }
  }
  const badIsSkipped = settings.on_fail === 'retry-skip';
  return {
    verified,
    running,
    bad: badIsSkipped ? skipped : needsYou,
    badLabel: badIsSkipped ? S.counts.skipped : S.counts.needsYou,
    badTone: badIsSkipped ? 'warn' : 'err',
    queued,
    total: specs.length,
  };
}

/** The progress bar's four segments (§12). Widths sum to 100%. */
export function progressSegments(specs: readonly SpecRun[], settings: SpecQueueSettings): BarSegmentVM[] {
  const c = queueCounts(specs, settings);
  const total = c.total;
  const pct = (n: number) => (total === 0 ? '0%' : `${Math.round((n / total) * 10000) / 100}%`);
  const badTitle = settings.on_fail === 'retry-skip' ? S.barTitles.skipped(c.bad) : S.barTitles.stopped(c.bad);
  return [
    { width: pct(c.verified), tone: 'ok', title: S.barTitles.verified(c.verified) },
    { width: pct(c.running), tone: 'info', title: S.barTitles.running(c.running) },
    { width: pct(c.bad), tone: c.badTone, title: badTitle },
    { width: pct(c.queued), tone: 'neutral', title: S.barTitles.queued(c.queued) },
  ];
}

function zeroPad(id: string): string {
  return id.length < 2 ? id.padStart(2, '0') : id;
}

function groupText(first: string, last: string, n: number, kind: 'merged' | 'queued'): Pick<GroupRowVM, 'range' | 'text' | 'tone' | 'icon'> {
  if (kind === 'merged') {
    return { range: `${zeroPad(first)}–${zeroPad(last)}`, text: S.groupMerged(zeroPad(first), zeroPad(last), n), tone: 'info', icon: 'check' };
  }
  return { range: `${zeroPad(first)}–${zeroPad(last)}`, text: S.groupQueued(zeroPad(first), zeroPad(last), n), tone: 'neutral', icon: 'clock' };
}

function metCount(spec: SpecRun): number {
  return spec.criteria.filter((c) => c.state === 'met').length;
}

/** The "done-when" column text: "met/total". */
function doneWhenText(spec: SpecRun): string {
  const total = spec.spec.done_when.length;
  const met = total === 0 ? spec.criteria.length : metCount(spec);
  return `${met}/${total}`;
}

function criterionByVMs(spec: SpecRun): CriterionVM[] {
  return spec.spec.done_when.map((dw, index) => {
    const cr = spec.criteria[index];
    const state: CriterionVM['state'] = cr?.state ?? 'pending';
    let by: string;
    if (dw.by === 'audit') {
      const auditor = cr?.auditor?.agent ?? null;
      by = `audit · ${auditor ? agentName(auditor) : 'an agent'}`;
    } else {
      by = checkByLabel(dw.check);
    }
    const tone: ToneName = state === 'met' ? 'info' : state === 'not_met' ? 'err' : state === 'running' ? 'info' : 'neutral';
    return { text: dw.text, by, state, tone };
  });
}

function checkByLabel(check: Check): string {
  switch (check.kind) {
    case 'command': {
      const display = check.run.startsWith('npm run ') ? check.run.slice(8) : check.run;
      return `check · ${display}`;
    }
    case 'http':
      return `check · ${check.url}`;
    case 'screenshot':
      return `check · ${check.name}`;
    case 'file_rule':
      return 'check · file rule';
    case 'guardrail':
      return 'guardrail';
  }
}

export interface SpecRowListParams {
  readonly advance: SpecAdvance;
  readonly selectedId: string | null;
}

/** §12: collapses the leading merged run and the trailing queued run into group rows. */
export function specRows(specs: readonly SpecRun[], params: SpecRowListParams, ctx: SpecsViewContext): SpecRowListVM {
  const { advance, selectedId } = params;
  const ordered = [...specs].sort((a, b) => a.position - b.position);
  const rows: (SpecRowVM | GroupRowVM)[] = [];

  let first = 0;
  while (first < ordered.length && ordered[first]?.state === 'merged') {
    first++;
  }
  // Keep the two most recently merged specs visible for review context, while
  // folding older completed work into the history row.
  const groupEnd = first > 2 ? first - 2 : first;
  if (groupEnd > 0) {
    const group = ordered.slice(0, groupEnd);
    rows.push({
      key: `group-merged`,
      range: groupText(group[0]!.id, group.at(-1)!.id, group.length, 'merged').range,
      text: groupText(group[0]!.id, group.at(-1)!.id, group.length, 'merged').text,
      tone: 'info',
      icon: 'check',
    });
  }

  let last = ordered.length - 1;
  while (last >= first && ordered[last]?.state === 'queued') {
    const s = ordered[last]!;
    const prevId = ordered[last - 1]?.id;
    // Only fold into tail group if it has purely sequential dependency
    const isSequential = s.spec.depends_on.length === 0 ||
      (s.spec.depends_on.length === 1 && prevId && s.spec.depends_on[0] === prevId);
    if (!isSequential) break;
    last--;
  }

  for (let i = groupEnd; i <= last; i++) {
    rows.push(toSpecRow(ordered[i]!, ordered, advance, ctx, selectedId === ordered[i]!.id));
  }

  if (last < ordered.length - 1) {
    const group = ordered.slice(last + 1);
    rows.push({
      key: `group-queued`,
      range: groupText(group[0]!.id, group.at(-1)!.id, group.length, 'queued').range,
      text: groupText(group[0]!.id, group.at(-1)!.id, group.length, 'queued').text,
      tone: 'neutral',
      icon: 'clock',
    });
  }

  return rows;
}

function toSpecRow(
  spec: SpecRun,
  allSpecs: readonly SpecRun[],
  advance: SpecAdvance,
  ctx: SpecsViewContext,
  expanded: boolean,
): SpecRowVM {
  const status = specStatus(spec, allSpecs, advance);
  const agent = spec.implementer?.agent ?? null;
  const mono = agent ? AGENT_MONO[agent] ?? '' : '';
  const tileTone = agent ? AGENT_TILE[agent] : 'cc';
  const cost = formatCost(spec, ctx);
  const dw = doneWhenText(spec);
  const dwColor: ToneName = spec.spec.done_when.length > 0 && metCount(spec) === spec.spec.done_when.length ? 'info' : 'neutral';

  return {
    key: spec.id,
    number: spec.id,
    title: spec.spec.title,
    meta: status.secondLine,
    status,
    doneWhen: dw,
    doneWhenColor: dwColor,
    agent,
    mono,
    tileTone,
    who: whoText(spec, allSpecs, advance, ctx),
    cost,
    expanded,
    criteria: criterionByVMs(spec),
    dependsOn: spec.spec.depends_on.join(', ') || 'none',
    scope: spec.spec.scope.join(', ') || 'none',
  };
}

function whoText(spec: SpecRun, allSpecs: readonly SpecRun[], advance: SpecAdvance, ctx: SpecsViewContext): string {
  if (spec.implementer) {
    return `${agentName(spec.implementer.agent)} · ${accountName(spec.implementer.accountId, ctx)}`;
  }
  switch (spec.state) {
    case 'queued': {
      const dep = lowestUnsatisfiedDep(spec, allSpecs, advance);
      return dep ? `starts after ${dep}` : 'not started';
    }
    case 'blocked': {
      const id = spec.blockedBy[0] ?? spec.spec.depends_on[0] ?? '';
      return `Blocked by ${id}`;
    }
    case 'waiting_quota': {
      const agent = spec.spec.agent === 'auto' ? null : spec.spec.agent;
      return `Waiting for ${agent ? agentName(agent) : 'an agent'}`;
    }
    case 'needs_you':
      return 'Stopped';
    case 'skipped':
      return 'Skipped';
    case 'cancelled':
      return 'Cancelled';
  }
  return '';
}

function formatTokens(n: number): string {
  if (n >= 1_000_000) {
    return `${(n / 1_000_000).toFixed(2).replace(/\.00$/, '')}M`;
  }
  if (n >= 1000) {
    return `${Math.round(n / 1000)}k`;
  }
  return String(n);
}

function formatDurationMs(startedAt: string | null, finishedAt: string | null, now: Date): string {
  if (!startedAt) return '';
  const start = Date.parse(startedAt);
  if (Number.isNaN(start)) return '';
  const end = finishedAt ? Date.parse(finishedAt) : now.getTime();
  const ms = (end ?? now.getTime()) - start;
  if (ms < 0) return '';
  const seconds = Math.round(ms / 1000);
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.round(minutes / 60);
  return `${hours}h`;
}

function formatCost(spec: SpecRun, ctx: SpecsViewContext): string {
  const started = spec.startedAt != null;
  if (!started && spec.tokens === 0) {
    return '—';
  }
  const dur = formatDurationMs(spec.startedAt, spec.finishedAt, ctx.now);
  const tok = formatTokens(spec.tokens);
  return `${dur} · ${tok}`;
}

export function rulesOptions(settings: SpecQueueSettings): RulesVM {
  return {
    order: [
      { value: 'strict', label: S.orderOptions.strict, pressed: settings.order === 'strict' },
      { value: 'waves', label: S.orderOptions.waves, pressed: settings.order === 'waves' },
    ],
    advance: [
      { value: 'verified', label: S.advanceOptions.verified, pressed: settings.advance === 'verified' },
      { value: 'approved', label: S.advanceOptions.approved, pressed: settings.advance === 'approved' },
      { value: 'merged', label: S.advanceOptions.merged, pressed: settings.advance === 'merged' },
    ],
    onFail: [
      { value: 'retry-stop', label: S.onFailOptions(settings.retries)['retry-stop'], pressed: settings.on_fail === 'retry-stop' },
      { value: 'retry-skip', label: S.onFailOptions(settings.retries)['retry-skip'], pressed: settings.on_fail === 'retry-skip' },
    ],
  };
}

const ACTIVE_OR_WAITING: ReadonlySet<SpecState> = new Set(['running', 'verifying', 'auditing', 'waiting_quota', 'queued', 'blocked']);

function activeSpecTokens(specs: readonly SpecRun[]): number {
  return specs.filter((s) => s.state === 'running' || s.state === 'verifying' || s.state === 'auditing' || s.state === 'waiting_quota').reduce((sum, s) => sum + s.tokens, 0);
}

function activeAgentCount(specs: readonly SpecRun[]): number {
  const agents = new Set<string>();
  for (const s of specs) {
    if (s.implementer && (s.state === 'running' || s.state === 'verifying' || s.state === 'auditing' || s.state === 'waiting_quota')) {
      agents.add(s.implementer.agent);
    }
  }
  return agents.size;
}

function specNodeTone(state: SpecState): ToneName {
  return STATE_TONE[state];
}

function specNodeSub(spec: SpecRun, ctx: SpecsViewContext, advance: SpecAdvance): string {
  const tokens = formatTokens(spec.tokens);
  const dur = formatDurationMs(spec.startedAt, spec.finishedAt, ctx.now);
  if (spec.implementer) {
    const who = `${agentName(spec.implementer.agent)} · ${accountName(spec.implementer.accountId, ctx)}`;
    if (spec.attempt != null) {
      return `${who} · try ${spec.attempt} · ${dur} · ${tokens}`;
    }
    return `${who} · ${dur} · ${tokens}`;
  }
  switch (spec.state) {
    case 'queued': {
      const dep = lowestUnsatisfiedDep(spec, [], advance);
      return dep ? `waiting · starts when ${dep} is verified` : 'waiting · next in line';
    }
    case 'blocked':
      return `waiting · blocked by ${spec.blockedBy[0] ?? spec.spec.depends_on[0]}`;
    case 'waiting_quota': {
      const agent = spec.spec.agent === 'auto' ? null : spec.spec.agent;
      return `waiting · starts when ${agent ? agentName(agent) : 'an agent'} has room`;
    }
    default:
      return '—';
  }
}

function specNode(spec: SpecRun, ctx: SpecsViewContext, advance: SpecAdvance): MapNodeVM {
  return {
    id: spec.id,
    title: `Spec ${spec.id} · ${spec.spec.title}`,
    sub: specNodeSub(spec, ctx, advance),
    tone: specNodeTone(spec.state),
  };
}

function mapSteps(spec: SpecRun, ctx: SpecsViewContext): MapStepVM[] {
  const implementer = spec.implementer;
  const tokens = formatTokens(spec.tokens);
  const dur = formatDurationMs(spec.startedAt, spec.finishedAt, ctx.now);
  const who = implementer ? `${agentName(implementer.agent)} · ${accountName(implementer.accountId, ctx)}` : '—';

  const total = spec.spec.done_when.length;
  const met = metCount(spec);

  const auditCriterion = spec.criteria.find((c) => c.auditor);
  const auditText = auditCriterion?.summary ?? 'waiting for checks';
  const aud = auditCriterion?.auditor;
  const auditAgent = aud ? agentName(aud.agent) : 'an agent';

  return [
    { title: `Implement (spec ${spec.id})`, sub: implementer ? `${who} · try ${spec.attempt ?? 1} · ${dur} · ${tokens}` : 'not started', tone: implementer ? 'info' : 'neutral' },
    { title: `Checks: ${total} criteria`, sub: `orch · ${met}/${total} passed`, tone: met === total && total > 0 ? 'info' : met > 0 ? 'warn' : 'neutral' },
    { title: `Done-when audit 1–${total}`, sub: `${auditAgent} · ${auditText}`, tone: auditCriterion ? 'info' : 'neutral' },
  ];
}

export function mapViewModel(queue: SpecQueue, ctx: SpecsViewContext, selectedId: string | null): MapVM {
  const { settings, specs } = queue;
  const advance = settings.advance;

  const active = specs.filter((s) => ACTIVE_OR_WAITING.has(s.state));
  const nodes = active.sort((a, b) => a.position - b.position);
  const tokens = activeSpecTokens(specs);
  const agents = activeAgentCount(specs);

  const selectedSpec = selectedId ? specs.find((s) => s.id === selectedId) : nodes.find((n) => n.state === 'running' || n.state === 'verifying' || n.state === 'auditing') ?? nodes[0];

  return {
    runner: {
      id: 'runner',
      title: S.map.runner(baseName(queue.repoPath)),
      sub: S.map.agentsWorking(agents, formatTokens(tokens)),
      tone: 'info',
    },
    specNodes: nodes.map((spec) => specNode(spec, ctx, advance)),
    hasSelection: !!selectedSpec,
    steps: selectedSpec ? mapSteps(selectedSpec, ctx) : [],
    backgroundTasks: (settings.after_each ?? []).map((gate) => ({
      id: gate.name,
      title: gate.name,
      sub: `${gate.run} · ${gate.timeout_s}s · ${S.map.afterEveryVerified}`,
      tone: 'neutral' as ToneName,
    })),
  };
}

/** Problems list (§11), unchanged from load(). */
export function problemsList(problems: readonly SpecLoadProblem[]): readonly SpecLoadProblem[] {
  return problems;
}

export { formatTokens };
