import {
  BaseError,
  DEFAULT_PUBLIC_ERROR_CATEGORY,
  DEFAULT_PUBLIC_ERROR_CODE,
} from "./BaseError.js";
import type { PublicErrorJSON, PublicErrorOptions } from "./BaseError.js";
import type { ErrorOptions } from "./ErrorOptions.js";
import type { ProblemDetails } from "../response/ProblemDetails.js";
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
   * Serializes the error for logs, including all structured metadata.
   * Extends BaseError's log object with code, category, retryable, and details.
   */
  public override toLogObject(): Record<string, unknown> {
    const baseJson = super.toLogObject();

    return {
      ...baseJson,
      code: this.code,
      category: this.category,
      retryable: this.retryable,
      ...(this.details !== undefined && { details: this.details }),
    };
  }

  /** Backwards-compatible JSON serialization for logging-oriented consumers. */
  public override toJSON(): Record<string, unknown> {
    return this.toLogObject();
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
   * details are not exposed unless configured with public fields or options.
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
  public toProblemDetails(
    options: {
      /** HTTP status code */
      status?: number;
      /** URI reference identifying the problem type */
      type?: string;
      /** Short, human-readable summary */
      title?: string;
      /** URI reference identifying this specific occurrence */
      instance?: string;
      /** Trace ID for distributed tracing */
      traceId?: string;
      /** Per-call public error code override */
      publicCode?: string;
      /** Per-call public message/detail override */
      detail?: string;
      /** Per-call exposure override */
      expose?: boolean;
      /** Include structured details as extension members. Defaults to false. */
      includeDetails?: boolean;
    } = {},
  ): ProblemDetails<
    TCode | TPublicCode | typeof DEFAULT_PUBLIC_ERROR_CODE,
    TCategory,
    TDetails
  > {
    const {
      status,
      type,
      title,
      instance,
      traceId,
      publicCode,
      detail,
      includeDetails,
    } = options;
    const expose = options.expose ?? this.shouldExposeToClients();
    const publicJson = this.toPublicJSON({
      code: publicCode,
      message: detail,
      expose,
      traceId,
    });

    return {
      ...(type !== undefined && { type }),
      ...(title !== undefined && { title }),
      ...(status !== undefined && { status }),
      detail: publicJson.message,
      ...(instance !== undefined && { instance }),
      code: publicJson.code,
      ...(expose && { category: this.category }),
      retryable: this.retryable,
      ...(traceId !== undefined && { traceId }),
      ...(includeDetails === true && this.details !== undefined
        ? this.details
        : undefined),
    } as ProblemDetails<
      TCode | TPublicCode | typeof DEFAULT_PUBLIC_ERROR_CODE,
      TCategory,
      TDetails
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
  public toErrorResponse(
    options: {
      /** HTTP status code */
      httpStatusCode?: number;
      /** Localized message for client display */
      messageLocalized?: LocalizedMessage;
      /** Trace ID for distributed tracing */
      traceId?: string;
      /** Per-call public error code override */
      publicCode?: string;
      /** Per-call public category override */
      publicCategory?: string;
      /** Per-call public message override */
      message?: string;
      /** Per-call exposure override */
      expose?: boolean;
      /** Include structured details. Defaults to false. */
      includeDetails?: boolean;
    } = {},
  ): ErrorResponse<
    TCode | TPublicCode | typeof DEFAULT_PUBLIC_ERROR_CODE | string,
    TCategory | typeof DEFAULT_PUBLIC_ERROR_CATEGORY | string,
    {
      httpStatusCode?: number;
      message: string;
      messageLocalized?: LocalizedMessage;
    },
    TDetails
  > {
    const {
      httpStatusCode,
      messageLocalized,
      traceId,
      publicCode,
      publicCategory,
      message,
      includeDetails,
    } = options;
    const expose = options.expose ?? this.shouldExposeToClients();
    const publicJson = this.toPublicJSON({
      code: publicCode,
      message,
      expose,
      traceId,
    });

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
          ...(messageLocalized !== undefined && { messageLocalized }),
        },
        details: (includeDetails === true
          ? (this.details ?? {})
          : {}) as TDetails,
      },
    };
  }
}
