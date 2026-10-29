/**
 * Jobs sidebar (screens.md, Work): jobs with their runs, and the one-line step status
 * under an open job. Shown only in Work and New job (DESIGN_RULES rule 8).
 */
import { useMemo, type CSSProperties } from 'react';
import { Icon } from '../../../../../../../design/icons/Icon.js';
import type { Job, Run, RunId, SpecRun } from '@orchagents/contracts';
import { useJobsStore, useRunsStore } from '../../../services/stores/work.js';
import { useSpecsStore } from '../../../services/stores/specs.js';
import { useWorkbenchStore } from '../../../services/workbenchStore.js';
import { agentBadge, jobStatusView, runStatusView } from '../model/statusModel.js';
import { jobMeta, partitionJobs, runRowIndentPx, stepLineView, tryForRun } from '../model/sidebarModel.js';
import { usePanesStore } from '../stores/panesStore.js';
import { useSidebarStore } from '../stores/sidebarStore.js';
import { AgentTile, StatusDot } from '../components/Badges.js';
import { cx } from '../components/cx.js';
import { workStrings } from '../strings.js';

const SIDEBAR_SIZE =
  'basis-[calc(var(--sidebar-w)_+_var(--space-10)_+_var(--space-18px)_+_var(--space-3))] w-[calc(var(--sidebar-w)_+_var(--space-10)_+_var(--space-18px)_+_var(--space-3))]';
const FOCUS_RING = 'focus-visible:outline-2 focus-visible:outline-focus focus-visible:-outline-offset-2';

export function JobsSidebar() {
  const jobs = useJobsStore((s) => s.jobs);
  const runs = useRunsStore((s) => s.runs);
  const queues = useSpecsStore((s) => s.queues);
  const openJobs = useSidebarStore((s) => s.openJobs);
  const setJobOpen = useSidebarStore((s) => s.setJobOpen);
  const activeA = usePanesStore((s) => s.activeA);
  const activeB = usePanesStore((s) => s.activeB);
  const visibleIds = useMemo(() => visibleRunIds(activeA, activeB), [activeA, activeB]);
  const activeRoute = useWorkbenchStore((s) => s.activeRoute);
  const activeProject = useWorkbenchStore((s) => s.activeProject);
  const setActiveRoute = useWorkbenchStore((s) => s.setActiveRoute);

  const { specJobs, nonSpecJobs, specForJob } = useMemo(
    () => partitionJobs(jobs, queues, activeProject),
    [jobs, queues, activeProject],
  );

  const isLive = activeRoute === '/specs' || activeRoute === '/work';

  const openRun = (runId: RunId) => {
    usePanesStore.getState().dispatch({ type: 'open', runId });
  };

  return (
    <aside
      aria-label={workStrings.sidebar.ariaLabel}
      className={cx(
        'flex shrink-0 flex-col gap-1 px-3 py-5 box-border border-r border-line bg-chrome min-h-0 overflow-y-auto',
        'in-data-[menu-side=right]:border-r-0 in-data-[menu-side=right]:border-l',
        SIDEBAR_SIZE,
      )}
    >
      <div className="flex items-center gap-1 px-2 pt-2px pb-2">
        <span className="flex-auto text-11px tracking-[0.08em] uppercase text-muted2 font-semibold">{workStrings.sidebar.title}</span>
        <button
          type="button"
          className={cx('flex items-center justify-center w-[28px] h-[28px] rounded-sm border-0 bg-transparent text-muted2 cursor-pointer', FOCUS_RING)}
          aria-label={workStrings.sidebar.filterAria}
        >
          <Icon name="filter" size={14} weight={1.8} />
        </button>
        <button
          type="button"
          className={cx('flex items-center justify-center w-[28px] h-[28px] rounded-sm border-0 bg-transparent text-muted2 cursor-pointer', FOCUS_RING)}
          aria-label={workStrings.sidebar.newJobAria}
          onClick={() => setActiveRoute('/jobs/new')}
        >
          <Icon name="plus" size={14} weight={2} />
        </button>
      </div>

      {specJobs.map((job) => {
        const jobRuns = runs.filter((run) => run.jobId === job.id);
        const expandable = jobRuns.length > 0;
        const isOpen = expandable && (openJobs[job.id] ?? job.status === 'running');
        return (
          <JobRow
            key={job.id}
            job={job}
            spec={specForJob(job)}
            runs={jobRuns}
            meta={jobMeta(job, jobRuns.length)}
            expandable={expandable}
            isOpen={isOpen}
            onToggle={() => setJobOpen(job.id, !isOpen)}
            selectedIds={isLive ? visibleIds : EMPTY_IDS}
            onOpenRun={openRun}
          />
        );
      })}

      {nonSpecJobs.length > 0 && (
        <>
          <div className="pt-3 pb-1 px-2 text-11px tracking-[0.08em] uppercase text-muted2 font-semibold">
            {workStrings.sidebar.notFromSpec}
          </div>
          {nonSpecJobs.map((job) => {
            const jobRuns = runs.filter((run) => run.jobId === job.id);
            const expandable = jobRuns.length > 0;
            const isOpen = expandable && (openJobs[job.id] ?? job.status === 'running');
            return (
              <JobRow
                key={job.id}
                job={job}
                runs={jobRuns}
                meta={jobMeta(job, jobRuns.length)}
                expandable={expandable}
                isOpen={isOpen}
                onToggle={() => setJobOpen(job.id, !isOpen)}
                selectedIds={isLive ? visibleIds : EMPTY_IDS}
                onOpenRun={openRun}
              />
            );
          })}
        </>
      )}

      <div className="flex-auto" />

      <div className="flex flex-col gap-1 mx-1 mt-3 p-4 border border-line rounded-lg text-2xs text-muted2">
        <span className="text-text3 font-medium">{workStrings.sidebar.hint.title}</span>
        <span>{activeRoute === '/jobs/new' ? workStrings.sidebar.hint.newJobText : workStrings.sidebar.hint.text}</span>
      </div>
    </aside>
  );
}

