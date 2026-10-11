import { describe, expect, it } from 'vitest';
import type { AccountId, PickAccountResult, RunId, SessionId } from '@orch/contracts';
import { pausedCardView } from './pausedView.js';

const personal = 'codex-personal' as AccountId;
const team = 'codex-team' as AccountId;
// Local times (no Z) so the clock reads the same in every timezone.
const run = { id: 'r-7' as RunId, accountId: personal, resumesAt: '2026-10-12T15:00:00.000', sessionId: 's-91c' as SessionId };
const view = (pick: PickAccountResult | null, extra: Partial<Parameters<typeof pausedCardView>[0]> = {}) =>
  pausedCardView({
    run,
    lines: [{ kind: 'message', at: '2026-10-12T12:40:00.000' }, { kind: 'limit', at: '2026-10-12T12:46:00.000' }],
    windows: [{ accountId: personal, window: '5h', usedPct: 100, resetsAt: run.resumesAt }],
    pick,
    agentName: 'Codex',
    accountName: (id) => (id === personal ? 'Personal' : 'Team'),
    ...extra,
  } as Parameters<typeof pausedCardView>[0]);

describe('paused-by-limit card (S3-03, screens.md Work)', () => {
  it('reads like the design sample', () => {
    const v = view({ kind: 'account', accountId: team });
    expect(v.pausedText).toBe('Codex · Personal hit its 5-hour limit at 12:46. The worktree, transcript and CLI session s-91c are saved.');
    expect(v.autoText).toBe('Otherwise continue this exact session on Personal at 15:00');
    expect(v.resumeOn).toEqual({ accountId: team, label: 'Resume now on Codex · Team' });
  });

  it('offers no resume-now when only the limited account or nothing has room', () => {
    expect(view({ kind: 'account', accountId: personal }).resumeOn).toBeNull();
    expect(view({ kind: 'wait', until: '2026-10-12T16:00:00.000Z', agent: 'codex' }).resumeOn).toBeNull();
    expect(view(null).resumeOn).toBeNull();
  });

  it('leaves out what it does not know instead of guessing', () => {
    const v = view(null, { lines: [], windows: [] });
    expect(v.pausedText).toBe('Codex · Personal hit its limit. The worktree, transcript and CLI session s-91c are saved.');
  });
});
