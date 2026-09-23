import { cloneJsonSafe, isPlainObject } from "../errors/json-safe.js";
import { readMember, readMemberResult } from "../errors/guarded-read.js";
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

/**
 * A dynamic body member that `toProblem` dropped at the wire: its value was
 * not JSON-safe, or `fields` was not a list of faults.
 */
export type OmittedMember = "details" | "fields" | "extensions";

/** A response header that `toProblem` dropped: its value failed validation. */
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
  /** Body members that failed the wire checks ({@link OmittedMember}). */
  readonly omitted: readonly OmittedMember[];
  /**
   * Headers that `toProblem` dropped because their value failed validation.
   * `toProblem` sets this property only when it drops a header, so an outcome
   * built by hand stays valid.
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
 * This is the wire boundary. `details` is deep-cloned into a frozen, JSON-safe
 * structure. For a value that is not JSON-safe, `toProblem` drops the member
 * and records it in `outcome.omitted`. It does not throw for such a value, and
 * the next serializer gets no value that it cannot handle. Examples are a
 * `Date`, a `BigInt`, a circular reference, and a value nested deeper than 100
 * levels. `fields` keeps exactly `{ field, code }` per fault. `toProblem` drops
 * it the same way when the value is not a list, or when a fault has no string
 * `field` and `code`.
 *
 * `toProblem` reads each member of the view, the context and the transport
 * once, and it lists the extension keys once. The value that passes a check is
 * the value that it writes. A getter that throws counts as an invalid value. It
 * validates a transport from a catalog like an explicit one.
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
  const code = readMember(view, "code");
  if (!isNonEmptyString(code)) {
    throw new Error("toProblem: view.code must be a non-empty string.");
  }
  const transportFor = readMember(source, "transportFor");
  const transport = validatedTransport(
    typeof transportFor === "function"
      ? registeredTransport(
          transportFor as (publicCode: string) => unknown,
          source,
          code,
        )
      : source,
  );
  const omitted: OmittedMember[] = [];
  const omittedHeaders: OmittedHeader[] = [];

  // Both are required: a message without a locale would emit
  // `content-language: undefined`, so a partial view stays unlocalized.
  const message = readMember(view, "message");
  const locale = readMember(view, "locale");
  const localized = typeof message === "string" && typeof locale === "string";
  const contentLanguage = localized
    ? languageTagOrOmit(locale, omittedHeaders)
    : undefined;

  // A localized end-user message wins; otherwise the static developer-facing
  // title. RFC 9457 title is optional, so a client-localizing app that sets
  // neither simply emits no title.
  const title = localized ? message : transport.title;

  // Each candidate is validated independently, so an invalid boundary override
  // falls back to the view's still-valid hint rather than dropping both.
  const contextRetryAfter = readMember(context, "retryAfter");
  const viewRetryAfter = readMember(view, "retryAfter");
  const retryAfter = isRetryAfterSeconds(contextRetryAfter)
    ? contextRetryAfter
    : isRetryAfterSeconds(viewRetryAfter)
      ? viewRetryAfter
      : undefined;

  const details = wireMember(view, "details", omitted, cloneJsonSafe);
  const fields = wireMember(view, "fields", omitted, fieldsForWire);
  const extensions = wireMember(
    context,
    "extensions",
    omitted,
    extensionsForWire,
  );
  const detail = readMember(context, "detail");
  const instance = readMember(context, "instance");
  const category = readMember(view, "category");
  const retryable = readMember(view, "retryable");

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
      ...(typeof detail === "string" && { detail }),
      ...(typeof instance === "string" && { instance }),
      code,
      ...(typeof category === "string" && { category }),
      ...(typeof retryable === "boolean" && { retryable }),
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

/**
 * One dynamic member on its way to the wire, read once. `toWire` returns the
 * wire value, `undefined` for no member, or throws for an invalid value. A
 * getter that throws and a value that `toWire` rejects both drop the member,
 * and `outcome.omitted` records it once.
 */
