import type { Counts, FactoryAnswers, FactoryPipeline, PipelineRunState, PipelineStage, TrailRow } from '@orchagents/contracts';

export type ProductView = 'map' | 'gates' | 'design' | 'trail' | 'files';
export type TrailFilter = 'all' | 'operator' | 'agent';
export const productWizardSteps = ['Brief', 'What you already have', 'Build', 'How far', 'Specs', 'Summary'] as const;
export type ProductWizardStep = (typeof productWizardSteps)[number];
export type WizardChoice = 'generate' | 'skip' | 'file';
export const productWizardStepTitles = [
  'What are you building?',
  'What do you already have?',
  'What should it include?',
  'How far should it go?',
  'How should the specs run?',
  'Ready to set up tidepool?',
] as const;
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

export type WizardSummaryRow = { label: string; value: string; target: number; multiline?: boolean };

export function wizardSummaryRows(input: {
  brief: string;
  attachments: readonly string[];
  choices: Readonly<Record<string, WizardChoice>>;
  paths: Readonly<Record<string, string>>;
  surfaces: readonly string[];
  scope: 'design' | 'build' | 'full';
  specs: 'one-by-one' | 'parallel' | 'manual';
}): WizardSummaryRow[] {
  const brief = [input.brief.trim(), ...input.attachments.map((path) => `Attached: ${path}`)].filter(Boolean).join('\n');
  return [
    { label: 'Brief', value: brief, target: 0, multiline: true },
    ...(['research', 'value_map', 'prd', 'architecture'] as const).map((key) => ({
      label: ({ research: 'Research', value_map: 'Value map', prd: 'PRD', architecture: 'Architecture' } as const)[key],
      value: input.choices[key] === 'file' ? input.paths[key] ?? '' : input.choices[key] === 'generate' ? 'Generate' : 'Skip',
      target: 1,
    })),
    { label: 'Build', value: input.surfaces.map((surface) => surface === 'web' ? 'Marketing site' : 'Console').join(' and '), target: 2 },
    { label: 'How far', value: input.scope === 'design' ? 'Design only' : input.scope === 'build' ? 'Build the surfaces' : 'The whole product', target: 3 },
    { label: 'Specs', value: input.specs === 'one-by-one' ? 'One by one' : input.specs === 'parallel' ? 'In parallel' : 'I’ll run them', target: 4 },
  ];
}

export function wizardHasFooterFade(scrollHeight: number, clientHeight: number, scrollTop = 0): boolean {
  return scrollHeight > clientHeight + 1 && scrollTop < scrollHeight - clientHeight - 1;
}

export function wizardCanAdvance(step: number, values: { brief: string; attachments: readonly string[]; choices: Readonly<Record<string, WizardChoice>>; paths: Readonly<Record<string, string>>; surfaces: readonly string[] }): boolean {
  if (step === 0) return values.brief.trim().length > 0 || values.attachments.length > 0;
  if (step === 1) return ['research', 'value_map', 'prd', 'architecture'].every((key) => values.choices[key] !== 'file' || Boolean(values.paths[key]?.trim()));
  if (step === 2) return values.surfaces.length > 0;
  return true;
}

export function wizardValidationMessage(step: number, values: { brief: string; attachments: readonly string[]; choices: Readonly<Record<string, WizardChoice>>; paths: Readonly<Record<string, string>>; surfaces: readonly string[] }, showValidation = false): string {
  if (!showValidation) return '';
  if (step === 0 && !wizardCanAdvance(step, values)) return 'Add a brief or choose a file or folder to continue.';
  if (step === 1 && !wizardCanAdvance(step, values)) return 'Choose a file for each row set to Choose file.';
  if (step === 2 && !wizardCanAdvance(step, values)) return 'Choose Marketing site, Console, or both.';
  return '';
}

export function wizardChangeStep(summaryIndex: number, targetIndex: number): { step: number; returnToSummary: boolean } {
  return { step: targetIndex, returnToSummary: targetIndex !== summaryIndex };
}

export function wizardContinueStep(step: number, summaryIndex: number, returnToSummary: boolean): { step: number; returnToSummary: boolean } {
  if (returnToSummary && step !== summaryIndex) return { step: summaryIndex, returnToSummary: false };
  return { step: Math.min(summaryIndex, step + 1), returnToSummary: false };
}

export function makeFactoryAnswers(input: Omit<FactoryAnswers, 'agent'>): FactoryAnswers {
  return { ...input, agent: 'auto' };
}

export function wizardMotionSettings(reducedMotion: boolean): { slide: boolean; response: number; crossFadeMs: number } {
  return reducedMotion ? { slide: false, response: 0.35, crossFadeMs: 150 } : { slide: true, response: 0.35, crossFadeMs: 0 };
}

export function wizardArrowIndex(index: number, key: string, length: number): number | null {
  if (length < 1) return null;
  if (key === 'ArrowRight' || key === 'ArrowDown') return (index + 1) % length;
  if (key === 'ArrowLeft' || key === 'ArrowUp') return (index - 1 + length) % length;
  return null;
}

export function wizardKeyAction(key: string, options: { textArea: boolean; command: boolean; valid: boolean; step: number }): 'back' | 'continue' | 'insert' | 'none' {
  if (key === 'Escape') return options.step > 0 ? 'back' : 'none';
  if (key !== 'Enter') return 'none';
  if (options.textArea && !options.command) return 'insert';
  return options.valid ? 'continue' : 'none';
}

export interface SpringValue { readonly value: number; readonly velocity: number }

/** Exact critically damped spring step (damping ratio 1, response 0.35s). */
export function stepWizardSpring(current: SpringValue, target: number, elapsedSeconds: number, response = 0.35): SpringValue {
  const omega = 4 / response;
  const displacement = current.value - target;
  const c = current.velocity + omega * displacement;
  const decay = Math.exp(-omega * elapsedSeconds);
  return {
    value: target + (displacement + c * elapsedSeconds) * decay,
    velocity: (current.velocity - omega * c * elapsedSeconds) * decay,
  };
}
