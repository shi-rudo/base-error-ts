import { cloneJsonSafe } from "../errors/json-safe.js";
import { readProperty } from "../errors/guarded-read.js";
import type { JsonSafeValue } from "../errors/json-safe.js";
import {
  isHttpStatusCode,
  isNonEmptyString,
  isRetryAfterSeconds,
  PROBLEM_DETAILS_JSON,
} from "../utils/problem-validation.js";
import { copyFieldFaults } from "./field-faults.js";
import { canonicalizeLocale } from "./locale.js";
import type { PublicErrorCatalog, Transport } from "./PublicErrorCatalog.js";
import type { FieldFault, LocalizedPublicError, PublicError } from "./types.js";

export { PROBLEM_DETAILS_JSON };

/** A dynamic body member dropped because it was not JSON-safe. */
export type OmittedMember = "details" | "fields" | "extensions";

/** A response header dropped because its value failed validation. */
export type OmittedHeader = "content-language";

/** Body members the adapter owns; an extension may not collide with them. */
const RESERVED_BODY_FIELDS = [
  "type",
  "title",
  "status",
  "detail",
  "instance",
  "code",
  "category",
  "retryable",
  "retryAfter",
  "fields",
  "details",
] as const;
type ReservedBodyField = (typeof RESERVED_BODY_FIELDS)[number];

/**
 * Keys an extension may never carry: every reserved body member, plus the
 * pollution-vector names that would otherwise serialize onto the body and revive
 * as `__proto__`/`constructor`/`prototype` own keys on a non-hardened downstream
 * `JSON.parse`. The body is null-prototype, so this is defense in depth.
 */
const FORBIDDEN_EXTENSION_KEYS: ReadonlySet<string> = new Set<string>([
  ...RESERVED_BODY_FIELDS,
  "__proto__",
  "constructor",
  "prototype",
]);

/** Every extension value must be JSON-safe; a non-JSON-safe field is `never`. */
type JsonSafeExtensionShape<TExtensions extends object> = {
  readonly [K in keyof TExtensions]: Pick<TExtensions, K> extends Required<
    Pick<TExtensions, K>
  >
    ? TExtensions[K] extends JsonSafeValue
      ? TExtensions[K]
      : never
    : Exclude<TExtensions[K], undefined> extends JsonSafeValue
      ? TExtensions[K]
      : never;
};

/** Extensions must be string-keyed (symbol/number keys are rejected). */
type StringKeyedExtensionShape<TExtensions extends object> =
  Exclude<keyof TExtensions, string> extends never ? unknown : never;

/**
 * Per-occurrence members added while mapping one view to a problem. `extensions`
 * are additional top-level body members; they are compile-time constrained to be
 * JSON-safe, string-keyed, and free of reserved field names, and re-validated at
 * runtime (a non-JSON-safe or colliding set drops to `outcome.omitted`).
 */
export type ToProblemContext<
  TExtensions extends object = Record<never, never>,
> = {
  /** RFC 9457 occurrence URI. */
  readonly instance?: string;
  /** RFC 9457 occurrence-specific explanation (distinct from the per-type title). */
  readonly detail?: string;
  /**
   * Retry delay in whole seconds, overriding the view's `retryAfter`. For a
   * boundary that knows the value (a rate limiter) rather than the error. A
   * non-integer/negative value is ignored.
   */
  readonly retryAfter?: number;
  /** Additional JSON-safe top-level body members, keyed by a non-reserved name. */
  readonly extensions?: TExtensions &
    JsonSafeExtensionShape<TExtensions> &
    StringKeyedExtensionShape<TExtensions> & {
      readonly [K in ReservedBodyField]?: never;
    };
};

/**
 * An RFC 9457 problem body. `type`/`title`/`status`/`detail`/`instance` are the
 * reserved members (`title` present only when a message was localized);
 * `code`/`category`/`retryable`/`fields`/`details` are documented extension
 * members the adapter writes by default. The body has a null prototype and is
 * deeply frozen, so it is safe to serialize and cannot carry prototype
 * pollution.
 */
export type ProblemDetails<
  TDetails = unknown,
  TCode extends string = string,
  TExtensions extends object = Record<never, never>,
> = {
  readonly type?: string;
  readonly title?: string;
  readonly status: number;
  readonly detail?: string;
  readonly instance?: string;
  readonly code: TCode;
  readonly category?: string;
  readonly retryable?: boolean;
  readonly retryAfter?: number;
  readonly fields?: readonly FieldFault[];
  readonly details?: TDetails;
} & Readonly<Partial<TExtensions>>;

/** Mapping diagnostics retained outside the serialized body. */
export type ProblemDetailsOutcome = {
  /** Dynamic members dropped because they were not JSON-safe. */
  readonly omitted: readonly OmittedMember[];
  /**
   * Headers dropped because their value failed validation. Present only when
   * a header was dropped, so an outcome built by hand stays valid.
   */
  readonly omittedHeaders?: readonly OmittedHeader[];
};

