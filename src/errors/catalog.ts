import { StructuredError } from "./StructuredError.js";
import type { RedactMask } from "./BaseError.js";

/** JSON-safe static metadata supported by catalog definitions. */
export type CatalogJsonValue =
  | null
  | boolean
  | number
  | string
  | readonly CatalogJsonValue[]
  | { readonly [key: string]: CatalogJsonValue };

/** Static boundary metadata attached to one catalog definition. */
export type CatalogMetadata = Readonly<Record<string, CatalogJsonValue>>;

declare const DETAILS_TYPE: unique symbol;

/** Compile-time-only marker for one error code's details shape. */
export type DetailsType<T extends Record<string, unknown>> = {
  readonly [DETAILS_TYPE]: T;
};

/** Declare an error code's details type without a consumer-side cast. */
export function detailsType<
  T extends Record<string, unknown>,
>(): DetailsType<T> {
  return Object.freeze({}) as unknown as DetailsType<T>;
}

/** Declarative log-redaction policy applied by every generated factory. */
export type CatalogRedactionPolicy =
  | {
      readonly mode: "deny";
      readonly keys: readonly string[];
      readonly mask?: RedactMask;
    }
  | {
      readonly mode: "allow";
      readonly keys: readonly string[];
      readonly mask?: RedactMask;
    };

/**
 * Declarative spec for a single error code in a catalog.
 *
 * `details` is a compile-time marker created by {@link detailsType}.
 */
export type ErrorSpec = {
  /** Internal category for this code. */
  category: string;
  /** Whether the failed operation can be retried. */
  retryable: boolean;
  /** JSON-safe static metadata for transport and boundary adapters. */
  metadata?: CatalogMetadata;
  /** Type marker for this code's structured details. */
  details?: DetailsType<Record<string, unknown>>;
  /** Sticky log-redaction policy applied to generated instances. */
  redaction?: CatalogRedactionPolicy;
};

/** A reusable finite catalog definition. Prefer `satisfies` over annotation. */
export type ErrorCatalogDefinition = Readonly<Record<string, ErrorSpec>>;

type InvalidCatalogSpec<T extends ErrorCatalogDefinition> = {
  [K in keyof T]: Exclude<keyof T[K], keyof ErrorSpec> extends never
    ? T[K] extends { redaction: infer R }
      ? Exclude<keyof R, keyof CatalogRedactionPolicy> extends never
        ? never
        : K
      : never
    : K;
}[keyof T];

type ValidCatalogDefinition<T extends ErrorCatalogDefinition> = [
  keyof T,
] extends [never]
  ? never
  : string extends keyof T
    ? never
    : Exclude<keyof T, string> extends never
      ? InvalidCatalogSpec<T> extends never
        ? unknown
        : never
      : never;

type CatalogValidationArgs<T extends ErrorCatalogDefinition> = [
  ValidCatalogDefinition<T>,
] extends [never]
  ? [invalidCatalog: never]
  : "" extends keyof T
    ? [invalidCatalog: never]
    : [];

type CategoryOf<S> = S extends { category: infer C extends string }
  ? C
  : string;

type RetryableOf<S> = S extends { retryable: infer R extends boolean }
  ? R
  : boolean;

/** Immutable static metadata returned by `Catalog.meta()`. */
export type CatalogMeta<S extends ErrorSpec> = {
  readonly category: CategoryOf<S>;
  readonly retryable: RetryableOf<S>;
} & (S extends { metadata: infer M extends CatalogMetadata }
  ? { readonly metadata: M }
  : Record<never, never>);

/** Options accepted by a generated factory (shared, non-details part). */
type FactoryBaseOptions = {
  /** Underlying cause to preserve in the chain. */
  cause?: unknown;
};

/**
 * The factory signature for one code. `details` is required when the spec
 * declares a details shape, and the whole options argument is optional when it
 * does not.
 */
type FactoryFor<K extends string, S> = S extends {
  details: DetailsType<infer D extends Record<string, unknown>>;
}
  ? (
      message: string,
      options: FactoryBaseOptions & { details: D },
    ) => StructuredError<K, CategoryOf<S>, D>
  : (
      message: string,
      options?: FactoryBaseOptions,
    ) => StructuredError<K, CategoryOf<S>, Record<string, never>>;

/** Typed factory namespace produced by {@link defineErrors}. */
type CatalogFactories<T extends Record<string, ErrorSpec>> = {
  [K in keyof T]: FactoryFor<K & string, T[K]>;
};

/** The object returned by {@link defineErrors}. */
export type Catalog<T extends ErrorCatalogDefinition> = {
  /** Factory namespace with one precisely typed constructor per error code. */
  readonly create: CatalogFactories<T>;
  /** Finite runtime list of the catalog's error codes. */
  readonly codes: readonly (keyof T & string)[];
  /** Returns immutable core fields and static boundary metadata for a code. */
  meta<K extends keyof T>(code: K): CatalogMeta<T[K]>;
  /** Recognize any error created by this exact catalog. */
  is(value: unknown): value is CatalogError<Catalog<T>>;
  /** Recognize one code created by this exact catalog. */
  is<K extends keyof T & string>(
    value: unknown,
    code: K,
  ): value is CatalogErrorOf<Catalog<T>, K>;
};

