import {
  BaseError,
  DEFAULT_PUBLIC_ERROR_CATEGORY,
  DEFAULT_PUBLIC_ERROR_CODE,
} from "./BaseError.js";
import type { PublicErrorJSON, PublicErrorOptions } from "./BaseError.js";
import type { ErrorOptions } from "./ErrorOptions.js";
import { UNKNOWN_ERROR_DEFAULTS } from "./defaults.js";
import type {
  ProblemDetails,
  ProblemDetailsOptions,
} from "../response/ProblemDetails.js";
import type { ErrorResponse, LocalizedMessage } from "../response/types.js";

/**
 * A structured error class that extends BaseError with enhanced error metadata.
 *
 * StructuredError provides a standardized way to create errors with:
 * - Error codes for programmatic error handling
 * - Categories for grouping related errors
 * - Retryability flags for automatic retry logic
 * - Structured details for additional context
 *
 * All BaseError features are preserved, including timestamps, user messages,
 * cause chains, log serialization, and safe public serialization.
 *
 * @example
 * ```ts
 * // Basic usage with type inference
 * const error = new StructuredError({
 *   code: "USER_NOT_FOUND",
 *   category: "NOT_FOUND",
 *   retryable: false,
 *   message: "User with id 123 not found",
 *   details: { userId: "123" }
 * });
 *
 * // Error handling
 * if (error.code === "USER_NOT_FOUND") {
 *   console.log("User does not exist");
 * }
 *
 * // With user-friendly messages
 * error.withUserMessage("The requested user could not be found.");
 * ```
 *
 * @example
 * ```ts
 * // Creating a domain-specific error class
 * type DatabaseErrorCode = "CONNECTION_FAILED" | "QUERY_TIMEOUT" | "DEADLOCK";
 * type DatabaseErrorCategory = "CONNECTION" | "EXECUTION" | "CONCURRENCY";
 *
 * interface DatabaseErrorDetails {
 *   query?: string;
 *   duration?: number;
 *   connectionId?: string;
 * }
 *
 * class DatabaseError extends StructuredError<
 *   DatabaseErrorCode,
 *   DatabaseErrorCategory,
 *   DatabaseErrorDetails
 * > {
 *   constructor(
 *     code: DatabaseErrorCode,
 *     message: string,
 *     details?: DatabaseErrorDetails,
 *     cause?: unknown
 *   ) {
 *     super({
 *       code,
 *       category: code === "CONNECTION_FAILED" ? "CONNECTION" :
 *                code === "QUERY_TIMEOUT" ? "EXECUTION" : "CONCURRENCY",
 *       retryable: code !== "DEADLOCK",
 *       message,
 *       details,
 *       cause,
 *     });
 *   }
 * }
 * ```
 */
export class StructuredError<
  TCode extends string,
  TCategory extends string,
  // Using Record<string, {}> as default for better compatibility with strict frameworks
  // eslint-disable-next-line @typescript-eslint/no-empty-object-type
  TDetails extends Record<string, unknown> = Record<string, {}>,
  TPublicCode extends string = string,
