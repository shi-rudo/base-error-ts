import { cloneJsonSafe } from "../utils/json-safe.js";
import type { JsonSafeValue } from "../utils/json-safe.js";
import {
  isHttpStatusCode,
  isNonEmptyString,
  isRetryAfterSeconds,
  PROBLEM_DETAILS_JSON,
} from "../utils/problem-validation.js";
import { PublicErrorCatalog } from "./PublicErrorCatalog.js";
import type { Transport } from "./PublicErrorCatalog.js";
import type { FieldFault, LocalizedPublicError, PublicError } from "./types.js";

export { PROBLEM_DETAILS_JSON };

/** A dynamic body member dropped because it was not JSON-safe. */
export type OmittedMember = "details" | "fields" | "extensions";

/** Body members the adapter owns; an extension may not collide with them. */
const RESERVED_BODY_FIELDS = new Set([
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
      readonly type?: never;
      readonly title?: never;
      readonly status?: never;
      readonly detail?: never;
      readonly instance?: never;
      readonly code?: never;
      readonly category?: never;
      readonly retryable?: never;
      readonly retryAfter?: never;
      readonly fields?: never;
      readonly details?: never;
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
 * frozen, JSON-safe structure (a `Date`, `BigInt`, circular reference, or other
 * non-serializable value drops that member and records it in `outcome.omitted`
 * rather than throwing or leaking a value the next serializer would choke on).
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
  const transport =
    source instanceof PublicErrorCatalog
      ? transportOrThrow(source, view.code)
      : assertValidTransport(source);
  const localized = hasMessage(view) ? view : undefined;
  const omitted: OmittedMember[] = [];

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
  // Match project(): an empty fields array is not a member.
  const rawFields =
    view.fields !== undefined && view.fields.length > 0
      ? view.fields
      : undefined;
  const fields = jsonSafeOrOmit(rawFields, "fields", omitted);
  const extensions = safeExtensions(context?.extensions, omitted);

  const body = Object.freeze(
    Object.assign(Object.create(null) as Record<string, unknown>, {
      // Extensions first: the reserved members below always win a collision.
      ...extensions,
      ...(transport.type !== undefined && { type: transport.type }),
      ...(title !== undefined && { title }),
      status: transport.status,
      ...(context?.detail !== undefined && { detail: context.detail }),
      ...(context?.instance !== undefined && { instance: context.instance }),
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
    ...(localized !== undefined && { "content-language": localized.locale }),
    ...(retryAfter !== undefined && { "retry-after": String(retryAfter) }),
  });

  const outcome: ProblemDetailsOutcome = Object.freeze({
    omitted: Object.freeze(omitted),
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
 * Validates and clones the explicit `extensions`: a plain object with string
 * keys, none reserved, all JSON-safe. The whole set is dropped (recorded in
 * `outcome.omitted`) if any key collides or any value is not JSON-safe, so a
 * bad set never partially leaks onto the body.
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
        (key) => typeof key !== "string" || RESERVED_BODY_FIELDS.has(key),
      )
    ) {
      throw new Error("invalid extensions");
    }
    const cloned = cloneJsonSafe(raw) as Record<string, JsonSafeValue>;
    if (
      Reflect.ownKeys(cloned).some(
        (key) => typeof key !== "string" || RESERVED_BODY_FIELDS.has(key),
      )
    ) {
      throw new Error("invalid extensions");
    }
    return cloned;
  } catch {
    omitted.push("extensions");
    return undefined;
  }
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