/** Framework-neutral status, headers, body, and diagnostics. */
export type ProblemDetailsResult<
  TDetails = unknown,
  TCode extends string = string,
  TExtensions extends object = Record<never, never>,
> = {
  readonly status: number;
  readonly headers: Readonly<{
    "content-type": typeof PROBLEM_DETAILS_JSON;
    "content-language"?: string;
    "retry-after"?: string;
  }>;
  readonly body: ProblemDetails<TDetails, TCode, TExtensions>;
  readonly outcome: ProblemDetailsOutcome;
};

/**
 * Stage 3: transport. Maps a (possibly localized) {@link PublicError} to an RFC
 * 9457 result. The transport `source` is either a {@link PublicErrorCatalog}
 * (looks up `status`/`type` by public code) or an explicit {@link Transport}
 * `{ status, type? }` for catalog-free use; the machine members ride from the
 * view. A `title` and a `content-language` header appear only when the view was
 * localized, so the structure-only path is a first-class, RFC-valid response.
 *
 * This is the wire boundary: `details` and `fields` are deep-cloned into a
 * frozen, JSON-safe structure (a `Date`, `BigInt`, circular reference, a value
 * nested deeper than 100 levels, or other non-serializable value drops that
 * member and records it in `outcome.omitted`
 * rather than throwing or leaking a value the next serializer would choke on).
 * `fields` then keeps exactly `{ field, code }` per fault. A `fields` value
 * that is not a list, or a fault without a string `field` and `code`, drops
 * the member the same way.
 */
export function toProblem<
  TDetails,
  TCode extends string = string,
  const TExtensions extends object = Record<never, never>,
>(
  source: PublicErrorCatalog | Transport,
  view: PublicError<TDetails, TCode> | LocalizedPublicError<TDetails, TCode>,
  context?: ToProblemContext<TExtensions>,
): ProblemDetailsResult<TDetails, TCode, TExtensions> {
  if (!isNonEmptyString(view.code)) {
    throw new Error("toProblem: view.code must be a non-empty string.");
  }
  const transport = isCatalog(source)
    ? transportOrThrow(source, view.code)
    : assertValidTransport(source);
  const localized = hasMessage(view) ? view : undefined;
  const omitted: OmittedMember[] = [];
  const omittedHeaders: OmittedHeader[] = [];
  const contentLanguage =
    localized !== undefined
      ? languageTagOrOmit(localized.locale, omittedHeaders)
      : undefined;

  // A localized end-user message wins; otherwise the static developer-facing
  // title. RFC 9457 title is optional, so a client-localizing app that sets
  // neither simply emits no title.
  const title = localized !== undefined ? localized.message : transport.title;

  // Each candidate is validated independently, so an invalid boundary override
  // falls back to the view's still-valid hint rather than dropping both.
  const retryAfter = isRetryAfterSeconds(context?.retryAfter)
    ? context.retryAfter
    : isRetryAfterSeconds(view.retryAfter)
      ? view.retryAfter
      : undefined;

  const details = jsonSafeOrOmit(view.details, "details", omitted);
  const fields = safeFields(view.fields, omitted);
  const extensions = safeExtensions(context?.extensions, omitted);

  const body = Object.freeze(
    Object.assign(Object.create(null) as Record<string, unknown>, {
      // Extensions first: the reserved members below always win a collision.
      ...extensions,
      ...(transport.type !== undefined && { type: transport.type }),
      // typeof guard, not `!== undefined`: a cast/JSON-revived non-string
      // descriptor or transport `title` must not reach the wire body, the same
      // wire-safety the detail/instance guards below enforce.
      ...(typeof title === "string" && { title }),
      status: transport.status,
      // The TS type already constrains these to strings; the runtime guard keeps
      // an untyped caller (an `as` cast, a value from JSON.parse) from writing a
      // non-string, non-RFC-9457 value straight onto the wire body.
      ...(typeof context?.detail === "string" && { detail: context.detail }),
      ...(typeof context?.instance === "string" && {
        instance: context.instance,
      }),
      code: view.code,
      ...(typeof view.category === "string" && { category: view.category }),
      ...(typeof view.retryable === "boolean" && { retryable: view.retryable }),
      ...(retryAfter !== undefined && { retryAfter }),
      ...(fields !== undefined && { fields }),
      ...(details !== undefined && { details }),
    }),
  ) as ProblemDetails<TDetails, TCode, TExtensions>;

  const headers = Object.freeze({
    "content-type": PROBLEM_DETAILS_JSON,
    ...(contentLanguage !== undefined && {
      "content-language": contentLanguage,
    }),
    ...(retryAfter !== undefined && { "retry-after": String(retryAfter) }),
  });

  const outcome: ProblemDetailsOutcome = Object.freeze({
    omitted: Object.freeze(omitted),
    ...(omittedHeaders.length > 0 && {
      omittedHeaders: Object.freeze(omittedHeaders),
    }),
  });

  return Object.freeze({ status: transport.status, headers, body, outcome });
}

