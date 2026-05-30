import type { StructuredError } from "./StructuredError.js";

/**
 * Narrows a member of an error union to a single `code`.
 *
 * When `E` is a real union of structured error types (e.g. produced by a
 * catalog), this resolves to the precise member — so `details` is the per-code
 * type. When `E` is a single `StructuredError<"A" | "B">` there is nothing to
 * narrow, so it falls back to `E` instead of `never`.
 */
type CaseArg<E extends StructuredError<string, string>, K extends string> = [
  Extract<E, { code: K }>,
] extends [never]
  ? E
  : Extract<E, { code: K }>;

/** Exhaustive form: every `code` in the union must have a handler. */
type ExhaustiveCases<E extends StructuredError<string, string>, R> = {
  [K in E["code"]]: (error: CaseArg<E, K>) => R;
};

/** Partial form: handle a subset, with a required `_` catch-all. */
type PartialCases<E extends StructuredError<string, string>, R> = {
  [K in E["code"]]?: (error: CaseArg<E, K>) => R;
} & { _: (error: E) => R };

/**
 * Exhaustively dispatch on a structured error's `code`, with type narrowing.
 *
 * Pass a handler per `code`. If `error`'s type is a closed union of structured
 * error types and you omit a handler, it is a **compile error** — unless you
 * provide a `_` catch-all. Each handler receives the error narrowed to its
 * case, so `details` is the precise per-code type.
 *
 * Errors caught as `unknown` must be narrowed first (e.g. with
 * `isStructuredError`) and annotated as the expected union; exhaustiveness
 * cannot be derived from `unknown`.
 *
 * @param error - The structured error to match on
 * @param cases - A handler per `code`, optionally with a `_` catch-all
 * @returns The value returned by the matching handler
 * @throws Error - When no case matches and no `_` catch-all is provided
 *   (only reachable if the static exhaustiveness check is bypassed)
 *
 * @example
 * ```ts
 * const status = matchError(err, {
 *   USER_NOT_FOUND: () => 404,
 *   EMAIL_TAKEN: () => 409,
 *   RATE_LIMITED: (e) => e.details.retryAfter > 0 ? 429 : 503,
 * });
 * ```
 *
 * @example
 * ```ts
 * // Partial handling with a catch-all
 * matchError(err, {
 *   USER_NOT_FOUND: () => render404(),
 *   _: (e) => renderGeneric(e.code),
 * });
 * ```
 */
export function matchError<E extends StructuredError<string, string>, R>(
  error: E,
  cases: ExhaustiveCases<E, R>,
): R;
export function matchError<E extends StructuredError<string, string>, R>(
  error: E,
  cases: PartialCases<E, R>,
): R;
export function matchError<E extends StructuredError<string, string>, R>(
  error: E,
  cases: ExhaustiveCases<E, R> | PartialCases<E, R>,
): R {
  const table = cases as Record<string, ((error: E) => R) | undefined>;
  const handler = table[error.code] ?? table._;

  if (!handler) {
    throw new Error(
      `matchError: unhandled error code "${error.code}" (no matching case and no "_" catch-all)`,
    );
  }

  return handler(error);
}
