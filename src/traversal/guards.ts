import { isStructuredError } from "../errors/guards.js";

/**
 * Checks if a value has a non-empty `cause` (duck-typing).
 *
 * An explicit `cause: undefined` (as produced by `new Error(msg, { cause:
 * undefined })`) counts as no cause, so chain traversal stops there instead of
 * stepping onto a spurious `undefined`.
 *
 * @param value - The value to check
 * @returns True if the value has a `cause` property whose value is not `undefined`
 */
export function isErrorWithCause(value: unknown): value is { cause: unknown } {
  return (
    typeof value === "object" &&
    value !== null &&
    "cause" in value &&
    (value as { cause: unknown }).cause !== undefined
  );
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
  return isStructuredError(value) && value.retryable === true;
}