const EMPTY_IDS: readonly RunId[] = [];

function visibleRunIds(activeA: RunId | null, activeB: RunId | null): readonly RunId[] {
  const ids: RunId[] = [];
  if (activeA) ids.push(activeA);
  if (activeB) ids.push(activeB);
  return ids;
}

interface JobRowProps {
  readonly job: Job;
  readonly spec?: SpecRun | undefined;
  readonly runs: readonly Run[];
  readonly meta: string;
  readonly expandable: boolean;
  readonly isOpen: boolean;
  readonly selectedIds: readonly RunId[];
  readonly onToggle: () => void;
  readonly onOpenRun: (runId: RunId) => void;
}

function JobRow({ job, spec, runs, meta, expandable, isOpen, selectedIds, onToggle, onOpenRun }: JobRowProps) {
  const status = jobStatusView(job.status);
  return (
    <div className="flex flex-col">
      <button
        type="button"
        className={cx(
          'flex items-center gap-2 min-h-[36px] px-2 py-7px border-0 rounded-sm bg-transparent text-text text-left cursor-pointer disabled:cursor-default',
          FOCUS_RING,
        )}
        aria-expanded={expandable ? isOpen : undefined}
        disabled={!expandable}
        onClick={onToggle}
      >
        <Icon
          name="chevRight"
          size={13}
          weight={2}
          className={cx('flex-none text-muted2 transition-none', isOpen && 'rotate-90')}
        />
        <StatusDot view={status} />
        <span className="flex-auto min-w-0 font-medium truncate">
          {spec ? (
            <>
              <span className="font-mono text-xs text-muted2">{spec.id}</span>
              {' · '}
              <span>{spec.spec.title}</span>
            </>
          ) : (
            job.title
          )}
        </span>
        {meta && <span className="flex-none text-muted2 text-11px">{meta}</span>}
      </button>

      {isOpen && job.step && job.status !== 'done' && job.status !== 'failed' && job.status !== 'cancelled' ? <StepLine job={job} /> : null}

      {isOpen
        ? runs.map((run) => (
            <RunRow
              key={run.id}
              run={run}
              spec={spec}
              selected={selectedIds.includes(run.id)}
              onOpen={() => onOpenRun(run.id)}
            />
          ))
        : null}
    </div>
  );
}

function StepLine({ job }: { job: Job }) {
  if (!job.step || job.status === 'done' || job.status === 'failed' || job.status === 'cancelled') return null;
  const view = stepLineView(job.step);
  return (
    <div
      className={cx(
        'flex items-center gap-2 mr-2 ml-26px mb-1 px-3 py-5px rounded-sm text-xs',
        view.looping ? 'bg-warn-bg text-warn' : 'bg-panel2 text-muted',
      )}
      title={workStrings.sidebar.stepsTitle}
    >
      <Icon name={view.looping ? 'alert' : 'sync'} size={11} weight={2.2} />
      <span className="flex-auto min-w-0 truncate">{`${view.now} · ${view.progress}`}</span>
      <span className="flex-none font-mono text-2xs">{view.attempt}</span>
    </div>
  );
}

interface RunRowProps {
  readonly run: Run;
  readonly spec?: SpecRun | undefined;
  readonly selected: boolean;
  readonly onOpen: () => void;
}

function RunRow({ run, spec, selected, onOpen }: RunRowProps) {
  const badge = agentBadge(run.agent);
  const status = runStatusView(run.status);
  const indent = { ['--row-indent' as string]: `${runRowIndentPx(run.depth)}px` } as CSSProperties;
  const title = spec ? `${spec.id} · ${spec.spec.title} · try ${tryForRun(spec, run.startedAt)}` : run.task;
  return (
    <button
      type="button"
      className={cx(
        'flex items-center gap-3 min-h-hit-min px-3 py-5px border-0 rounded-sm text-text2 text-left cursor-pointer',
        selected && 'bg-rowsel',
        FOCUS_RING,
      )}
      aria-pressed={selected}
      onClick={onOpen}
    >
      <span className="shrink-0 basis-(--row-indent)" style={indent} aria-hidden="true" />
      <AgentTile badge={badge} />
      <span className="flex-none font-mono text-2xs text-muted2">{run.id}</span>
      <span className="flex-auto min-w-0 truncate text-sm">{title}</span>
      <StatusDot view={status} />
    </button>
  );
}
