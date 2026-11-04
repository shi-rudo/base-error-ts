import { StructuredError, rebuildFromJSON } from "./StructuredError.js";
import type { AnyStructuredError } from "./StructuredError.js";
import { createRedactionFloor, setRedactionFloor } from "./BaseError.js";
import type { BuiltInRedactionPolicy, RedactionFloor } from "./BaseError.js";
import { UNKNOWN_ERROR_DEFAULTS } from "./defaults.js";
import { isArrayValue, isInstanceOf, readProperty } from "./guarded-read.js";
import { cloneJsonSafe } from "./json-safe.js";
import type { JsonSafeValue } from "./json-safe.js";
import { ownCase } from "./match.js";
import type {
  CatchAll,
  HandledNames,
  HandlerNames,
  HandlerResult,
  TableLostToConstraint,
  UnknownHandlerNames,
  UnknownNameRule,
} from "./match.js";

/** JSON-safe static metadata supported by catalog definitions. Alias of `JsonSafeValue`, whose module owns the JSON-safety rules. */
export type CatalogJsonValue = JsonSafeValue;

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

/** The result of a Standard Schema validator: the output or the issues. */
type DetailsSchemaResult<T> =
  | { readonly value: T; readonly issues?: undefined }
  | { readonly issues: ReadonlyArray<unknown> };

/**
 * A validator of one error code's details that implements Standard Schema v1
 * (standardschema.dev), such as a Zod, Valibot or ArkType schema. The details
 * type of the code is the output type of the schema.
 */
export type DetailsSchema<T extends Record<string, unknown>> = {
  readonly "~standard": {
    readonly version: 1;
    readonly vendor: string;
    readonly validate: (
      value: unknown,
    ) => DetailsSchemaResult<T> | Promise<DetailsSchemaResult<T>>;
    readonly types?:
      { readonly input: unknown; readonly output: T } | undefined;
  };
};

/**
 * Declarative log-redaction policy of a definition. It is the redaction floor
 * of every generated error: a per-instance policy adds to it and never
 * replaces it.
 */
export type CatalogRedactionPolicy = BuiltInRedactionPolicy;

/**
 * Declarative spec for a single error code in a catalog.
 *
 * `details` is a compile-time marker created by {@link detailsType}, or a
 * {@link DetailsSchema} that `Catalog.fromJSON` validates with.
 */
export type ErrorSpec = {
  /** Internal category for this code. */
  category: string;
  /** Whether the failed operation can be retried. */
  retryable: boolean;
  /** JSON-safe static metadata for transport and boundary adapters. */
  metadata?: CatalogMetadata;
  /** The type marker or the schema of this code's structured details. */
  details?:
    | DetailsType<Record<string, unknown>>
    | DetailsSchema<Record<string, unknown>>;
  /** The redaction floor of generated instances. */
  redaction?: CatalogRedactionPolicy;
};

/** A reusable finite catalog definition. Prefer `satisfies` over annotation. */
export type ErrorCatalogDefinition = Readonly<Record<string, ErrorSpec>>;

/** Options accepted by {@link defineErrors}. */
export type CatalogOptions<P extends string | undefined = string | undefined> =
  {
    /**
     * The namespace in front of every key. The code of a definition is
     * `${prefix}.${key}`. Without a prefix, the key is the code.
     */
    readonly prefix?: P;
  };

type CodeOf<K extends string, P extends string | undefined> = [P] extends [
  undefined,
]
  ? K
  : `${P}.${K}`;

type InvalidPrefix<P extends string> = P extends
  "" | `.${string}` | `${string}.` | `${string}..${string}`
  ? true
  : false;

/** A string type, so that the compiler error states the rule. */
type PrefixRule =
  "expected a string literal prefix without a leading, trailing or doubled dot";

type ValidPrefix<P extends string | undefined> = [P] extends [undefined]
  ? P
  : undefined extends P
    ? PrefixRule
    : string extends P
      ? PrefixRule
      : InvalidPrefix<P & string> extends false
        ? P
        : PrefixRule;

type DottedKeyRule = "expected keys without a dot when a prefix is set";

/** The prefix holds every segment, so the key is the last segment of a code. */
type PrefixFor<
  T extends ErrorCatalogDefinition,
  P extends string | undefined,
> = [P] extends [undefined]
  ? P
  : [Extract<keyof T, `${string}.${string}`>] extends [never]
    ? ValidPrefix<P>
    : DottedKeyRule;

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