/**
 * The union of every error type a catalog can produce. Pass this closed set to
 * {@link matchError}. `meta` is excluded automatically.
 *
 * @example
 * ```ts
 * const AppErrors = defineErrors({ ... });
 * type AppError = CatalogError<typeof AppErrors>;
 * ```
 */
export type CatalogError<C extends { create: Record<string, unknown> }> = {
  [K in keyof C["create"]]: C["create"][K] extends (...args: never[]) => infer R
    ? R extends StructuredError<string, string>
      ? R
      : never
    : never;
}[keyof C["create"]];

/** Extract one generated error type from a catalog by its code. */
export type CatalogErrorOf<
  C extends { create: Record<string, unknown> },
  K extends keyof C["create"],
> = C["create"][K] extends (...args: never[]) => infer R
  ? R extends StructuredError<string, string>
    ? R
    : never
  : never;

type RuntimeSpec = {
  readonly category: string;
  readonly retryable: boolean;
  readonly metadata?: CatalogMetadata;
  readonly redaction?: CatalogRedactionPolicy;
};

function cloneJsonValue(value: unknown, seen: Set<object>): CatalogJsonValue {
  if (
    value === null ||
    typeof value === "string" ||
    typeof value === "boolean"
  ) {
    return value;
  }
  if (typeof value === "number") {
    if (Number.isFinite(value)) return value;
    throw new Error("defineErrors: metadata must be JSON-safe");
  }
  if (typeof value !== "object") {
    throw new Error("defineErrors: metadata must be JSON-safe");
  }
  if (seen.has(value)) {
    throw new Error("defineErrors: metadata must be JSON-safe");
  }

  seen.add(value);
  try {
    if (Array.isArray(value)) {
      for (let index = 0; index < value.length; index++) {
        if (!Object.prototype.hasOwnProperty.call(value, index)) {
          throw new Error("defineErrors: metadata must be JSON-safe");
        }
      }
      return Object.freeze(
        value.map((item) => cloneJsonValue(item, seen)),
      ) as readonly CatalogJsonValue[];
    }

    const prototype = Object.getPrototypeOf(value) as unknown;
    if (prototype !== Object.prototype && prototype !== null) {
      throw new Error("defineErrors: metadata must be JSON-safe");
    }
    if (Object.getOwnPropertySymbols(value).length > 0) {
      throw new Error("defineErrors: metadata must be JSON-safe");
    }

    const clone = Object.create(null) as Record<string, CatalogJsonValue>;
    for (const [key, item] of Object.entries(value)) {
      clone[key] = cloneJsonValue(item, seen);
    }
    return Object.freeze(clone);
  } finally {
    seen.delete(value);
  }
}

function snapshotRedaction(value: unknown): CatalogRedactionPolicy | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== "object" || value === null) {
    throw new Error("defineErrors: invalid redaction policy");
  }

  const allowedKeys = new Set(["mode", "keys", "mask"]);
  for (const key of Reflect.ownKeys(value)) {
    if (typeof key !== "string" || !allowedKeys.has(key)) {
      throw new Error(`defineErrors: unknown redaction field "${String(key)}"`);
    }
  }

  const policy = value as Partial<CatalogRedactionPolicy>;
  if (
    (policy.mode !== "deny" && policy.mode !== "allow") ||
    !Array.isArray(policy.keys) ||
    !policy.keys.every((key) => typeof key === "string") ||
    (policy.mask !== undefined &&
      typeof policy.mask !== "string" &&
      typeof policy.mask !== "function")
  ) {
    throw new Error("defineErrors: invalid redaction policy");
  }

  return Object.freeze({
    mode: policy.mode,
    keys: Object.freeze([...policy.keys]),
    ...(policy.mask !== undefined && { mask: policy.mask }),
  });
}

/**
 * Define a catalog of structured errors from a declarative spec.
 *
 * Returns an immutable catalog with namespaced factories, static metadata,
 * local provenance guards, and optional catalog-level redaction. Errors are
 * tagged instances of `StructuredError` discriminated by `code`.
 *
 * @example
 * ```ts
 * const AppErrors = defineErrors({
 *   USER_NOT_FOUND: {
 *     category: "NOT_FOUND",
 *     retryable: false,
 *     metadata: { httpStatus: 404 },
 *     details: detailsType<{ userId: string }>(),
 *   },
 *   RATE_LIMITED: {
 *     category: "RATE_LIMIT",
 *     retryable: true,
 *     metadata: { httpStatus: 429 },
 *   },
 * });
 *
 * throw AppErrors.create.USER_NOT_FOUND("user 123 missing", {
 *   details: { userId: "123" },
 * });
 *
 * const status = AppErrors.meta(err.code).metadata.httpStatus;
 * ```
 */
