import type { StructuredError } from "./StructuredError.js";

/**
 * Narrows a member of an error union to a single `code`.
 *
 * When `E` is a real union of structured error types (e.g. produced by a
 * catalog), this resolves to the precise member. Then `details` is the
 * per-code type. When `E` is a single `StructuredError<"A" | "B">`, there is
 * nothing to narrow, so it falls back to `E` instead of `never`.
 */
type CaseArg<E extends StructuredError<string, string>, K extends string> = [
  Extract<E, { code: K }>,
] extends [never]
  ? E
  : Extract<E, { code: K }>;

/**
 * All handlers, each optional, plus an optional `_` catch-all. Return types are
 * left open so the concrete handler object can drive the result type.
 */
type Cases<E extends StructuredError<string, string>> = {
  [K in E["code"]]?: (error: CaseArg<E, K>) => unknown;
} & { _?: (error: E) => unknown };

/** The union of every handler's return type. This is the result of a matcher. */
export type HandlerResult<C> = {
  [K in keyof C]: C[K] extends (...args: never[]) => infer R ? R : never;
}[keyof C];

/**
 * The own handler of `name` in a handler table. A name that collides with an
 * `Object.prototype` member (e.g. "toString", "valueOf", "hasOwnProperty")
 * must route to its explicit case or the `_` catch-all. It must never route
 * to an inherited method.
 */
export function ownCase<H>(
  cases: Readonly<Record<string, H | undefined>>,
  name: string,
): H | undefined {
  return Object.prototype.hasOwnProperty.call(cases, name)
    ? cases[name]
    : undefined;
}

type CatchAllCodeRule =
  "matchError is unavailable: the code _ is also the catch-all; rename the code";

/** A wide `string` code contains `_` too, but it names no code `_`. */
type HasCatchAllCode<E extends StructuredError<string, string>> =
  string extends E["code"] ? false : "_" extends E["code"] ? true : false;

/**
 * Rejects a code that `E` does not contain, also next to a `_` catch-all.
 * Without a `_` catch-all, every `code` must have a handler. Missing codes are
 * added as required, so an incomplete object fails to type-check.
 */
type Exhaustive<E extends StructuredError<string, string>, C> =
  HasCatchAllCode<E> extends true
    ? CatchAllCodeRule
    : [Exclude<keyof C, E["code"] | "_">] extends [never]
      ? "_" extends keyof C
        ? C
        : [Exclude<E["code"], keyof C>] extends [never]
          ? C
          : C & {
              [K in Exclude<E["code"], keyof C>]: (
                error: CaseArg<E, K>,
              ) => unknown;
            }
      : C & Record<Exclude<keyof C, E["code"] | "_">, never>;

/**
 * Exhaustively dispatch on a structured error's `code`, with type narrowing.
 *
 * Pass a handler per `code`. If `error`'s type is a closed union of structured
 * error types, an omitted handler is a **compile error** (unless you provide
 * a `_` catch-all). Each handler receives the error narrowed to its case, so
 * `details` is the precise per-code type. The return type is the union of the
 * handler return types.
 *
 * Narrow an error caught as `unknown` first (e.g. with `isStructuredError`),
 * and annotate it as the expected union. The compiler cannot derive
 * exhaustiveness from `unknown`.
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
 *   RATE_LIMITED: (e) => (e.retryable ? 429 : 503),
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
export function matchError<
  E extends StructuredError<string, string>,
  const C extends Cases<E>,
>(error: E, cases: Exhaustive<E, C>): HandlerResult<C> {
  const table = cases as Record<string, ((error: E) => unknown) | undefined>;
  const handler = ownCase(table, error.code) ?? table._;

  if (!handler) {
    throw new Error(
      `matchError: unhandled error code "${error.code}" (no matching case and no "_" catch-all)`,
    );
  }

  return handler(error) as HandlerResult<C>;
}
