/**
 * Masks an email address per LOCKED ACC-04:
 * "Emails are shown masked: first character, •••, @, domain."
 *
 * Example:
 *   "alex@acme.dev" -> "a•••@acme.dev"
 */
export function maskEmail(email: string): string {
  const trimmed = email.trim();
  const atIdx = trimmed.indexOf('@');
  if (atIdx === -1) {
    if (trimmed.length === 0) {
      return '•••';
    }
    return `${trimmed[0]}•••`;
  }

  const local = trimmed.slice(0, atIdx);
  const domain = trimmed.slice(atIdx + 1);
  const firstChar = local.length > 0 ? local[0] : '';
  return `${firstChar}•••@${domain}`;
}
