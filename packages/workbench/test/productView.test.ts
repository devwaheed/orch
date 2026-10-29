import { describe, expect, it } from 'vitest';
import type { FactoryPipeline, PipelineRunState, TrailRow } from '@orchagents/contracts';
import { countLine, filterTrail, gatesInOpenFirst, makeFactoryAnswers, productWizardSteps, runControlState, stagesByGroup, stateText, stepWizardSpring, wizardArrowIndex, wizardCanAdvance, wizardChangeStep, wizardContinueStep, wizardHasFooterFade, wizardKeyAction, wizardMotionSettings, wizardStepLabel, wizardSummaryRows, wizardValidationMessage } from '../src/browser/contrib/product/productView.js';
import { useWorkbenchStore } from '../src/browser/services/workbenchStore.js';

const stages = [
  { id: 'brief', title: 'Brief', group: 'planning', state: 'done', answer: null },
  { id: 'prototype', title: 'Prototype', group: 'design', state: 'needs_you', gate: true, question: 'Approve?', answer: null },
  { id: 'build', title: 'Build', group: 'build', state: 'queued', answer: null },
] as FactoryPipeline['stages'];
const pipeline = {
  product: 'Tidemark', stages,
  counts: { total: 3, done: 1, next: 0, needs_you: 1, left: 2, gates_ahead: 1 },
  groups: {}, now: stages[1] ?? null,
} as FactoryPipeline;

