import { StructuredError } from "./StructuredError.js";
import type { ErrorOptions } from "./ErrorOptions.js";

/** Options for {@link StructuredAggregateError}. */
export type StructuredAggregateErrorOptions<
  TCode extends string,
  TCategory extends string,
  TDetails extends Record<string, unknown>,
> = ErrorOptions<TCode, TCategory, TDetails> & {
  /** The failures this error aggregates. Copied on construction. */
  errors: Iterable<unknown>;
};

/**
 * A `StructuredError` that aggregates several failures: the result of a
 * `Promise.allSettled` fan-out, a batch job, or saga compensation.
 *
 * It carries its members in `errors`, the same field a native `AggregateError`
 * uses, so everything in this library that reads aggregates by shape works on
 * it unchanged: `toLogObject` serializes the members (width-capped and
 * cycle-safe), `redact`/`redactAllow` reach into them, `toString` counts them,
 * `StructuredError.fromJSON` restores them, and the cause-chain helpers walk
 * them with `{ aggregates: true }`.
 *
 * It deliberately does **not** extend `AggregateError`: single inheritance is
 * already spent on `BaseError`, and `AggregateError`'s iterable-first
 * constructor conflicts with the options object used across this library.
 * Consumers duck-type `errors`, so the identity buys nothing.
 *
 * @example
 * ```ts
 * const results = await Promise.allSettled(items.map(process));
 * const failures = results.filter((r) => r.status === "rejected").map((r) => r.reason);
 * if (failures.length > 0) {
 *   throw new StructuredAggregateError({
 *     code: "BATCH_FAILED",
 *     category: "INTERNAL",
 *     retryable: failures.every(isRetryable),
 *     message: `${failures.length} of ${items.length} items failed`,
 *     errors: failures,
 *   });
 * }
 * ```
 */
export class StructuredAggregateError<
  TCode extends string,
  TCategory extends string,
  // eslint-disable-next-line @typescript-eslint/no-empty-object-type
  TDetails extends Record<string, unknown> = Record<string, {}>,
> extends StructuredError<TCode, TCategory, TDetails> {
  public override readonly _tag: string = "StructuredAggregateError";

  /**
   * The aggregated failures. A copy of the iterable passed in, so a later
   * mutation of the caller's array cannot change what gets logged.
   */
  public readonly errors: readonly unknown[];

  public /*#__PURE__*/ constructor(
    options: StructuredAggregateErrorOptions<TCode, TCategory, TDetails>,
  ) {
    super(options);
    this.errors = [...options.errors];
  }
}