export function defineErrors<const T extends ErrorCatalogDefinition>(
  catalog: T,
  ..._validation: CatalogValidationArgs<T>
): Catalog<T>;
export function defineErrors(
  catalog: ErrorCatalogDefinition,
): Catalog<ErrorCatalogDefinition> {
  if (
    typeof catalog !== "object" ||
    catalog === null ||
    Array.isArray(catalog) ||
    (Object.getPrototypeOf(catalog) !== Object.prototype &&
      Object.getPrototypeOf(catalog) !== null)
  ) {
    throw new Error("defineErrors: catalog must be a plain object");
  }

  const ownKeys = Reflect.ownKeys(catalog);
  if (ownKeys.some((code) => typeof code !== "string")) {
    throw new Error("defineErrors: error codes must be strings");
  }
  if (ownKeys.includes("")) {
    throw new Error("defineErrors: error codes must not be empty");
  }

  const create = Object.create(null) as Record<string, unknown>;
  const provenance = new WeakMap<object, string>();
  const codes = Object.keys(catalog);
  if (codes.length === 0) {
    throw new Error("defineErrors: catalog must not be empty");
  }

  const snapshot = Object.create(null) as Record<string, RuntimeSpec>;
  const metaSnapshot = Object.create(null) as Record<
    string,
    CatalogMeta<ErrorSpec>
  >;
  const allowedSpecKeys = new Set([
    "category",
    "retryable",
    "metadata",
    "details",
    "redaction",
  ]);

  for (const code of codes) {
    const spec = catalog[code] as ErrorSpec;
    if (
      typeof spec !== "object" ||
      spec === null ||
      typeof spec.category !== "string" ||
      spec.category.length === 0 ||
      typeof spec.retryable !== "boolean"
    ) {
      throw new Error(`defineErrors: invalid definition for code "${code}"`);
    }
    for (const key of Reflect.ownKeys(spec)) {
      if (typeof key !== "string" || !allowedSpecKeys.has(key)) {
        throw new Error(
          `defineErrors: unknown definition field "${String(key)}" for code "${code}"`,
        );
      }
    }

    if (
      spec.metadata !== undefined &&
      (typeof spec.metadata !== "object" ||
        spec.metadata === null ||
        Array.isArray(spec.metadata))
    ) {
      throw new Error("defineErrors: metadata must be an object");
    }
    const metadata =
      spec.metadata === undefined
        ? undefined
        : (cloneJsonValue(spec.metadata, new Set()) as CatalogMetadata);
    const redaction = snapshotRedaction(spec.redaction);

    snapshot[code] = Object.freeze({
      category: spec.category,
      retryable: spec.retryable,
      ...(metadata !== undefined && { metadata }),
      ...(redaction !== undefined && { redaction }),
    });
    metaSnapshot[code] = Object.freeze({
      category: spec.category,
      retryable: spec.retryable,
      ...(metadata !== undefined && { metadata }),
    });
  }

  for (const code of codes) {
    const spec = snapshot[code] as RuntimeSpec;
    create[code] = (
      message: string,
      options?: FactoryBaseOptions & { details?: Record<string, unknown> },
    ) => {
      const error = new StructuredError({
        code,
        category: spec.category,
        retryable: spec.retryable,
        message,
        ...(options?.details !== undefined && { details: options.details }),
        ...(options?.cause !== undefined && { cause: options.cause }),
      });
      if (spec.redaction?.mode === "deny") {
        error.redact([...spec.redaction.keys], { mask: spec.redaction.mask });
      } else if (spec.redaction?.mode === "allow") {
        error.redactAllow([...spec.redaction.keys], {
          mask: spec.redaction.mask,
        });
      }
      provenance.set(error, code);
      return error;
    };
  }

  return Object.freeze({
    create: Object.freeze(create),
    codes: Object.freeze(codes),
    meta(code: string) {
      if (!Object.prototype.hasOwnProperty.call(snapshot, code)) {
        throw new Error(`meta: unknown error code "${code}"`);
      }
      return metaSnapshot[code] as CatalogMeta<ErrorSpec>;
    },
    is(value: unknown, expectedCode?: string): boolean {
      if (!(value instanceof StructuredError)) return false;

      const actualCode = provenance.get(value);
      if (actualCode === undefined) return false;
      if (expectedCode !== undefined && actualCode !== expectedCode) {
        return false;
      }

      const spec = snapshot[actualCode];
      return (
        spec !== undefined &&
        value.code === actualCode &&
        value.category === spec.category &&
        value.retryable === spec.retryable
      );
    },
  }) as unknown as Catalog<ErrorCatalogDefinition>;
}
