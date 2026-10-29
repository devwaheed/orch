import type { Counts, FactoryPipeline, PipelineRunState, PipelineStage, TrailRow } from '@orchagents/contracts';

export type ProductView = 'map' | 'gates' | 'design' | 'trail' | 'files';
export type TrailFilter = 'all' | 'operator' | 'agent';
export const productWizardSteps = ['Brief', 'Research', 'Value map', 'PRD', 'Architecture', 'Build', 'How far', 'Specs after design', 'Who builds it', 'Summary'] as const;
export const groupOrder = ['planning', 'design', 'build'] as const;
export const groupTitle = { planning: 'Planning', design: 'Design', build: 'Build' } as const;
export const stateText: Record<PipelineStage['state'], string> = {
  done: 'Done', have: 'You had it', skipped: 'Skipped', next: 'Now', needs_you: 'Needs you', queued: 'Later',
};

export function countLine(counts: Counts): string {
  return `${counts.done} of ${counts.total} done · ${counts.needs_you} need you · ${counts.left} left`;
}

export function stagesByGroup(pipeline: FactoryPipeline): Record<(typeof groupOrder)[number], PipelineStage[]> {
  return {
    planning: pipeline.stages.filter((stage) => stage.group === 'planning'),
    design: pipeline.stages.filter((stage) => stage.group === 'design'),
    build: pipeline.stages.filter((stage) => stage.group === 'build'),
  };
}

export function gatesInOpenFirst(stages: readonly PipelineStage[]): PipelineStage[] {
  return [...stages.filter((stage) => stage.gate)].sort((a, b) => Number(b.state === 'needs_you') - Number(a.state === 'needs_you'));
}

export function filterTrail(rows: readonly TrailRow[], filter: TrailFilter): TrailRow[] {
  const filtered = filter === 'all' ? [...rows] : rows.filter((row) => row.by === filter);
  return filtered.sort((a, b) => Date.parse(b.time) - Date.parse(a.time));
}

export function runControlState(run: PipelineRunState | null): 'start' | 'working' | 'paused' | 'waiting' | 'stopped' | 'done' {
  if (!run) return 'start';
  return run.state === 'waiting_gate' || run.state === 'waiting_build' ? 'waiting' : run.state;
}

export function remainingStages(pipeline: FactoryPipeline): PipelineStage[] {
  return pipeline.stages.filter((stage) => !['done', 'have', 'skipped'].includes(stage.state));
}

export function trailActor(by: TrailRow['by']): string { return by === 'operator' ? 'You' : 'Agent'; }

export function wizardStepLabel(index: number): string {
  return `Step ${index + 1} of ${productWizardSteps.length}`;
}

export function wizardCanAdvance(step: number, values: { brief: string; choice: 'generate' | 'skip' | 'file' | null; filePath: string; surfaces: readonly string[] }): boolean {
  if (step === 0) return values.brief.trim().length > 0;
  if (step >= 1 && step <= 4) return values.choice !== 'file' || values.filePath.trim().length > 0;
  if (step === 5) return values.surfaces.length > 0;
  return true;
}
