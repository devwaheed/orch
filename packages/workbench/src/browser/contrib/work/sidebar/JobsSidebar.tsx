/**
 * Jobs sidebar (screens.md, Work): jobs with their runs, and the one-line step status
 * under an open job. Shown only in Work and New job (DESIGN_RULES rule 8).
 */
import { useMemo, type CSSProperties } from 'react';
import { Icon } from '../../../../../../../design/icons/Icon.js';
import type { Job, Run, RunId } from '@orchagents/contracts';
import { useJobsStore, useRunsStore } from '../../../services/stores/work.js';
import { useWorkbenchStore } from '../../../services/workbenchStore.js';
import { agentBadge, jobStatusView, runStatusView } from '../model/statusModel.js';
import { jobMeta, runRowIndentPx, stepLineView } from '../model/sidebarModel.js';
import { usePanesStore } from '../stores/panesStore.js';
import { useSidebarStore } from '../stores/sidebarStore.js';
import { AgentTile, StatusDot } from '../components/Badges.js';
import { workStrings } from '../strings.js';
import styles from './JobsSidebar.module.css';

export function JobsSidebar() {
  const jobs = useJobsStore((s) => s.jobs);
  const runs = useRunsStore((s) => s.runs);
  const openJobs = useSidebarStore((s) => s.openJobs);
  const setJobOpen = useSidebarStore((s) => s.setJobOpen);
  const activeA = usePanesStore((s) => s.activeA);
  const activeB = usePanesStore((s) => s.activeB);
  const visibleIds = useMemo(() => visibleRunIds(activeA, activeB), [activeA, activeB]);
  const activeRoute = useWorkbenchStore((s) => s.activeRoute);
  const setActiveRoute = useWorkbenchStore((s) => s.setActiveRoute);

  const onWork = activeRoute === '/work';

  const openRun = (runId: RunId) => {
    usePanesStore.getState().dispatch({ type: 'open', runId });
    setActiveRoute('/work');
  };

  return (
    <aside aria-label={workStrings.sidebar.ariaLabel} className={styles.sidebar}>
      <div className={styles.header}>
        <span className={styles.title}>{workStrings.sidebar.title}</span>
        <button
          type="button"
          className={styles.iconButton}
          aria-label={workStrings.sidebar.filterAria}
        >
          <Icon name="filter" size={14} weight={1.8} />
        </button>
        <button
          type="button"
          className={styles.iconButton}
          aria-label={workStrings.sidebar.newJobAria}
          onClick={() => setActiveRoute('/jobs/new')}
        >
          <Icon name="plus" size={14} weight={2} />
        </button>
      </div>

      {jobs.map((job) => {
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
            selectedIds={onWork ? visibleIds : EMPTY_IDS}
            onOpenRun={openRun}
          />
        );
      })}

      <div className={styles.spacer} />

      <div className={styles.hint}>
        <span className={styles.hintTitle}>{workStrings.sidebar.hint.title}</span>
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
  readonly runs: readonly Run[];
  readonly meta: string;
  readonly expandable: boolean;
  readonly isOpen: boolean;
  readonly selectedIds: readonly RunId[];
  readonly onToggle: () => void;
  readonly onOpenRun: (runId: RunId) => void;
}

function JobRow({ job, runs, meta, expandable, isOpen, selectedIds, onToggle, onOpenRun }: JobRowProps) {
  const status = jobStatusView(job.status);
  return (
    <div className={styles.job}>
      <button
        type="button"
        className={styles.jobButton}
        aria-expanded={expandable ? isOpen : undefined}
        disabled={!expandable}
        onClick={onToggle}
      >
        <Icon
          name="chevRight"
          size={13}
          weight={2}
          className={`${styles.chevron} ${isOpen ? styles.chevronOpen : ''}`}
        />
        <StatusDot view={status} />
        <span className={styles.jobTitle}>{job.title}</span>
        {meta && <span className={styles.jobMeta}>{meta}</span>}
      </button>

      {isOpen && job.step ? <StepLine job={job} /> : null}

      {isOpen
        ? runs.map((run) => (
            <RunRow
              key={run.id}
              run={run}
              selected={selectedIds.includes(run.id)}
              onOpen={() => onOpenRun(run.id)}
            />
          ))
        : null}
    </div>
  );
}

function StepLine({ job }: { job: Job }) {
  if (!job.step) return null;
  const view = stepLineView(job.step);
  return (
    <div
      className={`${styles.stepLine} ${view.looping ? styles.stepLooping : styles.stepNormal}`}
      title={workStrings.sidebar.stepsTitle}
    >
      <Icon name={view.looping ? 'alert' : 'sync'} size={11} weight={2.2} />
      <span className={styles.stepText}>{`${view.now} · ${view.progress}`}</span>
      <span className={styles.stepAttempt}>{view.attempt}</span>
    </div>
  );
}

interface RunRowProps {
  readonly run: Run;
  readonly selected: boolean;
  readonly onOpen: () => void;
}

function RunRow({ run, selected, onOpen }: RunRowProps) {
  const badge = agentBadge(run.agent);
  const status = runStatusView(run.status);
  const indent = { ['--row-indent' as string]: `${runRowIndentPx(run.depth)}px` } as CSSProperties;
  return (
    <button
      type="button"
      className={`${styles.runRow} ${selected ? styles.runRowSelected : ''}`}
      aria-pressed={selected}
      onClick={onOpen}
    >
      <span className={styles.indent} style={indent} aria-hidden="true" />
      <AgentTile badge={badge} />
      <span className={styles.runId}>{run.id}</span>
      <span className={styles.runTask}>{run.task}</span>
      <StatusDot view={status} />
    </button>
  );
}
