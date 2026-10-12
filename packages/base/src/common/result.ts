/**
 * Success or failure. Structurally identical to the `Result<T>` used across
 * process boundaries in `@orchagents/contracts` (where `E` is `OrchError`). `base`
 * cannot import contracts, so it is generic over the error type.
 */
export type Ok<T> = { readonly ok: true; readonly value: T };
export type Err<E> = { readonly ok: false; readonly error: E };
export type Result<T, E = unknown> = Ok<T> | Err<E>;

export function ok<T>(value: T): Ok<T> {
  return { ok: true, value };
}

export function err<E>(error: E): Err<E> {
  return { ok: false, error };
}
