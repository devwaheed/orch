/**
 * Shared quota parsing helpers for agent adapters.
 * Pure TypeScript (no Node built-ins) per docs/architecture.md environments.
 */

const ISO_DATE_REGEX = /\b(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})?)\b/;

/**
 * Extracts an ISO UTC timestamp (ending in Z) from text or an unknown value.
 * Validates that the timestamp can be parsed as a valid Date.
 */
export function extractIsoTimestamp(value: unknown): string | null {
  if (!value) return null;

  if (typeof value === 'string') {
    const match = value.match(ISO_DATE_REGEX);
    if (match && match[1]) {
      const d = new Date(match[1]);
      if (!Number.isNaN(d.getTime())) {
        return d.toISOString();
      }
    }
    const directDate = new Date(value.trim());
    if (!Number.isNaN(directDate.getTime()) && directDate.getFullYear() > 2000) {
      return directDate.toISOString();
    }
  } else if (value instanceof Date && !Number.isNaN(value.getTime())) {
    return value.toISOString();
  }

  return null;
}

/**
 * Common pattern to detect rate limit / quota exhaustion errors.
 */
export const RATE_LIMIT_PATTERN =
  /(?:rate[- ]limit|usage[- ]limit|limit[- ]reached|5-hour limit|weekly limit|quota[- ]exceeded|resource[- ]has[- ]been[- ]exhausted|resource_exhausted|too[- ]many[- ]requests|429)/i;
