/**
 * Type guard functions for error type narrowing.
 */

import { BaseError } from "./BaseError.js";
import { StructuredError } from "./StructuredError.js";

/**
 * Type guard to check if a value is a BaseError instance.
 *
 * @param value - The value to check
 * @returns True if the value is a BaseError instance
 *
 * @example
 * ```ts
 * try {
 *   await someOperation();
 * } catch (error) {
 *   if (isBaseError(error)) {
 *     console.log(error.timestamp);    // TypeScript knows this exists
 *     console.log(error.timestampIso);
 *   }
 * }
 * ```
 */
export function isBaseError(value: unknown): value is BaseError<string> {
  return value instanceof BaseError;
}

/**
 * Type guard to check if a value is a StructuredError.
 *
 * Uses a two-phase check:
 * 1. Fast path: `instanceof` check for real StructuredError instances
 * 2. Fallback: Duck-typing for cross-realm objects, serialized errors, or plain objects
 *
 * @param value - The value to check
 * @returns True if the value is a StructuredError or has the StructuredError shape
 *
 * @example
 * ```ts
 * try {
 *   await someOperation();
 * } catch (error) {
 *   if (isStructuredError(error)) {
 *     console.log(error.code);      // TypeScript knows this exists
 *     console.log(error.category);
 *     console.log(error.retryable);
 *
 *     if (error.retryable) {
 *       // Retry logic
 *     }
 *   }
 * }
 * ```
 */
export function isStructuredError(
  value: unknown,
): value is StructuredError<string, string> {
  // Fast path: instanceof check
  if (value instanceof StructuredError) return true;

  // Fallback: duck-typing for cross-realm or serialized errors
  if (typeof value !== "object" || value === null) return false;

  const err = value as Record<string, unknown>;
  return (
    typeof err.code === "string" &&
    typeof err.category === "string" &&
    typeof err.retryable === "boolean"
  );
}

/**
 * Type guard to check if an error is retryable.
 * Works with any error that has a `retryable` property (duck-typing).
 *
 * @param value - The value to check
 * @returns True if the value has retryable === true
 *
 * @example
 * ```ts
 * try {
 *   await someOperation();
 * } catch (error) {
 *   if (isRetryable(error)) {
 *     // Safe to retry
 *     await retry(someOperation);
 *   } else {
 *     // Don't retry, handle error
 *     throw error;
 *   }
 * }
 * ```
 */
export function isRetryable(
  value: unknown,
): value is { retryable: true } & Record<string, unknown> {
  return (
    typeof value === "object" &&
    value !== null &&
    "retryable" in value &&
    (value as Record<string, unknown>).retryable === true
  );
}
