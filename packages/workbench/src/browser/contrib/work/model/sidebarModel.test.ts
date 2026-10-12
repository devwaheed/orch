import { describe, expect, it } from 'vitest';
import { stepLineView, runRowIndentPx, jobMeta } from './sidebarModel.js';

describe('stepLineView', () => {
  it('builds "Now: … · step i of n · try k" from the job step', () => {
    const view = stepLineView({ name: 'Implement', index: 2, total: 5, attempt: 1, looping: false });
    expect(view.now).toBe('Now: Implement');
    expect(view.progress).toBe('step 2 of 5');
    expect(view.attempt).toBe('try 1');
    expect(view.text).toBe('Now: Implement · step 2 of 5 · try 1');
    expect(view.looping).toBe(false);
  });

  it('keeps looping true so the line turns amber', () => {
    const view = stepLineView({ name: 'Verify', index: 4, total: 5, attempt: 3, looping: true });
    expect(view.text).toBe('Now: Verify · step 4 of 5 · try 3');
    expect(view.looping).toBe(true);
  });
});

describe('runRowIndentPx', () => {
  it('indents each depth level by 14px under a 14px base', () => {
    expect(runRowIndentPx(0)).toBe(14);
    expect(runRowIndentPx(1)).toBe(28);
    expect(runRowIndentPx(2)).toBe(42);
  });
});

describe('jobMeta', () => {
  it('shows run count, scheduled local reset and completed state', () => {
    const scheduledFor = new Date(2026, 9, 11, 15).toISOString();
    expect(jobMeta({ status: 'running', scheduledFor: null }, 6)).toBe('6 runs');
    expect(jobMeta({ status: 'waiting_quota', scheduledFor }, 0)).toBe('15:00');
    expect(jobMeta({ status: 'done', scheduledFor: null }, 0)).toBe('done');
  });
});
