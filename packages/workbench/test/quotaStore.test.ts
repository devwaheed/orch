import { describe, expect, it } from 'vitest';
import type { QuotaWindow } from '@orchagents/contracts';
import { useQuotaStore } from '../src/browser/services/stores/quota.js';

const win = (usedPct: number, resetsAt: string | null): QuotaWindow =>
  ({ accountId: 'codex-personal', window: '5h', usedPct, resetsAt, source: 'reported' }) as QuotaWindow;

describe('quota store', () => {
  it('knows a full window means limited until it resets, even without the one-off quota.limited event', () => {
    useQuotaStore.setState({ windows: {}, limits: {} });
    useQuotaStore.getState().setWindows([win(100, '2026-10-12T10:00:00Z')]);
    expect(useQuotaStore.getState().limits['codex-personal']).toEqual({ resetsAt: '2026-10-12T10:00:00Z' });
  });

  it('keeps the limit the event reported and ignores windows below 100%', () => {
    useQuotaStore.setState({ windows: {}, limits: { 'codex-personal': { resetsAt: '2026-10-12T11:00:00Z' } } });
    useQuotaStore.getState().upsertWindow(win(100, '2026-10-12T10:00:00Z'));
    expect(useQuotaStore.getState().limits['codex-personal']?.resetsAt).toBe('2026-10-12T11:00:00Z');
    useQuotaStore.setState({ limits: {} });
    useQuotaStore.getState().upsertWindow(win(62, '2026-10-12T10:00:00Z'));
    expect(useQuotaStore.getState().limits).toEqual({});
  });
});