/**
 * A prefix type argument without `undefined`, given explicitly or inferred,
 * requires the `prefix` option. Without it, the typed codes would carry a
 * prefix that the runtime codes do not have.
 */
type CatalogArgs<
  T extends ErrorCatalogDefinition,
  P extends string | undefined,
> = [ValidCatalogDefinition<T>] extends [never]
  ? [invalidCatalog: never]
  : "" extends keyof T
    ? [invalidCatalog: never]
    : undefined extends P
      ? [options?: CatalogOptions<PrefixFor<T, P>>]
      : [
          options: CatalogOptions<PrefixFor<T, P>> & {
            readonly prefix: PrefixFor<T, P>;
          },
        ];

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
 * The details type that a spec declares: the type of its marker, or the
 * output type of its schema. `never` when the spec declares none.
 */
type DetailsOf<S> = S extends {
  details: DetailsType<infer D extends Record<string, unknown>>;
}
  ? D
  : S extends {
        details: { readonly "~standard": { readonly types?: infer T } };
      }
    ? NonNullable<T> extends { readonly output: infer D }
      ? D
      : never
    : never;

/**
 * The factory signature for one code. `details` is required when the spec
 * declares a details shape, and the whole options argument is optional when it
 * does not.
 */
type FactoryFor<K extends string, S> = [DetailsOf<S>] extends [
  infer D extends Record<string, unknown>,
]
  ? [D] extends [never]
    ? (
        message: string,
        options?: FactoryBaseOptions,
      ) => StructuredError<K, CategoryOf<S>, Record<string, never>>
    : (
        message: string,
        options: FactoryBaseOptions & { details: D },
      ) => StructuredError<K, CategoryOf<S>, D>
  : never;

/** Typed factory namespace produced by {@link defineErrors}. */
type CatalogFactories<
  T extends Record<string, ErrorSpec>,
  P extends string | undefined,
> = {
  [K in keyof T]: FactoryFor<CodeOf<K & string, P>, T[K]>;
};

/** The keys whose code occurs in the error union `E`. */
type KeyIn<
  T extends ErrorCatalogDefinition,
  P extends string | undefined,
  E extends StructuredError<string, string>,
> = {
  [K in keyof T & string]: CodeOf<K, P> extends E["code"] ? K : never;
}[keyof T & string];

type KeyCaseArg<
  P extends string | undefined,
  E extends StructuredError<string, string>,
  K extends string,
> = Extract<E, { code: CodeOf<K, P> }>;

/**
 * A handler per key, each optional, plus an optional `_` catch-all that
 * `CatchAll` types, as in `matchErrorCode`.
 */
type KeyCases<
  T extends ErrorCatalogDefinition,
  P extends string | undefined,
  E extends StructuredError<string, string>,
> = {
  [K in keyof T & string]?: (error: KeyCaseArg<P, E, K>) => unknown;
} & { _?: unknown };

type CatchAllKeyRule =
  "match is unavailable: the key _ is also the catch-all; rename the key, or use matchErrorCode";

type UnknownKeyRule<Name extends string> =
  `match: ${Name} is not a key of this catalog`;

/**
 * Rejects a key that the catalog does not define, with `UnknownNameRule`.
 * Without a `_` catch-all, every key of `E` must have a handler.
 */
type KeyExhaustive<
  T extends ErrorCatalogDefinition,
  P extends string | undefined,
  E extends StructuredError<string, string>,
  C,
> = "_" extends keyof T
  ? CatchAllKeyRule
  : [UnknownHandlerNames<C, keyof T & string>] extends [never]
    ? "_" extends keyof C
      ? C
      : [Exclude<KeyIn<T, P, E>, HandlerNames<C>>] extends [never]
        ? C
        : C & {
            [K in Exclude<KeyIn<T, P, E>, HandlerNames<C>>]: (
              error: KeyCaseArg<P, E, K>,
            ) => unknown;
          }
    : C & {
        [K in UnknownHandlerNames<C, keyof T & string>]: UnknownNameRule<
          C,
          K,
          UnknownKeyRule<K>
        >;
      };

/**
 * Rejects a table with no key among its names. Every key of `E` stays required,
 * because `C` holds no handler that `UnknownNameRule` can inspect for `any`.
 */
type TableOfUnknownKeys<
  T extends ErrorCatalogDefinition,
  P extends string | undefined,
  E extends StructuredError<string, string>,
  C,
  TableNames extends PropertyKey,
