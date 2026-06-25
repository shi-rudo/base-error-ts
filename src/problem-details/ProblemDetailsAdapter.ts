import type { PublicErrorView } from "../presentation/PublicErrorPresenter.js";
import type { JsonSafeValue } from "../utils/json-safe.js";
import { cloneJsonSafe, isPlainObject } from "../utils/json-safe.js";
import {
  isHttpStatusCode,
  isNonEmptyString,
  PROBLEM_DETAILS_JSON,
} from "../utils/problem-validation.js";

export { PROBLEM_DETAILS_JSON };

const RESERVED_PROBLEM_FIELDS = new Set([
  "type",
  "title",
  "status",
  "detail",
  "instance",
  "details",
]);

/** JSON-safe value accepted by problem-details extensions. */
export type ProblemDetailsJsonValue = JsonSafeValue;

/** Additional top-level members attached to a problem-details body. */
export type ProblemDetailsExtensions = Readonly<
  Record<string, ProblemDetailsJsonValue>
>;

/** Static RFC 9457 mapping for one public error code. */
export type ProblemDetailsDefinition = {
  readonly type: string;
  readonly status: number;
};

/** Finite public-code mapping accepted by the adapter. */
export type ProblemDetailsDefinitionMap = Readonly<
  Record<string, ProblemDetailsDefinition>
>;

type InvalidProblemDefinition<
  TDefinitions extends ProblemDetailsDefinitionMap,
> = {
  [K in keyof TDefinitions]: Exclude<
    keyof TDefinitions[K],
    keyof ProblemDetailsDefinition
  > extends never
    ? never
    : K;
}[keyof TDefinitions];

type ValidProblemDefinitions<TDefinitions extends ProblemDetailsDefinitionMap> =
  [keyof TDefinitions] extends [never]
    ? never
    : string extends keyof TDefinitions
      ? never
      : "" extends keyof TDefinitions
        ? never
        : Exclude<keyof TDefinitions, string> extends never
          ? InvalidProblemDefinition<TDefinitions> extends never
            ? unknown
            : never
          : never;

type ProblemDetailsValidationArgs<
  TDefinitions extends ProblemDetailsDefinitionMap,
  TFallback extends ProblemDetailsDefinition,
> = [ValidProblemDefinitions<TDefinitions>] extends [never]
  ? [invalidConfig: never]
  : Exclude<keyof TFallback, keyof ProblemDetailsDefinition> extends never
    ? []
    : [invalidConfig: never];

/** Configuration for {@link defineProblemDetailsAdapter}. */
export type ProblemDetailsAdapterConfig<
  TDefinitions extends ProblemDetailsDefinitionMap,
  TFallback extends ProblemDetailsDefinition = ProblemDetailsDefinition,
> = {
  readonly definitions: TDefinitions;
  readonly fallback: TFallback;
};

type JsonSafeExtensionShape<TExtensions extends object> = {
  readonly [K in keyof TExtensions]: Pick<TExtensions, K> extends Required<
    Pick<TExtensions, K>
  >
    ? TExtensions[K] extends ProblemDetailsJsonValue
      ? TExtensions[K]
      : never
    : Exclude<TExtensions[K], undefined> extends ProblemDetailsJsonValue
      ? TExtensions[K]
      : never;
};

type StringKeyedExtensionShape<TExtensions extends object> =
  Exclude<keyof TExtensions, string> extends never ? unknown : never;

/** Per-occurrence values added while mapping one public view. */
export type ProblemDetailsContext<
  TExtensions extends object = ProblemDetailsExtensions,
> = {
  readonly instance?: string;
  readonly detail?: string;
  readonly extensions?: TExtensions &
    JsonSafeExtensionShape<TExtensions> &
    StringKeyedExtensionShape<TExtensions> & {
      readonly type?: never;
      readonly title?: never;
      readonly status?: never;
      readonly detail?: never;
      readonly instance?: never;
      readonly details?: never;
    };
};

type DetailsMember<TDetails> = [TDetails] extends [never]
  ? { readonly details?: never }
  : { readonly details?: TDetails };

/** RFC 9457 JSON body plus safe package and application extensions. */
export type ProblemDetails<
  TDetails = never,
  TExtensions extends object = Record<never, never>,
  TStatus extends number = number,
  TType extends string = string,
> = {
  readonly type: TType;
  readonly title: string;
  readonly status: TStatus;
  readonly detail?: string;
  readonly instance?: string;
} & DetailsMember<TDetails> &
  Readonly<Partial<TExtensions>>;

/** Mapping diagnostics retained outside the serialized body. */
export type ProblemDetailsOutcome = {
  readonly mapping: "definition" | "fallback";
  readonly publicCode: string;
  readonly omitted: readonly ("details" | "extensions")[];
};

/** Framework-neutral status, headers, body and diagnostics. */
export type ProblemDetailsResult<
  TDetails = never,
  TExtensions extends object = Record<never, never>,
  TStatus extends number = number,
  TType extends string = string,
