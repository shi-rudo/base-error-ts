import { isStructuredError } from "../errors/guards.js";
import { readProperty } from "../errors/guarded-read.js";

/**
 * Checks if a value has a non-empty `cause` (duck-typing).
 *
 * An explicit `cause: undefined` (as produced by `new Error(msg, { cause:
 * undefined })`) counts as no cause, so chain traversal stops there instead of
 * stepping onto a spurious `undefined`. So does a `cause` getter that throws:
 * the guard runs in catch paths and must not throw.
 *
 * @param value - The value to check
 * @returns True if the value has a `cause` property whose value is not `undefined`
 */
export function isErrorWithCause(value: unknown): value is { cause: unknown } {
  return readProperty(value, "cause") !== undefined;
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
