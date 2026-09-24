import { isStructuredError } from "../errors/guards.js";
import { readCause, readProperty } from "../errors/guarded-read.js";

/**
 * Checks if a value has a non-empty `cause` (duck-typing). A nullish `cause`
 * and a `cause` getter that throws count as no cause, so chain traversal stops
 * there.
 *
 * @param value - The value to check
 * @returns True if the value has a `cause` property whose value is neither
 *   `undefined` nor `null`
 */
export function isErrorWithCause(value: unknown): value is { cause: unknown } {
  return readCause(value) !== undefined;
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