> = {
  readonly status: TStatus;
  readonly headers: Readonly<{
    "content-type": typeof PROBLEM_DETAILS_JSON;
    "content-language": string;
  }>;
  readonly body: ProblemDetails<TDetails, TExtensions, TStatus, TType>;
  readonly outcome: ProblemDetailsOutcome;
};

/** RFC 9457 mapper produced by {@link defineProblemDetailsAdapter}. */
export type ProblemDetailsAdapter<
  TDefinitions extends ProblemDetailsDefinitionMap,
  TFallback extends ProblemDetailsDefinition,
> = {
  readonly definitions: TDefinitions;
  readonly fallback: TFallback;
  map<
    TDetails = never,
    TCode extends string = string,
    const TExtensions extends object = Record<never, never>,
  >(
    view: PublicErrorView<TDetails, TCode>,
    context?: ProblemDetailsContext<TExtensions>,
  ): ProblemDetailsResult<
    TDetails,
    TExtensions,
    ProblemStatusFor<TDefinitions, TFallback, TCode>,
    ProblemTypeFor<TDefinitions, TFallback, TCode>
  >;
};

type ProblemDefinitionFor<
  TDefinitions extends ProblemDetailsDefinitionMap,
  TFallback extends ProblemDetailsDefinition,
  TCode extends string,
> = string extends TCode
  ? TDefinitions[keyof TDefinitions] | TFallback
  : TCode extends keyof TDefinitions
    ? TDefinitions[TCode]
    : TFallback;

type ProblemStatusFor<
  TDefinitions extends ProblemDetailsDefinitionMap,
  TFallback extends ProblemDetailsDefinition,
  TCode extends string,
> = ProblemDefinitionFor<TDefinitions, TFallback, TCode>["status"];

type ProblemTypeFor<
  TDefinitions extends ProblemDetailsDefinitionMap,
  TFallback extends ProblemDetailsDefinition,
  TCode extends string,
> = ProblemDefinitionFor<TDefinitions, TFallback, TCode>["type"];

function hasOwn(value: object, key: PropertyKey): boolean {
  return Object.prototype.hasOwnProperty.call(value, key);
}

function assertExactFields(
  value: Record<string, unknown>,
  allowed: ReadonlySet<string>,
  label: string,
  owner = "defineProblemDetailsAdapter",
): void {
  for (const key of Reflect.ownKeys(value)) {
    if (typeof key !== "string" || !allowed.has(key)) {
      throw new Error(`${owner}: unknown ${label} field "${String(key)}"`);
    }
  }
}

function assertDefinition(value: unknown, label: string): void {
  if (!isPlainObject(value)) {
    throw new Error(`defineProblemDetailsAdapter: invalid ${label}`);
  }
  assertExactFields(value, new Set(["type", "status"]), label);
  if (!hasOwn(value, "type") || !isNonEmptyString(value.type)) {
    throw new Error(`defineProblemDetailsAdapter: invalid ${label} type`);
  }
  if (!hasOwn(value, "status") || !isHttpStatusCode(value.status)) {
    throw new Error(`defineProblemDetailsAdapter: invalid ${label} status`);
  }
}

/** Define a framework-neutral RFC 9457 adapter for public error views. */
export function defineProblemDetailsAdapter<
  const TDefinitions extends ProblemDetailsDefinitionMap,
  const TFallback extends ProblemDetailsDefinition,
>(
  config: ProblemDetailsAdapterConfig<TDefinitions, TFallback>,
  ..._validation: ProblemDetailsValidationArgs<TDefinitions, TFallback>
): ProblemDetailsAdapter<TDefinitions, TFallback>;
export function defineProblemDetailsAdapter(
  config: ProblemDetailsAdapterConfig<
    ProblemDetailsDefinitionMap,
    ProblemDetailsDefinition
  >,
): ProblemDetailsAdapter<
  ProblemDetailsDefinitionMap,
  ProblemDetailsDefinition