function wireMember<T>(
  holder: unknown,
  member: OmittedMember,
  omitted: OmittedMember[],
  toWire: (value: unknown) => T | undefined,
): T | undefined {
  const read = readMemberResult(holder, member);
  if (read.readable && read.value === undefined) return undefined;
  if (read.readable) {
    try {
      return toWire(read.value);
    } catch {
      // A rejected value is recorded like an unreadable one.
    }
  }
  omitted.push(member);
  return undefined;
}

/**
 * The closed-shape copy of `fields`. Only `field` and `code` reach the wire,
 * and both are strings, so the member needs no JSON-safe clone. Another key of
 * a fault cannot cost the list. An empty list is not a member, as in project().
 */
function fieldsForWire(value: unknown): readonly FieldFault[] | undefined {
  const faults = copyFieldFaults(value);
  if (faults === undefined) throw new Error("fields is not a list of faults");
  return faults.length > 0 ? faults : undefined;
}

/**
 * Validates and clones the explicit `extensions`: a plain object whose own keys
 * are all strings, none forbidden ({@link FORBIDDEN_EXTENSION_KEYS}), and whose
 * values are all JSON-safe. The whole set is dropped (recorded in
 * `outcome.omitted`) if any key collides or any value is not JSON-safe, so a bad
 * set never partially leaks onto the body. One listing of the own keys decides
 * both the check and the copy. A Proxy that lists other keys later cannot add a
 * forbidden key, such as a `__proto__` own key from `JSON.parse`, after the check.
 */
function extensionsForWire(value: unknown): Record<string, JsonSafeValue> {
  if (!isPlainObject(value)) throw new Error("invalid extensions");
  const checked = Object.create(null) as Record<string, unknown>;
  for (const key of Reflect.ownKeys(value)) {
    if (typeof key !== "string" || FORBIDDEN_EXTENSION_KEYS.has(key)) {
      throw new Error("invalid extensions");
    }
    if (Object.prototype.propertyIsEnumerable.call(value, key)) {
      checked[key] = value[key];
    }
  }
  return cloneJsonSafe(checked) as Record<string, JsonSafeValue>;
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

/**
 * The transport that a catalog registered for `publicCode`. A catalog is
 * recognized by shape, a callable `transportFor`, not by `instanceof`, which
 * fails for a catalog built by a second copy of this package. A code that the
 * catalog does not know is a foreign or stale view. The fallback status would
 * pair the view's code with a mismatched status, so the caller must pass an
 * explicit transport instead.
 */
function registeredTransport(
  transportFor: (publicCode: string) => unknown,
  catalog: unknown,
  publicCode: string,
): unknown {
  const transport: unknown = Reflect.apply(transportFor, catalog, [publicCode]);
  if (transport === undefined) {
    throw new Error(
      `toProblem: public code "${publicCode}" is not registered in this catalog; pass an explicit transport for a foreign view.`,
    );
  }
  return transport;
}

/**
 * Validates a transport at the boundary. An explicit transport bypasses the
 * registration-time checks of a catalog, and a catalog look-alike can return
 * anything. Returns a copy of the values that it checked, each read once. A
 * `type` getter that throws counts as an invalid `type`.
 */
function validatedTransport(transport: unknown): Transport {
  const status = readMember(transport, "status");
  if (!isHttpStatusCode(status)) {
    throw new Error(
      `toProblem: invalid transport status; expected an integer in [100, 599], got ${String(status)}.`,
    );
  }
  const typeRead = readMemberResult(transport, "type");
  const type = typeRead.readable ? typeRead.value : null;
  if (type !== undefined && !isNonEmptyString(type)) {
    throw new Error(
      "toProblem: invalid transport type; expected a non-empty string.",
    );
  }
  const title = readMember(transport, "title");
  return {
    status,
    ...(type !== undefined && { type }),
    ...(typeof title === "string" && { title }),
  };
}
