import { isRetryableStructuredError } from "./guards.js";
import { findInCauseChain, getRootCause } from "./cause-chain.js";

type RetryableError = { retryable: true } & Record<string, unknown>;

/**
 * Checks if any error in the cause chain is retryable.
 * Useful for determining whether to retry an operation based on nested errors.
 *
 * @param error - The error to check
 * @returns True if any error in the chain has retryable === true
 *
 * @example
 * ```typescript
 * if (isChainRetryable(error)) {
 *   // Retry the operation
 * }
 * ```
 */
export function isChainRetryable(error: unknown): boolean {
  return (
    findInCauseChain(error, (e): e is RetryableError =>
      isRetryableStructuredError(e),
    ) !== undefined
  );
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
  ) as RetryableError | undefined;
}