> extends BaseError<`${TCode}`, TPublicCode> {
  /**
   * Stable discriminant for the StructuredError family. Fixed as a literal so it
   * survives class-name minification. Narrow on {@link code} to distinguish
   * individual structured errors; subclasses that need their own tag override
   * this with their own literal.
   */
  public override readonly _tag: string = "StructuredError";

  /** Error code for programmatic error handling */
  public readonly code: TCode;

  /** Error category for grouping related errors */
  public readonly category: TCategory;

  /** Whether this error is retryable */
  public readonly retryable: boolean;

  /** Optional structured details providing additional context */
  public readonly details?: TDetails;

  /**
   * Creates a new StructuredError with typed metadata.
   *
   * @param options - Configuration object containing all error metadata
   */
  public /*#__PURE__*/ constructor(
    options: ErrorOptions<TCode, TCategory, TDetails, TPublicCode>,
  ) {
    super(options.message, options.cause, {
      name: options.code,
      publicCode: options.publicCode,
      publicMessage: options.publicMessage,
      expose: options.expose,
    });

    this.code = options.code;
    this.category = options.category;
    this.retryable = options.retryable;
    this.details = options.details;
  }

  /**
   * Reconstruct a StructuredError from its serialized (`toJSON`/`toLogObject`)
   * shape. This is the inverse of {@link toJSON}.
   *
   * Intended for reconstruction **within a single trust/bounded-context
   * boundary**: Web Worker / `postMessage` (where `instanceof` is lost across
   * `structuredClone`), job queues / durable storage, and log replay. Across
   * services, reconstruct then translate through an Anti-Corruption Layer; do
   * not treat an upstream's `code` as your own.
   *
   * Lenient and safe: missing fields fall back to safe defaults
   * (`UNKNOWN_ERROR`/`INTERNAL`/non-retryable); malformed input yields that
   * envelope instead of throwing; only whitelisted fields are read (no
   * prototype pollution). The original `stack`/`timestamp`, the cause chain, and
   * user/localized messages are restored. Reconstructed fields are **not** an
   * authority on trust: whoever produced the payload can forge them.
   *
   * Always returns a base `StructuredError`: subclass identity and behavior are
   * **not** restored (a `ValidationError` round-trips to a `StructuredError`,
   * losing `publicIssues()`/`addIssue()`; its raw `details.issues` survive as
   * data). Likewise `publicCode`/`publicMessage` are not part of the log shape,
   * so they are not reconstructed. Narrow on `code`, not on `_tag`/instanceof.
   */
  public static fromJSON(json: unknown): StructuredError<string, string> {
    return StructuredError.#fromJSON(json, 0);
  }

  static readonly #MAX_DEPTH = 100;

  static #fromJSON(
    json: unknown,
    depth: number,
  ): StructuredError<string, string> {
    const obj: Record<string, unknown> =
      typeof json === "object" && json !== null
        ? (json as Record<string, unknown>)
        : {};

    const code =
      typeof obj.code === "string" ? obj.code : UNKNOWN_ERROR_DEFAULTS.code;
    const category =
      typeof obj.category === "string"
        ? obj.category
        : UNKNOWN_ERROR_DEFAULTS.category;
    const retryable =
      typeof obj.retryable === "boolean"
        ? obj.retryable
        : UNKNOWN_ERROR_DEFAULTS.retryable;
    const message =
      typeof obj.message === "string"
        ? obj.message
        : UNKNOWN_ERROR_DEFAULTS.message;
    const details =
      typeof obj.details === "object" && obj.details !== null
        ? (obj.details as Record<string, unknown>)
        : undefined;
    const cause = StructuredError.#reconstructCause(obj.cause, depth);

    const error = new StructuredError({
      code,
      category,
      retryable,
      message,
      ...(details !== undefined && { details }),
      ...(cause !== undefined && { cause }),
    });

    // Restore the author-provided messages the log shape carried.
    if (typeof obj.userMessage === "string") {
      error.withUserMessage(obj.userMessage);
    }
    if (
      obj.localizedMessages !== null &&
      typeof obj.localizedMessages === "object" &&
      !Array.isArray(obj.localizedMessages)
    ) {
      for (const [lang, msg] of Object.entries(obj.localizedMessages)) {
        if (typeof msg === "string") {
          error.updateLocalizedMessage(lang, msg);
        }
      }
    }

    // Rehydrate the original identity rather than the freshly generated values.
    StructuredError.#rehydrate(error, "stack", obj.stack, "string");
    StructuredError.#rehydrate(error, "timestamp", obj.timestamp, "number");
    StructuredError.#rehydrate(
      error,
      "timestampIso",
      obj.timestampIso,
      "string",
    );

    return error as StructuredError<string, string>;
  }

  static #rehydrate(
    target: object,
    key: string,
    value: unknown,
    type: "string" | "number",
  ): void {
    if (typeof value === type) {
      Object.defineProperty(target, key, {
        value,
        configurable: true,
        writable: true,
        enumerable: key !== "stack",
      });
    }
  }

  static #reconstructCause(value: unknown, depth: number): unknown {
    if (depth >= StructuredError.#MAX_DEPTH) {
      return undefined;
    }
    if (typeof value !== "object" || value === null) {
      // Primitives (and null) are kept verbatim.
      return value;
    }

    const obj = value as Record<string, unknown>;

    // Structured shape -> nested StructuredError.
    if (
      typeof obj.code === "string" &&
      typeof obj.category === "string" &&
      typeof obj.retryable === "boolean"
    ) {
      return StructuredError.#fromJSON(obj, depth + 1);
    }

    // Plain error shape -> a basic Error, chained.
    if (typeof obj.message === "string") {
      const err = new Error(obj.message);
      if (typeof obj.name === "string") {
        err.name = obj.name;
      }
      if (typeof obj.stack === "string") {
        err.stack = obj.stack;
      }
      const nested = StructuredError.#reconstructCause(obj.cause, depth + 1);
      if (nested !== undefined) {
        (err as unknown as { cause: unknown }).cause = nested;
      }
      return err;
    }

    // Any other object: opaque data, kept as-is.
    return value;
  }

  /**
   * Extends BaseError's raw log object with code, category, retryable, and
   * details. Redaction (if configured) is applied by the inherited
   * {@link toLogObject} to the complete assembled object.
   */
  protected override buildLogObject(): Record<string, unknown> {
    const baseJson = super.buildLogObject();

    return {
      ...baseJson,
      code: this.code,
      category: this.category,
      retryable: this.retryable,
      ...(this.details !== undefined && { details: this.details }),
    };
  }

  public override toPublicJSON(
    options: PublicErrorOptions = {},
  ): PublicErrorJSON & { retryable: boolean } {
    return {
      ...super.toPublicJSON(options),
      retryable: this.retryable,
    };
  }

  /**
   * Converts the error to an RFC 9457 Problem Details object.
   *
   * This method provides a standardized format for HTTP API error responses.
   * It is safe by default: technical messages, categories, causes, stacks and
   * raw `details` are never exposed. Surface public extension members through an
   * explicit `mapDetails` projection or literal `extensions`; raw details belong
   * in observability output (`toLogObject()`), not in client responses.
   *
   * @param options - Optional configuration for the Problem Details response
   * @returns A ProblemDetails object ready for HTTP response serialization
   *
   * @example
   * ```ts
   * const error = new StructuredError({
   *   code: "USER_NOT_FOUND",
   *   category: "NOT_FOUND",
   *   retryable: false,
   *   message: "User with id 123 not found",
   *   details: { userId: "123" }
   * });
   *
   * // Basic conversion
   * const problem = error.toProblemDetails({ status: 404 });
   * // {
   * //   status: 404,
   * //   detail: "An unexpected error occurred.",
   * //   code: "INTERNAL_ERROR",
   * //   retryable: false,
   * // }
   *
   * // With full RFC 9457 fields
   * const problem = error.toProblemDetails({
   *   status: 404,
   *   type: "https://api.example.com/errors/user-not-found",
   *   title: "User Not Found",
   *   instance: "/users/123",
   *   traceId: "trace-abc-123"
   * });
   * ```
   */
  public toProblemDetails<
    TExtensions extends Record<string, unknown> = Record<string, never>,
    TMappedExtensions extends Record<string, unknown> = Record<string, never>,
  >(
    options: ProblemDetailsOptions<
      TDetails,
      TExtensions,
      TMappedExtensions
    > = {},
  ): ProblemDetails<
    TCode | TPublicCode | typeof DEFAULT_PUBLIC_ERROR_CODE,
    TCategory,
    TMappedExtensions & TExtensions
  > {
    const {
      status,
      type,
      title,
      instance,
      traceId,
      publicCode,
      publicCategory,
      detail,
      locale,
      fallbackLocale,
      extensions,
      mapDetails,
    } = options;
    const expose = options.expose ?? this.shouldExposeToClients();
    const publicJson = this.toPublicJSON({
      code: publicCode,
      message: detail,
      expose,
      traceId,
      locale,
      fallbackLocale,
    });

    // Library-owned members, computed through the safe public projection so the
    // technical message/category never leak unless explicitly projected.
    const standardMembers = {
      ...(type !== undefined && { type }),
      ...(title !== undefined && { title }),
      ...(status !== undefined && { status }),
      detail: publicJson.message,
      ...(instance !== undefined && { instance }),
      code: publicJson.code,
      ...(publicCategory !== undefined
        ? { category: publicCategory }
        : expose
          ? { category: this.category }
          : {}),
      retryable: this.retryable,
      ...(traceId !== undefined && { traceId }),
    };

    // Extension members are always an explicit projection chosen by the
    // boundary layer; raw details never cross implicitly. mapDetails runs only
    // when details exist, so the callback never sees `undefined`.
    const extensionMembers = {
      ...(mapDetails && this.details !== undefined
        ? mapDetails(this.details)
        : undefined),
      ...extensions,
    };

    // Safe and invariant: library/standard members always win on collisions.
    return {
      ...extensionMembers,
      ...standardMembers,
    } as ProblemDetails<
      TCode | TPublicCode | typeof DEFAULT_PUBLIC_ERROR_CODE,
      TCategory,
      TMappedExtensions & TExtensions
    >;
  }

  /**
   * Converts the error to an ErrorResponse object for API responses.
   *
   * This method provides a standardized format for RPC and HTTP error responses.
   * It is safe by default and uses public code/message mappings when provided.
   *
   * @param options - Configuration for the error response
   * @returns An ErrorResponse object ready for API response serialization
   *
   * @example
   * ```ts
   * const error = new StructuredError({
   *   code: "USER_NOT_FOUND",
   *   category: "NOT_FOUND",
   *   retryable: false,
   *   message: "User with id 123 not found",
   *   details: { userId: "123" }
   * });
   *
   * const response = error.toErrorResponse({
   *   httpStatusCode: 404,
   *   messageLocalized: { locale: "en", message: "User not found" },
   *   traceId: "trace-abc-123"
   * });
   * ```
   */
  public toErrorResponse<
    TMappedDetails extends Record<string, unknown> = Record<string, never>,
  >(
    options: {
      /** HTTP status code */
      httpStatusCode?: number;
      /**
       * Localized message for client display. Usually omit this: when `locale`
       * (or `fallbackLocale`) resolves an author-provided localized message, it
       * is auto-populated and tagged with the locale that actually matched, so
       * `ctx.message` and `ctx.messageLocalized` agree by construction. Set it
       * explicitly only to inject a localized string from outside the error's
       * own locale entries. An explicit value overrides the resolved one.
       */
      messageLocalized?: LocalizedMessage;
      /** Trace ID for distributed tracing */
      traceId?: string;
      /** Per-call public error code override */
      publicCode?: string;
      /** Per-call public category override */
      publicCategory?: string;
      /** Per-call public message override */
      message?: string;
      /**
       * Preferred locale for the public message. When set and a matching
       * localized message exists, it is used. An explicit `message` still wins.
       */
      locale?: string;
      /** Fallback locale used when the preferred locale has no message. */
      fallbackLocale?: string;
      /** Per-call exposure override */
      expose?: boolean;
      /**
       * Maps raw StructuredError.details to public `details` members. This is the
       * only way to surface details in a client response: every exposure is an
       * explicit, reviewable projection. Raw details belong in observability
       * output (`toLogObject()`), not here.
       */
      mapDetails?: (details: TDetails) => TMappedDetails;
    } = {},
  ): ErrorResponse<
    TCode | TPublicCode | typeof DEFAULT_PUBLIC_ERROR_CODE | string,
    TCategory | typeof DEFAULT_PUBLIC_ERROR_CATEGORY | string,
    {
      httpStatusCode?: number;
      message: string;
      messageLocalized?: LocalizedMessage;
    },
    TMappedDetails
  > {
    const {
      httpStatusCode,
      messageLocalized,
      traceId,
      publicCode,
      publicCategory,
      message,
      locale,
      fallbackLocale,
      mapDetails,
    } = options;
    const expose = options.expose ?? this.shouldExposeToClients();
    const publicJson = this.toPublicJSON({
      code: publicCode,
      message,
      expose,
      traceId,
      locale,
      fallbackLocale,
    });
    // Single source of truth: derive the locale-tagged message from the same
    // resolution `toPublicJSON` used for `ctx.message`, so the two never
    // diverge. An explicit `messageLocalized` wins, for strings sourced outside
    // the error's own locale entries.
    const resolvedLocalized =
      messageLocalized ?? this.resolveLocalizedMessage(locale, fallbackLocale);

    return {
      isSuccess: false,
      error: {
        code: publicJson.code,
        category:
          publicCategory ??
          (expose ? this.category : DEFAULT_PUBLIC_ERROR_CATEGORY),
        retryable: this.retryable,
        ...(traceId !== undefined && { traceId }),
        ctx: {
          ...(httpStatusCode !== undefined && { httpStatusCode }),
          message: publicJson.message,
          ...(resolvedLocalized !== undefined && {
            messageLocalized: resolvedLocalized,
          }),
        },
        details: (mapDetails && this.details !== undefined
          ? mapDetails(this.details)
          : {}) as TMappedDetails,
      },
    };
  }
}
