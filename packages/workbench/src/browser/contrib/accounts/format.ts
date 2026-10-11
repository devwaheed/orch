/** Pure display helpers for the Accounts area. No DOM, no Node. */

const MASK = '•••';

/**
 * Shows an email masked as first character, `•••`, `@`, domain (ACC-04).
 * The core already sends masked addresses; this guards against an unmasked one reaching the screen.
 */
export function maskEmail(email: string | undefined): string | undefined {
  if (!email) return undefined;
  const at = email.indexOf('@');
  if (at === -1) return undefined;
  const local = email.slice(0, at);
  const domain = email.slice(at + 1);
  if (!domain) return undefined;
  if (local.endsWith(MASK) && local.length === MASK.length + 1) return email;
  const first = local.charAt(0);
  return `${first}${MASK}@${domain}`;
}

/** Local 24-hour HH:mm for a reset time, or null when the time is unknown. */
export function formatResetTime(iso: string | null | undefined): string | null {
  if (!iso) return null;
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return null;
  const hh = String(date.getHours()).padStart(2, '0');
  const mm = String(date.getMinutes()).padStart(2, '0');
  return `${hh}:${mm}`;
}

/** Joins labels for "Kept separate": "A", "A and B", "A and B and C". */
export function joinLabels(labels: readonly string[], conjunction = ' and '): string {
  return labels.join(conjunction);
}
