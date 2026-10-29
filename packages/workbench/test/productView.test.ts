import { describe, expect, it } from 'vitest';
import type { FactoryPipeline, PipelineRunState, TrailRow } from '@orchagents/contracts';
import { countLine, filterTrail, gatesInOpenFirst, productWizardSteps, runControlState, stagesByGroup, stateText, wizardCanAdvance, wizardStepLabel } from '../src/browser/contrib/product/productView.js';

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
  it('keeps wizard steps in the factory order and validates required answers', () => {
    expect(productWizardSteps).toHaveLength(10);
    expect(wizardStepLabel(1)).toBe('Step 2 of 10');
    expect(wizardCanAdvance(0, { brief: '  ', choice: null, filePath: '', surfaces: ['web'] })).toBe(false);
    expect(wizardCanAdvance(2, { brief: 'A product', choice: 'file', filePath: '', surfaces: ['web'] })).toBe(false);
    expect(wizardCanAdvance(5, { brief: 'A product', choice: null, filePath: '', surfaces: [] })).toBe(false);
  });
});
