import { describe, expect, it } from 'vitest';
import { SpecFile, SpecQueueSettings, SPEC_QUEUE_DEFAULTS, SpecState } from '../common/index.js';

const valid = {
  id: '42',
  title: 'Integration tests for the callback flow',
  depends_on: ['41'],
  scope: ['test/auth/**'],
  done_when: [
    { by: 'check', text: 'Unknown state returns 400', check: { kind: 'command', run: 'npm test -- callback' } },
    { by: 'audit', text: 'Error codes match docs/api/errors.md' },
  ],
};

describe('spec file front matter', () => {
  it('accepts the template example', () => {
    expect(SpecFile.safeParse(valid).success).toBe(true);
  });
  it('needs at least one done-when line', () => {
    expect(SpecFile.safeParse({ ...valid, done_when: [] }).success).toBe(false);
  });
  it('rejects unknown keys so typos are caught', () => {
    expect(SpecFile.safeParse({ ...valid, depends: ['41'] }).success).toBe(false);
  });
  it('a check criterion needs a check', () => {
    expect(SpecFile.safeParse({ ...valid, done_when: [{ by: 'check', text: 'x' }] }).success).toBe(false);
  });
  it('defaults agent to auto and scope to empty', () => {
    const r = SpecFile.parse({ id: '1', title: 't', done_when: [{ by: 'audit', text: 'x' }] });
    expect(r.agent).toBe('auto');
    expect(r.scope).toEqual([]);
  });
});

describe('queue settings', () => {
  it('defaults match the locked decisions', () => {
    const r = SpecQueueSettings.parse({});
    expect(r.order).toBe(SPEC_QUEUE_DEFAULTS.order);
    expect(r.advance).toBe('verified');
    expect(r.on_fail).toBe('retry-stop');
    expect(r.max_parallel).toBe(2);
    expect(r.retries).toBe(2);
  });
  it('caps parallel specs at 4', () => {
    expect(SpecQueueSettings.safeParse({ max_parallel: 5 }).success).toBe(false);
  });
  it('has exactly the documented states', () => {
    expect(SpecState.options).toHaveLength(12);
  });
});
