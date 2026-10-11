import { describe, expect, it } from 'vitest';
import type { QueueId, SpecId, SpecRun, SpecState } from '@orch/contracts';
import { canTransition, transitionSpecState, validateTransition } from '../common/stateMachine.js';

describe('stateMachine', () => {
  const makeSpec = (state: SpecState, attempt: number | null = null): SpecRun => ({
    id: '1' as SpecId,
    queueId: 'q-test' as QueueId,
    position: 1,
    file: 'docs/specs/01-test.md',
    spec: {
      id: '1',
      title: 'Test Spec',
      depends_on: [],
      scope: [],
      done_when: [{ by: 'audit', text: 'audit 1' }],
      agent: 'auto',
    },
    state,
    attempt,
    jobId: null,
    worktree: null,
    implementer: null,
    criteria: [],
    blockedBy: [],
    startedAt: null,
    finishedAt: null,
    tokens: 0,
  });

  describe('validateTransition (§4 transitions table)', () => {
    it('allows valid transitions per §4 table', () => {
      // queued transitions
      expect(canTransition('queued', 'running')).toBe(true);
      expect(canTransition('queued', 'waiting_quota')).toBe(true);
      expect(canTransition('queued', 'blocked')).toBe(true);
      expect(canTransition('queued', 'skipped')).toBe(true);
      expect(canTransition('queued', 'cancelled')).toBe(true);

      // waiting_quota
      expect(canTransition('waiting_quota', 'running')).toBe(true);
      expect(canTransition('waiting_quota', 'skipped')).toBe(true);
      expect(canTransition('waiting_quota', 'cancelled')).toBe(true);

      // blocked
      expect(canTransition('blocked', 'queued')).toBe(true);
      expect(canTransition('blocked', 'skipped')).toBe(true);
      expect(canTransition('blocked', 'cancelled')).toBe(true);

      // running
      expect(canTransition('running', 'verifying')).toBe(true);
      expect(canTransition('running', 'waiting_quota')).toBe(true);
      expect(canTransition('running', 'cancelled')).toBe(true);

      // verifying
      expect(canTransition('verifying', 'auditing')).toBe(true);
      expect(canTransition('verifying', 'running')).toBe(true);
      expect(canTransition('verifying', 'needs_you')).toBe(true);
      expect(canTransition('verifying', 'skipped')).toBe(true);
      expect(canTransition('verifying', 'cancelled')).toBe(true);

      // auditing
      expect(canTransition('auditing', 'verified')).toBe(true);
      expect(canTransition('auditing', 'running')).toBe(true);
      expect(canTransition('auditing', 'needs_you')).toBe(true);
      expect(canTransition('auditing', 'skipped')).toBe(true);
      expect(canTransition('auditing', 'cancelled')).toBe(true);

      // verified
      expect(canTransition('verified', 'approved')).toBe(true);
      expect(canTransition('verified', 'running')).toBe(true);
      expect(canTransition('verified', 'cancelled')).toBe(true);

      // approved
      expect(canTransition('approved', 'merged')).toBe(true);
      expect(canTransition('approved', 'running')).toBe(true);
      expect(canTransition('approved', 'cancelled')).toBe(true);

      // needs_you & skipped manual retry / skip
      expect(canTransition('needs_you', 'queued')).toBe(true);
      expect(canTransition('needs_you', 'skipped')).toBe(true);
      expect(canTransition('needs_you', 'cancelled')).toBe(true);

      expect(canTransition('skipped', 'queued')).toBe(true);
      expect(canTransition('skipped', 'cancelled')).toBe(true);
    });

    it('rejects illegal transitions', () => {
      expect(canTransition('queued', 'verified')).toBe(false);
      expect(canTransition('queued', 'merged')).toBe(false);
      expect(canTransition('running', 'merged')).toBe(false);
      expect(canTransition('verifying', 'merged')).toBe(false);
      expect(canTransition('auditing', 'merged')).toBe(false);
      expect(canTransition('merged', 'queued')).toBe(false);
      expect(canTransition('merged', 'running')).toBe(false);
      expect(canTransition('cancelled', 'running')).toBe(false);
    });

    it('returns conflict OrchError when invalid', () => {
      const res = validateTransition('queued', 'merged');
      expect(res.ok).toBe(false);
      if (!res.ok) {
        expect(res.error.code).toBe('conflict');
        expect(res.error.message).toBe("Cannot transition spec from 'queued' to 'merged'.");
      }
    });
  });

  describe('transitionSpecState', () => {
    it('sets attempt = 1 on first transition queued -> running', () => {
      const spec = makeSpec('queued', null);
      const res = transitionSpecState(spec, 'running');
      expect(res.ok).toBe(true);
      if (res.ok) {
        expect(res.value.state).toBe('running');
        expect(res.value.attempt).toBe(1);
      }
    });

    it('increments attempt when returning to running from verifying/auditing/request changes', () => {
      const spec = makeSpec('verifying', 1);
      const res = transitionSpecState(spec, 'running');
      expect(res.ok).toBe(true);
      if (res.ok) {
        expect(res.value.state).toBe('running');
        expect(res.value.attempt).toBe(2);
      }
    });

    it('resets attempt to null when retrying from needs_you or skipped', () => {
      const spec = makeSpec('needs_you', 3);
      const res = transitionSpecState(spec, 'queued');
      expect(res.ok).toBe(true);
      if (res.ok) {
        expect(res.value.state).toBe('queued');
        expect(res.value.attempt).toBeNull();
      }
    });

    it('clears blockedBy when transitioning from blocked to queued', () => {
      const spec = {
        ...makeSpec('blocked', null),
        blockedBy: ['2' as SpecId],
      };
      const res = transitionSpecState(spec, 'queued');
      expect(res.ok).toBe(true);
      if (res.ok) {
        expect(res.value.state).toBe('queued');
        expect(res.value.blockedBy).toEqual([]);
      }
    });
  });
});