describe('product view models', () => {
  it('formats the overall counts line exactly as §5', () => {
    expect(countLine(pipeline.counts)).toBe('1 of 3 done · 1 need you · 2 left');
  });
  it('keeps factory group order and stages', () => {
    expect(stagesByGroup(pipeline).design.map((stage) => stage.id)).toEqual(['prototype']);
  });
  it('uses the state pill wording from §4', () => {
    expect(stateText).toEqual({ done: 'Done', have: 'You had it', skipped: 'Skipped', next: 'Now', needs_you: 'Needs you', queued: 'Later' });
  });
  it('puts the open gate first', () => {
    expect(gatesInOpenFirst([{ ...stages[2]!, gate: true }, stages[1]!])[0]?.id).toBe('prototype');
  });
  it('filters trail decisions and sorts newest first', () => {
    const rows = [
      { time: '2026-10-28T12:00:00Z', stage: 'x', kind: 'decision', by: 'agent', summary: 'Agent', evidence: [] },
      { time: '2026-10-29T12:00:00Z', stage: 'x', kind: 'gate', by: 'operator', summary: 'You', evidence: [] },
    ] as TrailRow[];
    expect(filterTrail(rows, 'operator').map((row) => row.summary)).toEqual(['You']);
    expect(filterTrail(rows, 'all')[0]?.summary).toBe('You');
  });
  it('maps pipeline run controls to header actions', () => {
    const states: PipelineRunState['state'][] = ['working', 'paused', 'waiting_gate', 'stopped', 'done'];
    expect(states.map((state) => runControlState({ jobId: 'j-1' as PipelineRunState['jobId'], state, stage: null, reason: null }))).toEqual([
      'working', 'paused', 'waiting', 'stopped', 'done',
    ]);
    expect(runControlState(null)).toBe('start');
  });
  it('uses the six-step wizard with a single merged document step', () => {
    expect(productWizardSteps).toEqual(['Brief', 'What you already have', 'Build', 'How far', 'Specs', 'Summary']);
    expect(wizardStepLabel(1)).toBe('Step 2 of 6');
  });
  it('builds compact summary rows and marks the brief for two-line truncation', () => {
    const rows = wizardSummaryRows({ brief: '  A compact surf school booking site.  ', attachments: ['/refs/brand.pdf'], choices: { research: 'generate', value_map: 'skip', prd: 'file', architecture: 'generate' }, paths: { prd: '/docs/product.md' }, surfaces: ['web', 'console'], scope: 'full', specs: 'parallel' });
    expect(rows).toHaveLength(8);
    expect(rows[0]).toMatchObject({ label: 'Brief', value: 'A compact surf school booking site.\nAttached: /refs/brand.pdf', target: 0, multiline: true });
    expect(rows.slice(1).every((row) => !row.multiline)).toBe(true);
    expect(rows.map((row) => row.label)).toEqual(['Brief', 'Research', 'Value map', 'PRD', 'Architecture', 'Build', 'How far', 'Specs']);
  });
  it('shows a soft footer fade only while wizard content overflows its scroll area', () => {
    expect(wizardHasFooterFade(500, 500)).toBe(false);
    expect(wizardHasFooterFade(501, 500)).toBe(false);
    expect(wizardHasFooterFade(510, 500, 0)).toBe(true);
    expect(wizardHasFooterFade(510, 500, 10)).toBe(false);
  });
  it('can close and restore the terminal dock using its stored open state', () => {
    const store = useWorkbenchStore.getState();
    store.setTerminalOpen(true);
    expect(useWorkbenchStore.getState().terminalOpen).toBe(true);
    useWorkbenchStore.getState().setTerminalOpen(false);
    expect(useWorkbenchStore.getState().terminalOpen).toBe(false);
    useWorkbenchStore.getState().setTerminalOpen(true);
    expect(useWorkbenchStore.getState().terminalOpen).toBe(true);
    useWorkbenchStore.getState().setTerminalOpen(false);
  });
  it('validates required brief, document paths and build surfaces', () => {
    const choices = { research: 'generate', value_map: 'skip', prd: 'file', architecture: 'generate' } as const;
    const values = { brief: '  ', attachments: [], choices, paths: { prd: '' }, surfaces: ['web'] };
    expect(wizardCanAdvance(0, values)).toBe(false);
    expect(wizardCanAdvance(0, { ...values, attachments: ['/tmp/brief.md'] })).toBe(true);
    expect(wizardCanAdvance(1, values)).toBe(false);
    expect(wizardCanAdvance(1, { ...values, paths: { prd: '/tmp/prd.md' } })).toBe(true);
    expect(wizardCanAdvance(2, { ...values, surfaces: [] })).toBe(false);
    expect(wizardCanAdvance(2, values)).toBe(true);
  });
  it('keeps validation hidden until the user interacts with an invalid step', () => {
    const values = { brief: '', attachments: [], choices: { research: 'generate', value_map: 'generate', prd: 'generate', architecture: 'generate' }, paths: {}, surfaces: ['web'] } as const;
    expect(wizardValidationMessage(0, values)).toBe('');
    expect(wizardValidationMessage(0, values, true)).toBe('Add a brief or choose a file or folder to continue.');
    expect(wizardValidationMessage(0, { ...values, brief: 'A product' }, true)).toBe('');
  });
  it('always sends the factory agent as auto', () => {
    expect(makeFactoryAnswers({ brief: 'A product', have: {}, surfaces: ['web'], scope: 'full', specs: 'parallel' }).agent).toBe('auto');
  });
  it('routes Summary Change back to Summary after Continue', () => {
    expect(wizardChangeStep(5, 2)).toEqual({ step: 2, returnToSummary: true });
    expect(wizardContinueStep(2, 5, true)).toEqual({ step: 5, returnToSummary: false });
    expect(wizardContinueStep(1, 5, false)).toEqual({ step: 2, returnToSummary: false });
  });
  it('maps Return, Escape and radio arrows to wizard keyboard actions', () => {
    expect(wizardKeyAction('Enter', { textArea: true, command: false, valid: true, step: 0 })).toBe('insert');
    expect(wizardKeyAction('Enter', { textArea: true, command: true, valid: true, step: 0 })).toBe('continue');
    expect(wizardKeyAction('Enter', { textArea: false, command: false, valid: false, step: 0 })).toBe('none');
    expect(wizardKeyAction('Escape', { textArea: false, command: false, valid: true, step: 2 })).toBe('back');
    expect(wizardArrowIndex(0, 'ArrowDown', 3)).toBe(1);
    expect(wizardArrowIndex(0, 'ArrowLeft', 3)).toBe(2);
  });
  it('settles a critically damped spring without crossing its target', () => {
    let state = { value: 24, velocity: 0 };
    for (let frame = 0; frame < 120; frame += 1) {
      state = stepWizardSpring(state, 0, 1 / 60);
      expect(state.value).toBeGreaterThanOrEqual(0);
    }
    expect(state.value).toBeCloseTo(0, 4);
    expect(state.velocity).toBeCloseTo(0, 3);
  });
  it('uses a 150 ms cross-fade and no slide for reduced motion', () => {
    expect(wizardMotionSettings(true)).toEqual({ slide: false, response: 0.35, crossFadeMs: 150 });
    expect(wizardMotionSettings(false)).toEqual({ slide: true, response: 0.35, crossFadeMs: 0 });
  });
});