function jsonSafeOrOmit(
  value: unknown,
  member: OmittedMember,
  omitted: OmittedMember[],
): unknown {
  if (value === undefined) return undefined;
  try {
    return cloneJsonSafe(value);
  } catch {
    omitted.push(member);
    return undefined;
  }
}

/**
 * The JSON-safe clone of `fields`, reduced to the closed fault shape. The
 * clone runs first, so its node budget bounds the shape check too. An empty
 * list is not a member, as in project().
 */
function safeFields(
  raw: unknown,
  omitted: OmittedMember[],
): readonly FieldFault[] | undefined {
  const clone = jsonSafeOrOmit(raw, "fields", omitted);
  if (clone === undefined) return undefined;
  const faults = copyFieldFaults(clone);
  if (faults === undefined) {
    omitted.push("fields");
    return undefined;
  }
  return faults.length > 0 ? faults : undefined;
}

/**
 * Validates and clones the explicit `extensions`: a plain object whose own keys
 * are all strings, none forbidden ({@link FORBIDDEN_EXTENSION_KEYS}), and whose
 * values are all JSON-safe. The whole set is dropped (recorded in
 * `outcome.omitted`) if any key collides or any value is not JSON-safe, so a bad
 * set never partially leaks onto the body. Keys are screened on the raw input
 * before the clone, so a `__proto__` own key (e.g. from `JSON.parse`) is rejected
 * rather than serialized; `cloneJsonSafe` only carries those screened string keys
 * through, so no second key check is needed.
 */
function safeExtensions(
  raw: unknown,
  omitted: OmittedMember[],
): Record<string, JsonSafeValue> | undefined {
  if (raw === undefined) return undefined;
  try {
    if (
      typeof raw !== "object" ||
      raw === null ||
      Array.isArray(raw) ||
      Reflect.ownKeys(raw).some(
        (key) => typeof key !== "string" || FORBIDDEN_EXTENSION_KEYS.has(key),
      )
    ) {
      throw new Error("invalid extensions");
    }
    return cloneJsonSafe(raw) as Record<string, JsonSafeValue>;
  } catch {
    omitted.push("extensions");
    return undefined;
  }
}

/**
 * The view's locale as a `content-language` value, or `undefined` when it is
 * not a language tag. Only `localize()` guarantees a canonical tag. A
 * hand-built view can carry any string, and the host rejects a header value
 * with a line break inside the error middleware.
 */
function languageTagOrOmit(
  locale: string,
  omittedHeaders: OmittedHeader[],
): string | undefined {
  if (canonicalizeLocale(locale) !== undefined) return locale;
  omittedHeaders.push("content-language");
  return undefined;
}

function hasMessage<TDetails, TCode extends string>(
  view: PublicError<TDetails, TCode> | LocalizedPublicError<TDetails, TCode>,
): view is LocalizedPublicError<TDetails, TCode> {
  const partial = view as Partial<LocalizedPublicError<TDetails, TCode>>;
  // Both are required: a message without a locale would emit
  // `content-language: undefined`, so a partial view stays unlocalized.
  return (
    typeof partial.message === "string" && typeof partial.locale === "string"
  );
}

/**
 * Tells a catalog from an explicit transport by shape: a catalog answers
 * `transportFor`, a transport is a plain `{ status, type?, title? }`. Not
 * `instanceof`, which is realm-bound and fails for a catalog built by a second
 * copy of this package (CJS next to ESM, two versions in one tree).
 */
function isCatalog(
  source: PublicErrorCatalog | Transport,
): source is PublicErrorCatalog {
  return typeof readProperty(source, "transportFor") === "function";
}

/**
 * Resolves the transport for a registered public code, or throws. A code the
 * catalog does not know is a foreign/stale view; emitting the fallback status
 * would pair the view's real code with a mismatched status, so the caller must
 * use an explicit transport instead.
 */
function transportOrThrow(
  catalog: PublicErrorCatalog,
  publicCode: string,
): Transport {
  const transport = catalog.transportFor(publicCode);
  if (transport === undefined) {
    throw new Error(
      `toProblem: public code "${publicCode}" is not registered in this catalog; pass an explicit transport for a foreign view.`,
    );
  }
  return transport;
}

/**
 * Validates an explicit (catalog-free) transport at the boundary, since it
 * bypasses the catalog's registration-time checks. Returns it unchanged on
 * success.
 */
function assertValidTransport(transport: Transport): Transport {
  if (!isHttpStatusCode(transport.status)) {
    throw new Error(
      `toProblem: invalid transport status; expected an integer in [100, 599], got ${String(transport.status)}.`,
    );
  }
  if (transport.type !== undefined && !isNonEmptyString(transport.type)) {
    throw new Error(
      "toProblem: invalid transport type; expected a non-empty string.",
    );
  }
  return transport;
}
