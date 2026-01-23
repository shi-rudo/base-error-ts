import { isStructuredError } from "../errors/guards.js";

/**
 * Checks if a value has a cause property (duck-typing).
 *
 * @param value - The value to check
 * @returns True if the value has a cause property
 */
export function isErrorWithCause(value: unknown): value is { cause: unknown } {
  return typeof value === "object" && value !== null && "cause" in value;
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
