import { isErrorWithCause } from "./guards.js";

/**
 * Internal generator that traverses the cause chain.
 * Handles circular detection and maxDepth limiting.
 *
 * @param error - The error to start traversing from
 * @param maxDepth - Maximum chain depth to traverse
 * @yields Each error in the cause chain, from outermost to innermost
 *
 * @throws Error - When a circular cause chain is detected
 */
function* traverseCauseChain(
  error: unknown,
  maxDepth: number,
): Generator<unknown> {
  let current: unknown = error;
  const seen = new Set<unknown>();

  for (let depth = 0; depth <= maxDepth; depth++) {
    yield current;

    if (!isErrorWithCause(current)) break;
    if (seen.has(current)) {
      throw new Error("Circular cause chain detected");
    }
    seen.add(current);
    current = current.cause;
  }
}

/**
 * Traverses the cause chain to find the root cause (the last error in the chain).
 *
 * @param error - The error to traverse
 * @param maxDepth - Maximum chain depth to traverse (default: 100)
 * @returns The root cause, or the last valid error if maxDepth is exceeded
 *
 * @throws Error - When a circular cause chain is detected
 *
 * @example
 * ```typescript
 * const root = getRootCause(nestedError);
 * if (isRetryableStructuredError(root)) {
 *   // Handle retryable root cause
 * }
 * ```
 */
export function getRootCause(error: unknown, maxDepth: number = 100): unknown {
  let last: unknown = error;
  for (const current of traverseCauseChain(error, maxDepth)) {
    last = current;
  }
  return last;
}

/**
 * Finds the first error in the cause chain that matches the predicate.
 *
 * @param error - The error to start traversing from
 * @param predicate - Function that returns true for matching errors
 * @param maxDepth - Maximum chain depth to traverse (default: 100)
 * @returns The first matching error, or undefined if no match found
 *
 * @example
 * ```typescript
 * const dbError = findInCauseChain(
 *   error,
 *   (e): e is StructuredError => e.code?.startsWith("DB_")
 * );
 * ```
 */
export function findInCauseChain<T>(
  error: unknown,
  predicate: (e: unknown) => e is T,
  maxDepth?: number,
): T | undefined;
export function findInCauseChain(
  error: unknown,
  predicate: (e: unknown) => boolean,
  maxDepth?: number,
): unknown;
export function findInCauseChain(
  error: unknown,
  predicate: (e: unknown) => boolean,
  maxDepth: number = 100,
): unknown {
  for (const current of traverseCauseChain(error, maxDepth)) {
    if (predicate(current)) return current;
  }
  return undefined;
}

/**
 * Collects all errors in the cause chain that match the predicate.
 *
 * @param error - The error to start traversing from
 * @param predicate - Function that returns true for errors to collect
 * @param maxDepth - Maximum chain depth to traverse (default: 100)
 * @returns Array of matching errors, ordered from outermost to innermost
 *
 * @example
 * ```typescript
 * const allRetryable = filterCauseChain(
 *   error,
 *   (e): e is StructuredError & { retryable: true } =>
 *     isRetryableStructuredError(e)
 * );
 * ```
 */
export function filterCauseChain<T>(
  error: unknown,
  predicate: (e: unknown) => e is T,
  maxDepth?: number,
): T[];
export function filterCauseChain(
  error: unknown,
  predicate: (e: unknown) => boolean,
  maxDepth?: number,
): unknown[];
export function filterCauseChain(
  error: unknown,
  predicate: (e: unknown) => boolean,
  maxDepth: number = 100,
): unknown[] {
  const results: unknown[] = [];
  for (const current of traverseCauseChain(error, maxDepth)) {
    if (predicate(current)) results.push(current);
  }
  return results;
}

/**
 * Checks if any error in the cause chain matches the predicate.
 *
 * @param error - The error to start traversing from
 * @param predicate - Function that returns true for matching errors
 * @param maxDepth - Maximum chain depth to traverse (default: 100)
 * @returns True if at least one error matches the predicate
 *
 * @example
 * ```typescript
 * const hasRetryable = someCauseChain(
 *   error,
 *   (e) => isRetryableStructuredError(e)
 * );
 * ```
 */
export function someCauseChain(
  error: unknown,
  predicate: (e: unknown) => boolean,
  maxDepth: number = 100,
): boolean {
  return findInCauseChain(error, predicate, maxDepth) !== undefined;
}

/**
 * Checks if all errors in the cause chain match the predicate.
 *
 * @param error - The error to start traversing from
 * @param predicate - Function that returns true for matching errors
 * @param maxDepth - Maximum chain depth to traverse (default: 100)
 * @returns True if all errors match the predicate, or if the chain is empty
 *
 * @example
 * ```typescript
 * const allAreRetryable = everyCauseChain(
 *   error,
 *   (e) => isRetryableStructuredError(e)
 * );
 * ```
 */
export function everyCauseChain(
  error: unknown,
  predicate: (e: unknown) => boolean,
  maxDepth: number = 100,
): boolean {
  for (const current of traverseCauseChain(error, maxDepth)) {
    if (!predicate(current)) return false;
  }
  return true;
}
