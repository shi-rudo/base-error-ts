import { BaseError } from "./BaseError.js";
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
 * cause chains, and JSON serialization.
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
  TDetails extends Record<string, unknown> = Record<string, unknown>,
> extends BaseError<`${TCode}`> {
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
    options: ErrorOptions<TCode, TCategory, TDetails>,
  ) {
    super(options.message, options.cause);

    // Override the name property to use the code instead of the constructor name
    // Cast to template literal type to match BaseError's name type
    (this as unknown as { name: `${TCode}` }).name = options.code as `${TCode}`;

    this.code = options.code;
    this.category = options.category;
    this.retryable = options.retryable;
    this.details = options.details;
  }

  /**
   * Serializes the error to JSON, including all structured metadata.
   * Extends BaseError's toJSON to include code, category, retryable, and details.
   */
  public override toJSON(): Record<string, unknown> {
    const baseJson = super.toJSON();

    return {
      ...baseJson,
      code: this.code,
      category: this.category,
      retryable: this.retryable,
      ...(this.details !== undefined && { details: this.details }),
    };
  }

  /**
   * Converts the error to an RFC 9457 Problem Details object.
   *
   * This method provides a standardized format for HTTP API error responses.
   * The `details` object is spread into the result as extension members.
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
   * //   detail: "User with id 123 not found",
   * //   code: "USER_NOT_FOUND",
   * //   category: "NOT_FOUND",
   * //   retryable: false,
   * //   userId: "123"
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
    } = {},
  ): ProblemDetails<TCode, TCategory, TDetails> {
    const { status, type, title, instance, traceId } = options;

    return {
      ...(type !== undefined && { type }),
      ...(title !== undefined && { title }),
      ...(status !== undefined && { status }),
      detail: this.message,
      ...(instance !== undefined && { instance }),
      code: this.code,
      category: this.category,
      retryable: this.retryable,
      ...(traceId !== undefined && { traceId }),
      ...this.details,
    } as ProblemDetails<TCode, TCategory, TDetails>;
  }

  /**
   * Converts the error to an ErrorResponse object for API responses.
   *
   * This method provides a standardized format for RPC and HTTP error responses
   * with full context including HTTP status, messages, and localization.
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
    } = {},
  ): ErrorResponse<
    TCode,
    TCategory,
    {
      httpStatusCode?: number;
      message: string;
      messageLocalized?: LocalizedMessage;
    },
    TDetails extends undefined ? Record<string, never> : TDetails
  > {
    const { httpStatusCode, messageLocalized, traceId } = options;

    return {
      isSuccess: false,
      code: this.code,
      category: this.category,
      retryable: this.retryable,
      ...(traceId !== undefined && { traceId }),
      ctx: {
        ...(httpStatusCode !== undefined && { httpStatusCode }),
        message: this.message,
        ...(messageLocalized !== undefined && { messageLocalized }),
      },
      details: (this.details ?? {}) as TDetails extends undefined
        ? Record<string, never>
        : TDetails,
    };
  }
}
