/**
 * RFC 9457 Problem Details for HTTP APIs with StructuredError extensions.
 *
 * This type provides a standardized format for error responses in HTTP APIs,
 * based on RFC 9457 (formerly RFC 7807) with additional fields for
 * programmatic error handling. Public serializers in this package use safe
 * codes and messages by default; expose technical fields only when intended.
 *
 * @see https://www.rfc-editor.org/rfc/rfc9457.html
 *
 * @template TCode - Union type of error codes (e.g., "USER_NOT_FOUND" | "VALIDATION_FAILED")
 * @template TCategory - Union type of error categories (e.g., "AUTH" | "VALIDATION")
 * @template TExtensions - Additional extension fields specific to your application
 *
 * @example
 * ```ts
 * // Basic usage
 * const problem: ProblemDetails = {
 *   type: "https://example.com/errors/user-not-found",
 *   title: "User Not Found",
 *   status: 404,
 *   detail: "User with id '123' was not found in the database",
 *   code: "USER_NOT_FOUND",
 *   category: "NOT_FOUND",
 *   retryable: false,
 * };
 * ```
 *
 * @example
 * ```ts
 * // With typed codes and extensions
 * type ApiErrorCode = "USER_NOT_FOUND" | "VALIDATION_FAILED";
 * type ApiCategory = "NOT_FOUND" | "VALIDATION";
 *
 * interface ApiExtensions {
 *   fieldErrors?: Record<string, string[]>;
 *   requestId?: string;
 * }
 *
 * const problem: ProblemDetails<ApiErrorCode, ApiCategory, ApiExtensions> = {
 *   type: "https://example.com/errors/validation-failed",
 *   title: "Validation Failed",
 *   status: 400,
 *   detail: "The request body contains invalid fields",
 *   code: "VALIDATION_FAILED",
 *   category: "VALIDATION",
 *   retryable: false,
 *   fieldErrors: {
 *     email: ["Invalid email format"],
 *     age: ["Must be a positive number"],
 *   },
 *   requestId: "req-abc-123",
 * };
 * ```
 *
 * @example
 * ```ts
 * // Converting from StructuredError
 * function toProblemDetails(
 *   error: StructuredError<string, string>,
 *   status: number,
 *   traceId?: string
 * ): ProblemDetails {
 *   return {
 *     type: `https://api.example.com/errors/${error.code.toLowerCase()}`,
 *     title: error.code.replace(/_/g, " ").toLowerCase(),
 *     status,
 *     detail: error.toPublicJSON({ traceId }).message,
 *     instance: traceId ? `/traces/${traceId}` : undefined,
 *     code: error.toPublicJSON().code,
 *     retryable: error.retryable,
 *     traceId,
 *   };
 * }
 * ```
 */

/**
 * Options for converting a StructuredError into Problem Details at an
 * interface/transport boundary.
 *
 * Safe by default: technical messages, categories, causes, stacks and raw
 * `details` are never exposed. Domain details can contain internal state, so
 * crossing the boundary is always an explicit projection: select and rename
 * fields through `mapDetails`, or provide literal public `extensions`. Raw
 * details belong in observability output (`toLogObject()`), not in client
 * responses.
 *
 * @template TDetails - Type of the originating error's structured details
 * @template TExtensions - Explicit public extension members
 * @template TMappedExtensions - Extension members produced by `mapDetails`
 */
export type ProblemDetailsOptions<
  TDetails extends Record<string, unknown> = Record<string, unknown>,
  TExtensions extends Record<string, unknown> = Record<string, never>,
  TMappedExtensions extends Record<string, unknown> = Record<string, never>,
> = {
  /** HTTP status code */
  status?: number;
  /** URI reference identifying the problem type */
  type?: string;
  /** Short, human-readable summary */
  title?: string;
  /**
   * Per-call public message/detail override. When omitted, a safe public
   * message is used; the technical message is only emitted when `expose` is set.
   */
  detail?: string;
  /** URI reference identifying this specific occurrence */
  instance?: string;
  /** Trace ID for distributed tracing */
  traceId?: string;
  /** Per-call public error code override */
  publicCode?: string;
  /**
   * Per-call public category override. Lets a boundary project a deliberate,
   * client-safe category. When omitted, the internal category is emitted only
   * if `expose` is set.
   */
  publicCategory?: string;
  /**
   * Preferred locale for the `detail` message. When set and a matching
   * localized message exists, it is used (these are author-provided, client-safe
   * strings). An explicit `detail` still wins.
   */
  locale?: string;
  /** Fallback locale used when the preferred locale has no message. */
  fallbackLocale?: string;
  /**
   * Per-call exposure override. When true, technical name/category/message may
   * appear in the output. Defaults to the error's own exposure setting.
   */
  expose?: boolean;
  /**
   * Explicit public extension members. Intended for transport-safe metadata
   * chosen by the boundary/presenter layer.
   */
  extensions?: TExtensions;
  /**
   * Maps raw StructuredError.details to public extension members. This is the
   * only way to surface details in a client response: every exposure is an
   * explicit, reviewable projection. Library/standard members always win on
   * key collisions.
   *
   * Invoked only when the error actually carries `details`, so the callback
   * receives a fully-populated `TDetails` and never has to guard against
   * `undefined`. Derive constant members from `extensions` instead.
   */
  mapDetails?: (details: TDetails) => TMappedExtensions;
};

export type ProblemDetails<
  TCode extends string = string,
  TCategory extends string = string,
  TExtensions extends Record<string, unknown> = Record<string, unknown>,
> = {
  // ────────────────────────────────────────────────────────────────
  // RFC 9457 Standard Members
  // ────────────────────────────────────────────────────────────────

  /**
   * A URI reference that identifies the problem type.
   * When dereferenced, it should provide human-readable documentation.
   *
   * @example "https://example.com/errors/insufficient-funds"
   */
  type?: string;

  /**
   * A short, human-readable summary of the problem type.
   * Should not change between occurrences of the same problem.
   *
   * @example "Insufficient Funds"
   */
  title?: string;

  /**
   * The HTTP status code for this occurrence of the problem.
   *
   * @example 400, 404, 500
   */
  status?: number;

  /**
   * A human-readable explanation specific to this occurrence of the problem.
   * Should focus on helping the client correct the problem.
   *
   * @example "Your account balance of $10.00 is insufficient for a $50.00 transaction"
   */
  detail?: string;

  /**
   * A URI reference that identifies the specific occurrence of the problem.
   * Useful for support tickets or log correlation.
   *
   * @example "/transactions/abc123", "/traces/req-xyz-789"
   */
  instance?: string;

  // ────────────────────────────────────────────────────────────────
  // StructuredError Extensions
  // ────────────────────────────────────────────────────────────────

  /**
   * Machine-readable public error code for programmatic handling.
   * Public serializers map internal StructuredError.code to this value.
   *
   * @example "USER_NOT_FOUND", "VALIDATION_FAILED", "DATABASE_TIMEOUT"
   */
  code: TCode;

  /**
   * Optional public error category for grouping related errors.
   * Omitted by default by public serializers to avoid leaking internals.
   *
   * @example "AUTH", "VALIDATION", "INFRASTRUCTURE"
   */
  category?: TCategory;

  /**
   * Whether the failed operation can be retried.
   *
   * @example true for transient errors, false for permanent errors
   */
  retryable: boolean;

  /**
   * Optional trace ID for distributed tracing and log correlation.
   *
   * @example "trace-abc-123", "req-xyz-789"
   */
  traceId?: string;
} & TExtensions;
