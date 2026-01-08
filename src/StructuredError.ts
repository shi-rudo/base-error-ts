import { BaseError } from "./BaseError.js";
import type { ErrorOptions } from "./utils/ErrorOptions.js";

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
  /**
   * Discriminant tag for type narrowing - set to "StructuredError".
   * Subclasses can override this with a literal type for stricter type safety.
   */
  public override readonly _tag = "StructuredError" as const;

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
}
