/**
 * Result — an explicit success/failure value.
 *
 * Used where a failure is an expected domain outcome rather than a bug: a gate refusing, a
 * provider returning STALE, a version mismatch. Throwing for those would make the normal path
 * exceptional and tempt callers into bare try/catch that swallows the reason — which is how
 * `save()` in the prototype ended up discarding quota failures silently.
 *
 * Genuine programming errors still throw (see DomainError INVARIANT_VIOLATED).
 */
import type { DomainError } from './errors.ts';

export type Result<T, E = DomainError> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly error: E };

export const ok = <T>(value: T): Result<T, never> => ({ ok: true, value });
export const err = <E>(error: E): Result<never, E> => ({ ok: false, error });

export const isOk = <T, E>(r: Result<T, E>): r is { ok: true; value: T } => r.ok;
export const isErr = <T, E>(r: Result<T, E>): r is { ok: false; error: E } => !r.ok;

export function map<T, U, E>(r: Result<T, E>, f: (value: T) => U): Result<U, E> {
  return r.ok ? ok(f(r.value)) : r;
}

export function andThen<T, U, E>(r: Result<T, E>, f: (value: T) => Result<U, E>): Result<U, E> {
  return r.ok ? f(r.value) : r;
}

/** Unwrap or throw. Only at a boundary that turns a Result into an HTTP response. */
export function unwrap<T, E>(r: Result<T, E>): T {
  if (r.ok) return r.value;
  throw r.error instanceof Error ? r.error : new Error(String(r.error));
}

export function unwrapOr<T, E>(r: Result<T, E>, fallback: T): T {
  return r.ok ? r.value : fallback;
}

/** Collect, failing on the first error. */
export function all<T, E>(results: readonly Result<T, E>[]): Result<T[], E> {
  const values: T[] = [];
  for (const r of results) {
    if (!r.ok) return r;
    values.push(r.value);
  }
  return ok(values);
}