> {
  if (!isPlainObject(config)) {
    throw new Error(
      "defineProblemDetailsAdapter: config must be a plain object",
    );
  }
  assertExactFields(config, new Set(["definitions", "fallback"]), "config");
  if (!hasOwn(config, "definitions") || !hasOwn(config, "fallback")) {
    throw new Error("defineProblemDetailsAdapter: invalid config");
  }
  if (!isPlainObject(config.definitions)) {
    throw new Error(
      "defineProblemDetailsAdapter: definitions must be a plain object",
    );
  }
  const definitionKeys = Reflect.ownKeys(config.definitions);
  if (definitionKeys.some((code) => typeof code !== "string")) {
    throw new Error(
      "defineProblemDetailsAdapter: definition codes must be strings",
    );
  }
  if (definitionKeys.includes("")) {
    throw new Error(
      "defineProblemDetailsAdapter: definition codes must not be empty",
    );
  }
  const codes = Object.keys(config.definitions);
  if (codes.length === 0) {
    throw new Error(
      "defineProblemDetailsAdapter: definitions must not be empty",
    );
  }
  if (codes.length !== definitionKeys.length) {
    throw new Error(
      "defineProblemDetailsAdapter: definition codes must be enumerable",
    );
  }
  for (const code of codes) {
    assertDefinition(config.definitions[code], `definition "${code}"`);
  }
  assertDefinition(config.fallback, "fallback");
  const definitionSnapshot = Object.create(null) as Record<
    string,
    ProblemDetailsDefinition
  >;
  for (const code of codes) {
    const definition = config.definitions[code] as ProblemDetailsDefinition;
    definitionSnapshot[code] = Object.freeze({
      type: definition.type,
      status: definition.status,
    });
  }
  const definitions = Object.freeze(definitionSnapshot);
  const fallback = Object.freeze({
    type: config.fallback.type,
    status: config.fallback.status,
  });

  const adapter: ProblemDetailsAdapter<
    ProblemDetailsDefinitionMap,
    ProblemDetailsDefinition
  > = {
    definitions,
    fallback,
    map<
      TDetails = never,
      TCode extends string = string,
      const TExtensions extends object = Record<never, never>,
    >(
      view: PublicErrorView<TDetails, TCode>,
      context?: ProblemDetailsContext<TExtensions>,
    ) {
      let code: string;
      let message: string;
      let locale: string;
      let rawDetails: unknown;
      try {
        if (typeof view !== "object" || view === null || Array.isArray(view)) {
          throw new Error("invalid");
        }
        if (
          !hasOwn(view, "code") ||
          !hasOwn(view, "message") ||
          !hasOwn(view, "locale")
        ) {
          throw new Error("invalid");
        }
        code = view.code;
        message = view.message;
        locale = view.locale;
        rawDetails = hasOwn(view, "details") ? view.details : undefined;
      } catch {
        throw new Error("ProblemDetailsAdapter.map: invalid public view");
      }
      if (
        typeof code !== "string" ||
        typeof message !== "string" ||
        typeof locale !== "string"
      ) {
        throw new Error("ProblemDetailsAdapter.map: invalid public view");
      }
      let detail: string | undefined;
      let instance: string | undefined;
      let rawExtensions: unknown;
      if (context !== undefined) {
        if (!isPlainObject(context)) {
          throw new Error("ProblemDetailsAdapter.map: invalid context");
        }
        assertExactFields(
          context,
          new Set(["instance", "detail", "extensions"]),
          "context",
          "ProblemDetailsAdapter.map",
        );
        detail = hasOwn(context, "detail") ? context.detail : undefined;
        instance = hasOwn(context, "instance") ? context.instance : undefined;
        rawExtensions = hasOwn(context, "extensions")
          ? context.extensions
          : undefined;
        if (detail !== undefined && typeof detail !== "string") {
          throw new Error("ProblemDetailsAdapter.map: invalid detail");
        }
        if (instance !== undefined && typeof instance !== "string") {
          throw new Error("ProblemDetailsAdapter.map: invalid instance");
        }
      }
      const mapped = Object.prototype.hasOwnProperty.call(definitions, code);
      const definition = mapped
        ? (definitions[code] as ProblemDetailsDefinition)
        : fallback;
      const omitted: ("details" | "extensions")[] = [];
      let details: ProblemDetailsJsonValue | undefined;
      if (rawDetails !== undefined) {
        try {
          details = cloneJsonSafe(rawDetails);
        } catch {
          omitted.push("details");
        }
      }
      let extensions: ProblemDetailsExtensions | undefined;
      if (rawExtensions !== undefined) {
        try {
          if (
            !isPlainObject(rawExtensions) ||
            Reflect.ownKeys(rawExtensions).some(
              (key) =>
                typeof key !== "string" || RESERVED_PROBLEM_FIELDS.has(key),
            )
          ) {
            throw new Error("invalid problem details extensions");
          }
          const extensionSnapshot = cloneJsonSafe(
            rawExtensions,
          ) as ProblemDetailsExtensions;
          if (
            Reflect.ownKeys(extensionSnapshot).some(
              (key) =>
                typeof key !== "string" || RESERVED_PROBLEM_FIELDS.has(key),
            )
          ) {
            throw new Error("invalid problem details extensions");
          }
          extensions = extensionSnapshot;
        } catch {
          omitted.push("extensions");
        }
      }
      const body = Object.freeze(
        Object.assign(Object.create(null) as Record<string, unknown>, {
          ...extensions,
          type: definition.type,
          title: message,
          status: definition.status,
          ...(detail !== undefined && { detail }),
          ...(instance !== undefined && { instance }),
          ...(details !== undefined && { details }),
        }),
      );
      const headers = Object.freeze({
        "content-type": PROBLEM_DETAILS_JSON,
        "content-language": locale,
      });
      const outcome = Object.freeze({
        mapping: mapped ? ("definition" as const) : ("fallback" as const),
        publicCode: code,
        omitted: Object.freeze(omitted),
      });

      return Object.freeze({
        status: definition.status,
        headers,
        body,
        outcome,
      }) as unknown as ProblemDetailsResult<
        TDetails,
        TExtensions,
        ProblemStatusFor<
          ProblemDetailsDefinitionMap,
          ProblemDetailsDefinition,
          TCode
        >,
        ProblemTypeFor<
          ProblemDetailsDefinitionMap,
          ProblemDetailsDefinition,
          TCode
        >
      >;
    },
  };

  return Object.freeze(adapter);
}