> =
  TableLostToConstraint<C, KeyCases<T, P, E>, TableNames> extends true
    ? {
        [
          K in Exclude<HandledNames<TableNames>, keyof T & string>
        ]: UnknownKeyRule<K>;
      } & {
        [K in KeyIn<T, P, E>]: (error: KeyCaseArg<P, E, K>) => unknown;
      }
    : unknown;

/** The object returned by {@link defineErrors}. */
export type Catalog<
  T extends ErrorCatalogDefinition,
  P extends string | undefined = undefined,
> = {
  /** Factory namespace with one precisely typed constructor per key. */
  readonly create: CatalogFactories<T, P>;
  /** The code of each key. */
  readonly code: { readonly [K in keyof T & string]: CodeOf<K, P> };
  /** Finite runtime list of the catalog's error codes, in key order. */
  readonly codes: readonly CodeOf<keyof T & string, P>[];
  /** Returns immutable core fields and static boundary metadata for a code. */
  meta<K extends keyof T & string>(code: CodeOf<K, P>): CatalogMeta<T[K]>;
  /** Recognize any error created by this exact catalog. */
  is(value: unknown): value is CatalogError<Catalog<T, P>>;
  /** Recognize the errors of one key created by this exact catalog. */
  is<K extends keyof T & string>(
    value: unknown,
    key: K,
  ): value is CatalogErrorOf<Catalog<T, P>, K>;
  /**
   * Restores an error of this catalog from its serialized form, or returns
   * `undefined` when the payload does not fit the catalog. `undefined` does
   * not mean that there is no error: the payload is still an error, only not
   * one of this catalog. Fall back, for example to
   * `StructuredError.fromJSON(payload)`, and never drop it. The `code` must be
   * a code of the catalog, and the `details` must pass the schema of its key.
   * The factory of the key creates the error, so `category`, `retryable` and
   * the redaction floor come from the definition, and the error passes
   * `is`. The message, the stack, the time and the cause chain
   * come from the payload, as in `StructuredError.fromJSON`. A key without a
   * schema drops the `details` of the payload. Use it within one trust
   * boundary only, such as a worker, a queue or storage of the same system.
   *
   * @throws Error - When the schema throws, or answers with a promise
   */
  fromJSON(payload: unknown): CatalogError<Catalog<T, P>> | undefined;
  /**
   * Exhaustively dispatch on the key of an error of this catalog, with type
   * narrowing. `matchErrorCode` with handlers named by key: the `_`
   * catch-all receives the errors whose key has no handler, it checks no
   * provenance, and it throws when no case matches and no `_` catch-all
   * exists. A handler that can be `undefined` is a compile error.
   */
  match<
    E extends CatalogError<Catalog<T, P>>,
    const C extends KeyCases<T, P, E>,
    Names extends PropertyKey = never,
  >(
    error: E,
    cases: KeyExhaustive<T, P, E, C> &
      CatchAll<E, Names, CodeOf<HandledNames<Names>, P>> &
      TableOfUnknownKeys<T, P, E, C, Names>,
  ): HandlerResult<C>;
};

/**
 * The union of every error type a catalog can produce. Pass this closed set to
 * {@link matchErrorCode}. `meta` is excluded automatically.
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

/** Extract one generated error type from a catalog by its key. */
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
  readonly floor?: RedactionFloor;
  readonly validateDetails?: DetailsValidator;
};

type DetailsValidator = (value: unknown) => unknown;

type RuntimeFactory = (
  message: string,
  options?: FactoryBaseOptions & { details?: Record<string, unknown> },
) => AnyStructuredError;

/**
 * The validate function of a details schema, or `undefined` for the marker
 * of {@link detailsType}. A schema can be a function, as an ArkType type is.
 * A value that names Standard Schema without a version 1 validate function
 * is a definition error.
 */
function readDetailsValidator(
  details: unknown,
  key: string,
): DetailsValidator | undefined {
  if (
    (typeof details !== "object" && typeof details !== "function") ||
    details === null
  ) {
    return undefined;
  }
  const schema = details as { readonly "~standard"?: unknown };
  const standard = schema["~standard"];
  if (standard === undefined) return undefined;
  const validate = readProperty(standard, "validate");
  if (
    readProperty(standard, "version") !== 1 ||
    typeof validate !== "function"
  ) {
    throw new Error(
      `defineErrors: the details of key "${key}" are not a Standard Schema v1 validator`,
    );
  }
  return (value) => Reflect.apply(validate, standard, [value]) as unknown;
}

