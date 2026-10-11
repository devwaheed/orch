import { describe, expect, it } from 'vitest';
import { RunId, RunLine, RunStatus, WorktreeId } from '@orch/contracts';
import {
  lineView,
  messageBoxView,
  runActionIsDestructive,
  runActionLabel,
  runActions,
  whereLabel,
} from './paneModel.js';

describe('runActions', () => {
  it('gives Running: Pause, Stop, and Shell and Review when there is a worktree', () => {
    expect(runActions('running', true)).toEqual(['pause', 'stop', 'shell', 'review']);
    expect(runActions('running', false)).toEqual(['pause', 'stop']);
  });

  it('gives Paused · limit: Shell and Review only', () => {
    expect(runActions('paused_limit', true)).toEqual(['shell', 'review']);
    expect(runActions('paused_limit', false)).toEqual([]);
  });

  it('gives Done: Continue', () => {
    expect(runActions('done', true)).toEqual(['continue']);
  });

  it('gives Queued: Start now', () => {
    expect(runActions('queued', false)).toEqual(['startNow']);
  });

  it('has no actions for statuses the design does not cover', () => {
    expect(runActions('failed', true)).toEqual([]);
    expect(runActions('stopped', true)).toEqual([]);
  });

  it('uses the design labels and marks only Stop as destructive', () => {
    expect(runActionLabel('startNow')).toBe('Start now');
    expect(runActionLabel('continue')).toBe('Continue');
    expect(runActionIsDestructive('stop')).toBe(true);
    expect(runActionIsDestructive('pause')).toBe(false);
  });
});

describe('messageBoxView', () => {
  const runId = RunId.parse('r-02');

  it('is enabled only while the run is running, with the agent in the placeholder', () => {
    expect(messageBoxView('running', 'Claude Code', runId)).toEqual({
      enabled: true,
      placeholder: 'Message Claude Code in r-02…',
    });
  });

  it('explains why it is disabled for every other status', () => {
    expect(messageBoxView('paused_limit', 'Claude Code', runId)).toEqual({
      enabled: false,
      placeholder: 'Resume the session to send messages',
    });
    expect(messageBoxView('done', 'Claude Code', runId)).toEqual({
      enabled: false,
      placeholder: 'Session ended · use Continue to resume it',
    });
    expect(messageBoxView('queued', 'Claude Code', runId)).toEqual({
      enabled: false,
      placeholder: 'Starts when its dependency finishes',
    });
  });

  it('is disabled for failed and stopped runs', () => {
    expect(messageBoxView('failed', 'Claude Code', runId).enabled).toBe(false);
    expect(messageBoxView('stopped', 'Claude Code', runId).enabled).toBe(false);
  });
});

describe('lineView', () => {
  const kinds: RunLine['kind'][] = ['meta', 'prompt', 'message', 'tool', 'diff_add', 'diff_del', 'ok', 'err', 'limit', 'spawn'];

  it('maps every RunLine kind to a tone', () => {
    expect(kinds.map((kind) => lineView(kind).tone)).toEqual([
      'meta',
      'you',
      'msg',
      'tool',
      'add',
      'del',
      'ok',
      'err',
      'limit',
      'spawn',
    ]);
  });

  it('gives the design glyph for the kinds that have one', () => {
    expect(lineView('prompt').glyph).toBe('›');
    expect(lineView('ok').glyph).toBe('✓');
    expect(lineView('err').glyph).toBe('✗');
    expect(lineView('limit').glyph).toBe('!');
    expect(lineView('spawn').glyph).toBe('↳');
    expect(lineView('diff_add').glyph).toBe('');
  });
});

describe('whereLabel', () => {
  it('shows read-only main, the worktree branch, or not started', () => {
    expect(whereLabel({ readOnly: true, worktree: null })).toBe('main (read-only)');
    expect(whereLabel({ readOnly: false, worktree: WorktreeId.parse('orch/r-02') })).toBe('orch/r-02');
    expect(whereLabel({ readOnly: false, worktree: null })).toBe('not started');
  });
});

describe('RunStatus coverage', () => {
  it('has an action answer for every status', () => {
    for (const status of RunStatus.options) {
      expect(Array.isArray(runActions(status, true))).toBe(true);
    }
  });
});
