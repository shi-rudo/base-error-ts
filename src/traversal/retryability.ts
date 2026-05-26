import { isRetryable } from "../errors/guards.js";
import { isRetryableStructuredError } from "./guards.js";
import {
  findInCauseChain,
  getRootCause,
  someCauseChain,
} from "./cause-chain.js";

type RetryableError = { retryable: true } & Record<string, unknown>;

/**
 * Checks if any error in the cause chain is a retryable StructuredError.
 *
 * Uses the strict {@link isRetryableStructuredError} predicate: each error
 * must have the full StructuredError shape (`code`, `category`, `retryable`)
 * in addition to `retryable === true`. Errors that extend `BaseError`
 * directly and only set `retryable: true` will NOT match — for those, use
 * {@link someChainRetryable} instead.
 *
 * @param error - The error to check
 * @returns True if any error in the chain is a retryable StructuredError
 *
 * @example
 * ```typescript
 * if (isChainRetryable(error)) {
 *   // Retry the operation
 * }
 * ```
 */
export function isChainRetryable(error: unknown): boolean {
  return someCauseChain(error, isRetryableStructuredError);
}

/**
 * Checks if any error in the cause chain is retryable, using the loose
 * `retryable === true` predicate.
 *
 * Unlike {@link isChainRetryable}, this does NOT require the full
 * StructuredError shape (`code`/`category`/`retryable`). Use this when your
 * error hierarchy extends `BaseError` directly and signals retryability via
 * a plain `retryable: true` field — common in DDD-style error hierarchies
 * that discriminate by class rather than `code`/`category` strings.
 *
 * @param error - The error to check
 * @param maxDepth - Maximum chain depth to traverse (default: 100)
 * @returns True if any error in the chain has `retryable === true`
 *
 * @example
 * ```typescript
 * class ConcurrencyConflictError extends BaseError<"ConcurrencyConflictError"> {
 *   readonly retryable = true as const;
 * }
 *
 * if (someChainRetryable(error)) {
 *   // Retry — works even though ConcurrencyConflictError has no code/category
 * }
 * ```
 */
export function someChainRetryable(
  error: unknown,
  maxDepth: number = 100,
): boolean {
  return someCauseChain(error, isRetryable, maxDepth);
}

/**
 * Checks if the root cause of an error is retryable.
 * This provides the most specific retry decision by examining only the deepest error.
 *
 * @param error - The error to check
 * @returns True if the root cause is a retryable StructuredError
 *
 * @example
 * ```typescript
 * // Only retry for root cause issues (e.g., network timeout)
 * if (getRootCauseRetryable(error)) {
 *   await retryOperation();
 * }
 * ```
 */
export function getRootCauseRetryable(error: unknown): boolean {
  const root = getRootCause(error);
  return isRetryableStructuredError(root);
}

/**
 * Finds the first retryable error in the cause chain.
 *
 * @param error - The error to start traversing from
 * @returns The first retryable StructuredError, or undefined if none found
 *
 * @example
 * ```typescript
 * const retryable = getFirstRetryableCause(error);
 * if (retryable) {
 *   console.log(`Retryable error: ${retryable.code}`);
 * }
 * ```
 */
export function getFirstRetryableCause(
  error: unknown,
): RetryableError | undefined {
  return findInCauseChain(error, (e): e is RetryableError =>
    isRetryableStructuredError(e),
  );
}
