import { isStructuredError } from "../errors/guards.js";
import { readProperty } from "../errors/guarded-read.js";

/**
 * Checks if a value has a non-empty `cause` (duck-typing).
 *
 * A nullish `cause` counts as no cause, as in .NET, Java and the `??`
 * operator. That covers `new Error(msg, { cause: undefined })` and the
 * `cause: null` that `toStructuredError(null)` installs, so chain traversal
 * stops there instead of stepping onto a spurious nullish node. A `cause`
 * getter that throws counts as no cause too: the guard runs in catch paths
 * and must not throw.
 *
 * @param value - The value to check
 * @returns True if the value has a `cause` property whose value is neither
 *   `undefined` nor `null`
 */
export function isErrorWithCause(value: unknown): value is { cause: unknown } {
  const cause = readProperty(value, "cause");
  return cause !== undefined && cause !== null;
}

/**
 * Checks if a value is a retryable StructuredError.
 *
 * @param value - The value to check
 * @returns True if the value is a StructuredError with retryable === true
 */
export function isRetryableStructuredError(
  value: unknown,
): value is { retryable: true } & Record<string, unknown> {
  // The second `retryable` read is guarded too: a stateful getter that passed
  // inside `isStructuredError` may throw on the next read.
  return isStructuredError(value) && readProperty(value, "retryable") === true;
}
