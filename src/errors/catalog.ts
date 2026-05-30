import { StructuredError } from "./StructuredError.js";

/**
 * Declarative spec for a single error code in a catalog.
 *
 * `details` is a *type marker*: write `details: {} as { userId: string }` to
 * declare the per-code details shape. Its runtime value is ignored.
 */
export type ErrorSpec = {
  /** Internal category for this code. */
  category: string;
  /** Whether the failed operation can be retried. */
  retryable: boolean;
  /** HTTP status for this code, surfaced via `meta()` for boundary code. */
  httpStatus?: number;
  /** Stable, client-safe public code. */
  publicCode?: string;
  /** Default client-safe message for this code. */
  publicMessage?: string;
  /** Type marker for this code's structured details (runtime value ignored). */
  details?: Record<string, unknown>;
};

type CategoryOf<S> = S extends { category: infer C extends string }
  ? C
  : string;

/** Options accepted by a generated factory (shared, non-details part). */
type FactoryBaseOptions = {
  /** Underlying cause to preserve in the chain. */
  cause?: unknown;
  /** Per-instance public message override (defaults to the spec's). */
  publicMessage?: string;
};

/**
 * The factory signature for one code. `details` is required when the spec
 * declares a details shape, and the whole options argument is optional when it
 * does not.
 */
type FactoryFor<K extends string, S> = S extends {
  details: infer D extends Record<string, unknown>;
}
  ? (
      message: string,
      options: FactoryBaseOptions & { details: D },
    ) => StructuredError<K, CategoryOf<S>, D>
  : (
      message: string,
      options?: FactoryBaseOptions,
    ) => StructuredError<K, CategoryOf<S>, Record<string, never>>;

/** The object returned by {@link defineErrors}: a factory per code, plus `meta`. */
export type Catalog<T extends Record<string, ErrorSpec>> = {
  [K in keyof T]: FactoryFor<K & string, T[K]>;
} & {
  /** Returns the static spec row for a code (category, httpStatus, …). */
  meta<K extends keyof T>(code: K): T[K];
};

/**
 * The union of every error type a catalog can produce — the closed set to pass
 * to {@link matchError}. `meta` is excluded automatically.
 *
 * @example
 * ```ts
 * const AppErrors = defineErrors({ ... });
 * type AppError = CatalogError<typeof AppErrors>;
 * ```
 */
export type CatalogError<C> = {
  [K in keyof C]: C[K] extends (...args: never[]) => infer R
    ? R extends StructuredError<string, string>
      ? R
      : never
    : never;
}[keyof C];

/**
 * Define a catalog of structured errors from a declarative spec.
 *
 * Returns a typed factory per `code` (with `category`, `retryable` and the
 * public mapping baked in) plus a `meta(code)` accessor for boundary metadata
 * such as `httpStatus`. Errors are tagged instances of `StructuredError`
 * discriminated by `code` — not a class per code (see proposal 0001).
 *
 * @example
 * ```ts
 * const AppErrors = defineErrors({
 *   USER_NOT_FOUND: {
 *     category: "NOT_FOUND",
 *     retryable: false,
 *     httpStatus: 404,
 *     publicMessage: "The requested user was not found.",
 *     details: {} as { userId: string },
 *   },
 *   RATE_LIMITED: { category: "RATE_LIMIT", retryable: true, httpStatus: 429 },
 * });
 *
 * throw AppErrors.USER_NOT_FOUND("user 123 missing", { details: { userId: "123" } });
 *
 * const problem = err.toProblemDetails({ status: AppErrors.meta(err.code).httpStatus });
 * ```
 */
export function defineErrors<const T extends Record<string, ErrorSpec>>(
  catalog: T,
): Catalog<T> {
  const api: Record<string, unknown> = {};

  for (const code of Object.keys(catalog)) {
    const spec = catalog[code] as ErrorSpec;
    api[code] = (
      message: string,
      options?: FactoryBaseOptions & { details?: Record<string, unknown> },
    ) =>
      new StructuredError({
        code,
        category: spec.category,
        retryable: spec.retryable,
        message,
        ...(options?.details !== undefined && { details: options.details }),
        ...(spec.publicCode !== undefined && { publicCode: spec.publicCode }),
        ...(() => {
          const publicMessage = options?.publicMessage ?? spec.publicMessage;
          return publicMessage !== undefined ? { publicMessage } : {};
        })(),
        ...(options?.cause !== undefined && { cause: options.cause }),
      });
  }

  api.meta = (code: string) => catalog[code];

  return api as Catalog<T>;
}
