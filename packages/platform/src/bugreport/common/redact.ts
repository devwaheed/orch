/**
 * Redaction for the bug-report bundle (LOCKED SEC-03, BUG-03).
 * Redacts everything on the way into the bundle: tokens, API keys, emails, env values,
 * the ~/.orch token contents and anything that looks like a bearer or sk- key;
 * the home path becomes `~`.
 */
import { maskEmail } from '../../adapters/common/maskEmail.js';

export interface RedactOptions {
  /** The absolute home path. Every occurrence is replaced with `~`. */
  readonly home: string;
  /** Exact secret strings replaced verbatim, e.g. the ~/.orch token value. */
  readonly secrets?: readonly string[];
}

const EMAIL_PATTERN = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi;

/** `Bearer <credential>` (LOCKED SEC-03: tokens). */
const BEARER_PATTERN = /(\b[bB]earer\b[ \t]+)([A-Za-z0-9._~+/=-]{8,})/g;

/** `sk-…` API keys (OpenAI-style and similar). */
const SK_PATTERN = /\bsk-[A-Za-z0-9_-]{4,}\b/g;

/** `Authorization: <credential>`. */
const AUTHORIZATION_PATTERN = /(authorization[ \t]*:[ \t]*)(\S+)/gi;

/** Long random-looking strings, e.g. JWTs, GitHub `ghp_…`, base64 API keys. */
const TOKEN_LIKE_PATTERN = /[A-Za-z0-9_-]{32,}/g;

/** `NAME=value` assignments; the value is almost always an env value (SEC-03). */
const ENV_VALUE_PATTERN = /\b([A-Z][A-Z0-9_]{2,})[ \t]*=[ \t]*(?:"[^"\r\n]*"|'[^'\r\n]*'|[^\s;,)\]}"']+)/g;

/** Replaces every secret with exactly one marker so no secret can leak twice. */
export const REDACTED = '[REDACTED]';

export function redactText(text: string, options: RedactOptions): string {
  let out = text;

  // LOCKED SEC-03: the home path appears as `~` in a bundle, never absolute.
  const home = options.home.replace(/[\\/]+$/, '');
  if (home.length > 0) {
    out = out.split(home).join('~');
  }

  // Exact secrets first (e.g. the value in ~/.orch/token), so even a short
  // value that no pattern can recognise is removed.
  for (const secret of options.secrets ?? []) {
    if (secret.length > 0) {
      out = out.split(secret).join(REDACTED);
    }
  }

  // Env assignments first, so a KEY stuck into a value is removed in one step
  // and never double-rewritten by the key patterns below.
  out = out
    .replace(ENV_VALUE_PATTERN, `$1=${REDACTED}`)
    // LOCKED ACC-04: emails are masked, not deleted.
    .replace(EMAIL_PATTERN, (email) => maskEmail(email))
    .replace(BEARER_PATTERN, `$1${REDACTED}`)
    .replace(SK_PATTERN, 'sk-[REDACTED]')
    .replace(AUTHORIZATION_PATTERN, `$1${REDACTED}`)
    .replace(TOKEN_LIKE_PATTERN, REDACTED);

  return out;
}
