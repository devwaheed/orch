import { z } from 'zod';

/**
 * Every error that crosses a process boundary uses this shape. `message` is
 * shown to users as-is, so write it in the product's voice: what happened, and
 * `fix` says what to do. Never put secrets, tokens or emails in either.
 */
export const ErrorCode = z.enum([
  'validation_failed',
  'not_found',
  'conflict',
  'account_signed_out',
  'account_limited',
  'account_not_isolated',
  'agent_not_installed',
  'agent_single_account_os',
  'engine_unavailable',
  'engine_contract_mismatch',
  'worktree_dirty',
  'merge_conflict',
  'not_verified',
  'protected_file_changed',
  'internal',
]);
export type ErrorCode = z.infer<typeof ErrorCode>;

export const OrchError = z.object({
  code: ErrorCode,
  message: z.string().min(1),
  fix: z.string().optional(),
  /** Machine-readable extra data, e.g. `{ resetsAt }` for account_limited. */
  details: z.record(z.unknown()).optional(),
});
export type OrchError = z.infer<typeof OrchError>;

/** Result type for service calls: never throw across a boundary. */
export type Result<T> = { ok: true; value: T } | { ok: false; error: OrchError };
