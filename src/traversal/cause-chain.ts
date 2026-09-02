import { readMembers, readProperty } from "../errors/guarded-read.js";

/**
 * How far and how wide a traversal goes. Every helper also accepts a plain
 * number in this position, which sets {@link CauseTraversalOptions.maxDepth}
 * and keeps the linear behavior.
 */
export type CauseTraversalOptions = {
  /** Maximum number of hops to follow (default: 100). */
  maxDepth?: number;
  /**
   * Also walk the members of an aggregate: `AggregateError.errors`, and any
   * error-like value that carries the same shape. Off by default, because it
   * turns the chain into a tree and changes what a traversal means.
   */
  aggregates?: boolean;
  /**
   * Maximum number of nodes visited when `aggregates` is on (default: 1000).
   * Depth bounds a chain, but it does not bound the width of a tree.
   */
  maxNodes?: number;
};

type ResolvedOptions = {
  maxDepth: number;
  aggregates: boolean;
  maxNodes: number;
};

const DEFAULT_MAX_DEPTH = 100;
const DEFAULT_MAX_NODES = 1000;

function resolveOptions(
  options: number | CauseTraversalOptions | undefined,
): ResolvedOptions {
  if (typeof options === "number") {
    return {
      maxDepth: options,
      aggregates: false,
      maxNodes: DEFAULT_MAX_NODES,
    };
  }
  return {
    maxDepth: options?.maxDepth ?? DEFAULT_MAX_DEPTH,
    aggregates: options?.aggregates === true,
    maxNodes: options?.maxNodes ?? DEFAULT_MAX_NODES,
  };
}

/**
 * Depth-first walk over the cause tree: each node, then its `cause`, then the
 * members of its aggregate. Total by design, like the linear walk: a node
 * already visited ends that branch, so a cycle or a shared branch terminates
 * instead of recursing. `budget` bounds the total node count, because
 * `maxDepth` bounds depth and not width. The members of one aggregate are
 * read up to the remaining budget, so a wide aggregate costs at most the
 * budget and never its width.
 */
function* traverseCauseTree(
  error: unknown,
  depth: number,
  options: ResolvedOptions,
  seen: Set<unknown>,
  budget: { nodes: number },
): Generator<unknown> {
  if (depth > options.maxDepth || budget.nodes <= 0) return;
  if (seen.has(error)) return;
  seen.add(error);
  budget.nodes--;
  yield error;

  const cause = readProperty(error, "cause");
  if (cause !== undefined) {
    yield* traverseCauseTree(cause, depth + 1, options, seen, budget);
  }
  const aggregate = readMembers(error, budget.nodes);
  if (aggregate !== undefined) {
    for (const member of aggregate.members) {
      yield* traverseCauseTree(member, depth + 1, options, seen, budget);
    }
  }
}

/** Picks the linear walk or the tree walk, by option. */
function traverse(
  error: unknown,
  options: number | CauseTraversalOptions | undefined,
): Generator<unknown> {
  const resolved = resolveOptions(options);
  return resolved.aggregates
    ? traverseCauseTree(error, 0, resolved, new Set<unknown>(), {
        nodes: resolved.maxNodes,
      })
    : traverseCauseChain(error, resolved.maxDepth);
}

/**
 * Internal generator that traverses the cause chain.
 *
 * Total by design: these helpers run inside catch paths, where a circular
 * chain (a bug in someone's error wiring) must not turn a retry decision into
 * a new crash. On a cycle the traversal simply ends once the repeated node is
 * reached: at that point every node has been yielded exactly once, so nothing
 * is lost. `maxDepth` is the number of cause **hops** followed, so up to
 * `maxDepth + 1` nodes are yielded.
 *
 * @param error - The error to start traversing from
 * @param maxDepth - Maximum number of cause hops to follow
 * @yields Each error in the cause chain, from outermost to innermost, each
 *   node exactly once
 */
function* traverseCauseChain(
  error: unknown,
  maxDepth: number,
): Generator<unknown> {
  let current: unknown = error;
  const seen = new Set<unknown>();

  for (let depth = 0; depth <= maxDepth; depth++) {
    if (seen.has(current)) return;
    seen.add(current);
    yield current;

    const cause = readProperty(current, "cause");
    if (cause === undefined) return;
    current = cause;
  }
}

/**
 * Traverses the cause chain to find the root cause (the last error in the chain).
 *
 * @param error - The error to traverse
 * @param maxDepth - Maximum number of cause hops to follow (default: 100)
 * @returns The root cause, or the last valid error if maxDepth is exceeded.
 *   On a circular chain, the deepest error before the repeat (never throws).
 *
 * This helper is linear by design and takes no `aggregates` option: a tree has
 * no single deepest node, so "the root cause" of an aggregate is not defined.
 * Use {@link filterCauseChain} with `{ aggregates: true }` to collect the
 * branches instead.
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
 * @param options - A `maxDepth` number, or {@link CauseTraversalOptions}
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
  options?: number | CauseTraversalOptions,
): T | undefined;
export function findInCauseChain(
  error: unknown,
  predicate: (e: unknown) => boolean,
  options?: number | CauseTraversalOptions,
): unknown;
export function findInCauseChain(
  error: unknown,
  predicate: (e: unknown) => boolean,
  options?: number | CauseTraversalOptions,
): unknown {
  for (const current of traverse(error, options)) {
    if (predicate(current)) return current;
  }
  return undefined;
}

/**
 * Collects all errors in the cause chain that match the predicate.
 *
 * @param error - The error to start traversing from
 * @param predicate - Function that returns true for errors to collect
 * @param options - A `maxDepth` number, or {@link CauseTraversalOptions}
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
  options?: number | CauseTraversalOptions,
): T[];
export function filterCauseChain(
  error: unknown,
  predicate: (e: unknown) => boolean,
  options?: number | CauseTraversalOptions,
): unknown[];
export function filterCauseChain(
  error: unknown,
  predicate: (e: unknown) => boolean,
  options?: number | CauseTraversalOptions,
): unknown[] {
  const results: unknown[] = [];
  for (const current of traverse(error, options)) {
    if (predicate(current)) results.push(current);
  }
  return results;
}

/**
 * Checks if any error in the cause chain matches the predicate.
 *
 * @param error - The error to start traversing from
 * @param predicate - Function that returns true for matching errors
 * @param options - A `maxDepth` number, or {@link CauseTraversalOptions}
 * @returns True if at least one error matches the predicate. A circular
 *   chain is evaluated over each distinct node (never throws).
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
  options?: number | CauseTraversalOptions,
): boolean {
  return findInCauseChain(error, predicate, options) !== undefined;
}

/**
 * Checks if all errors in the cause chain match the predicate.
 *
 * @param error - The error to start traversing from
 * @param predicate - Function that returns true for matching errors
 * @param options - A `maxDepth` number, or {@link CauseTraversalOptions}
 * @returns True if all errors match the predicate, or if the chain is empty.
 *   A circular chain is evaluated over each distinct node (never throws).
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
  options?: number | CauseTraversalOptions,
): boolean {
  for (const current of traverse(error, options)) {
    if (!predicate(current)) return false;
  }
  return true;
}