/** Details that fail the schema of their key. */
const REJECTED_DETAILS: unique symbol = Symbol("rejected details");

/**
 * The details of a restored error: the output of the schema of `key`, or
 * `undefined` for a key without a schema. The result of the schema is
 * consumer data, so every read of it is guarded.
 */
function restoredDetails(
  validate: DetailsValidator | undefined,
  key: string,
  details: Record<string, unknown> | undefined,
): Record<string, unknown> | undefined | typeof REJECTED_DETAILS {
  if (validate === undefined) return undefined;
  const result = validate(details);
  if (typeof readProperty(result, "then") === "function") {
    throw new Error(
      `fromJSON: the details schema of key "${key}" returned a promise; a details schema must validate synchronously`,
    );
  }
  if (readProperty(result, "issues") !== undefined) return REJECTED_DETAILS;
  const value = readProperty(result, "value");
  return typeof value === "object" && value !== null && !isArrayValue(value)
    ? (value as Record<string, unknown>)
    : REJECTED_DETAILS;
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

function isPlainObject(value: unknown): value is object {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return false;
  }
  const prototype: unknown = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function readPrefix(options: unknown): string | undefined {
  if (options === undefined) return undefined;
  if (!isPlainObject(options)) {
    throw new Error("defineErrors: options must be a plain object");
  }
  for (const key of Reflect.ownKeys(options)) {
    if (key !== "prefix") {
      throw new Error(`defineErrors: unknown option "${String(key)}"`);
    }
  }

  const fields = options as CatalogOptions;
  const prefix: unknown = fields.prefix;
  if (prefix === undefined) return undefined;
  if (typeof prefix !== "string" || prefix.split(".").includes("")) {
    const rendered =
      typeof prefix === "string"
        ? `"${prefix}"`
        : `of type ${prefix === null ? "null" : typeof prefix}`;
    throw new Error(
      `defineErrors: invalid prefix ${rendered}; expected a non-empty string without a leading, trailing or doubled "."`,
    );
  }
  return prefix;
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
 *
 * A `prefix` separates the key of a definition from its code. The key names
 * the factory, and the code is `${prefix}.${key}`:
 *
 * @example
 * ```ts
 * const AuthzErrors = defineErrors(
 *   { not_a_member: { category: "FORBIDDEN", retryable: false } },
 *   { prefix: "restaurant.authz" },
 * );
 *
 * AuthzErrors.create.not_a_member("actor 42 is not a member of org 7").code;
 * // "restaurant.authz.not_a_member"
 * ```
 */
export function defineErrors<
  const T extends ErrorCatalogDefinition,
  const P extends string | undefined = undefined,
>(catalog: T, ...options: CatalogArgs<T, P>): Catalog<T, P>;
export function defineErrors(
  catalog: ErrorCatalogDefinition,
  catalogOptions?: unknown,
): Catalog<ErrorCatalogDefinition> {
  if (!isPlainObject(catalog)) {
    throw new Error("defineErrors: catalog must be a plain object");
  }

  const ownKeys = Reflect.ownKeys(catalog);
  if (ownKeys.some((key) => typeof key !== "string")) {
    throw new Error("defineErrors: keys must be strings");
  }
  if (ownKeys.includes("")) {
    throw new Error("defineErrors: keys must not be empty");
  }

  const create = Object.create(null) as Record<string, unknown>;
  const provenance = new WeakMap<object, string>();
  const keys = Object.keys(catalog);
  if (keys.length === 0) {
    throw new Error("defineErrors: catalog must not be empty");
  }

  const prefix = readPrefix(catalogOptions);
  const keyIsCatchAll = keys.includes("_");
  const codeByKey = Object.create(null) as Record<string, string>;
  const keyByCode = new Map<string, string>();
  const codes: string[] = [];
  for (const key of keys) {
    if (prefix !== undefined && key.includes(".")) {
      throw new Error(
        `defineErrors: key "${key}" contains "."; with a prefix, the prefix holds every segment before the key`,
      );
    }
    const code = prefix === undefined ? key : `${prefix}.${key}`;
    codeByKey[key] = code;
    keyByCode.set(code, key);
    codes.push(code);
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

  for (const key of keys) {
    const spec = catalog[key] as ErrorSpec;
    if (
      typeof spec !== "object" ||
      spec === null ||
      typeof spec.category !== "string" ||
      spec.category.length === 0 ||
      typeof spec.retryable !== "boolean"
    ) {
      throw new Error(`defineErrors: invalid definition for key "${key}"`);
    }
    for (const field of Reflect.ownKeys(spec)) {
      if (typeof field !== "string" || !allowedSpecKeys.has(field)) {
        throw new Error(
          `defineErrors: unknown definition field "${String(field)}" for key "${key}"`,
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
        : (cloneJsonSafe(spec.metadata, {
            errorMessage: "defineErrors: metadata must be JSON-safe",
          }) as CatalogMetadata);
    const redaction = snapshotRedaction(spec.redaction);
    const validateDetails = readDetailsValidator(spec.details, key);

    snapshot[key] = Object.freeze({
      category: spec.category,
      retryable: spec.retryable,
      ...(metadata !== undefined && { metadata }),
      ...(redaction !== undefined && {
        floor: createRedactionFloor(redaction),
      }),
      ...(validateDetails !== undefined && { validateDetails }),
    });
    metaSnapshot[key] = Object.freeze({
      category: spec.category,
      retryable: spec.retryable,
      ...(metadata !== undefined && { metadata }),
    });
  }

  const factoryByKey = Object.create(null) as Record<string, RuntimeFactory>;
  for (const key of keys) {
    const spec = snapshot[key] as RuntimeSpec;
    const code = codeByKey[key] as string;
    const factory: RuntimeFactory = (message, options) => {
      const error = new StructuredError({
        code,
        category: spec.category,
        retryable: spec.retryable,
        message,
        ...(options?.details !== undefined && { details: options.details }),
        ...(options?.cause !== undefined && { cause: options.cause }),
      });
      if (spec.floor !== undefined) {
        setRedactionFloor(error, spec.floor);
      }
      provenance.set(error, key);
      return error;
    };
    create[key] = factory;
    factoryByKey[key] = factory;
  }

  return Object.freeze({
    create: Object.freeze(create),
    code: Object.freeze(codeByKey),
    codes: Object.freeze(codes),
    meta(code: string) {
      const key = keyByCode.get(code);
      if (key === undefined) {
        throw new Error(`meta: unknown error code "${code}"`);
      }
      return metaSnapshot[key] as CatalogMeta<ErrorSpec>;
    },
    is(value: unknown, expectedKey?: string): boolean {
      if (!isInstanceOf(value, StructuredError)) return false;

      const actualKey = provenance.get(value);
      if (actualKey === undefined) return false;
      if (expectedKey !== undefined && actualKey !== expectedKey) {
        return false;
      }

      const spec = snapshot[actualKey];
      return (
        spec !== undefined &&
        value.code === codeByKey[actualKey] &&
        value.category === spec.category &&
        value.retryable === spec.retryable
      );
    },
    fromJSON(payload: unknown): AnyStructuredError | undefined {
      return rebuildFromJSON(payload, (fields) => {
        const key =
          fields.code === undefined ? undefined : keyByCode.get(fields.code);
        if (key === undefined) return undefined;
        const details = restoredDetails(
          snapshot[key]?.validateDetails,
          key,
          fields.details,
        );
        if (details === REJECTED_DETAILS) return undefined;
        const factory = factoryByKey[key] as RuntimeFactory;
        return factory(fields.message ?? UNKNOWN_ERROR_DEFAULTS.message, {
          ...(details !== undefined && { details }),
          ...(fields.cause !== undefined && { cause: fields.cause }),
        });
      });
    },
    match(
      error: StructuredError<string, string>,
      cases: Record<
        string,
        ((error: StructuredError<string, string>) => unknown) | undefined
      >,
    ): unknown {
      if (keyIsCatchAll) {
        throw new Error(
          'match: the key "_" of this catalog is also the catch-all; rename the key, or use matchErrorCode',
        );
      }
      const key = keyByCode.get(error.code);
      const handler =
        (key === undefined ? undefined : ownCase(cases, key)) ?? cases._;

      if (!handler) {
        throw new Error(
          key === undefined
            ? `match: error code "${error.code}" is not defined in this catalog, and no "_" catch-all`
            : `match: no case for key "${key}" of error code "${error.code}", and no "_" catch-all`,
        );
      }

      return handler(error);
    },
  }) as unknown as Catalog<ErrorCatalogDefinition>;
}
