/** Usage arithmetic shared by routing and the capacity panel (QTA-02, QTA-05). */
import type { QuotaWindow } from '@orch/contracts';

/** QTA-05: windows older than 6 hours are stale for routing. */
export const STALE_AFTER_MS = 6 * 60 * 60 * 1000;

export function isStale(window: QuotaWindow, now: Date): boolean {
  return now.getTime() - Date.parse(window.seenAt) > STALE_AFTER_MS;
}

/**
 * An account's usage for routing: the highest of its windows. Stale windows
 * count as 0 % (QTA-05). Returns null when the account has no window at all,
 * meaning usage is unknown.
 */
export function accountUsedPct(windows: readonly QuotaWindow[], now: Date): number | null {
  if (windows.length === 0) {
    return null;
  }
  let highest = 0;
  for (const window of windows) {
    const counted = isStale(window, now) ? 0 : window.usedPct;
    highest = Math.max(highest, counted);
  }
  return highest;
}

/** QTA-02: estimated usage = requests since reset / learned number. Null until a limit has been seen. */
export function estimatedUsedPct(requestsSinceReset: number, learnedLimit: number | null): number | null {
  if (learnedLimit === null || learnedLimit <= 0) {
    return null;
  }
  return Math.min(100, (requestsSinceReset / learnedLimit) * 100);
}
