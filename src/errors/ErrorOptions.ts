/**
 * Configuration options for creating a StructuredError with typed metadata.
 *
 * ErrorOptions provides a standardized structure for error configuration with:
 * - Type-safe error codes and categories
 * - Retryability flags for automatic retry logic
 * - Structured details for additional context
 * - Error cause chains for nested errors
 *
 * @template TCode - Union type of error codes (e.g., "USER_NOT_FOUND" | "VALIDATION_FAILED")
 * @template TCategory - Union type of error categories (e.g., "AUTH" | "VALIDATION")
 * @template TDetails - Type of structured details object, defaults to Record<string, unknown>
 *
 * @example
 * ```ts
 * // Basic usage with type inference
 * const options: ErrorOptions<string, string> = {
 *   code: "VALIDATION_FAILED",
 *   category: "CLIENT_ERROR",
 *   retryable: false,
 *   message: "Email format is invalid",
 *   details: { field: "email", value: "not-an-email" }
 * };
 * ```
 *
 * @example
 * ```ts
 * // With typed error codes and categories
 * type ApiErrorCode = "UNAUTHORIZED" | "NOT_FOUND" | "RATE_LIMIT";
 * type ApiCategory = "AUTH" | "RESOURCE" | "RATE_LIMIT";
 *
 * interface ApiErrorDetails {
 *   statusCode: number;
 *   endpoint?: string;
 * }
 *
 * const options: ErrorOptions<ApiErrorCode, ApiCategory, ApiErrorDetails> = {
 *   code: "UNAUTHORIZED",
 *   category: "AUTH",
 *   retryable: false,
 *   message: "Authentication token is invalid",
 *   details: { statusCode: 401, endpoint: "/api/users" }
 * };
 * ```
 */
export type ErrorOptions<
  TCode extends string,
  TCategory extends string,
  // Using Record<string, {}> as default for better compatibility with strict frameworks
  // eslint-disable-next-line @typescript-eslint/no-empty-object-type
  TDetails extends Record<string, unknown> = Record<string, {}>,
> = {
  /**
   * Unique identifier for the error type.
   * Used for programmatic error handling and switching.
   *
   * @example "USER_NOT_FOUND", "DATABASE_TIMEOUT", "VALIDATION_FAILED"
   */
  code: TCode;

  /**
   * Category grouping for related errors.
   * Used for broader error classification and handling.
   *
   * @example "AUTH", "VALIDATION", "INFRASTRUCTURE"
   */
  category: TCategory;

  /**
   * Flag indicating whether the failed operation can be retried.
   * Used by retry mechanisms to determine if automatic retry should be attempted.
   *
   * @example
   * - `true` for transient errors (network timeouts, rate limits)
   * - `false` for permanent errors (validation failures, unauthorized access)
   */
  retryable: boolean;

  /**
   * Human-readable technical error message.
   * Typically contains detailed information for developers and logs.
   *
   * @example "Failed to connect to PostgreSQL database at localhost:5432"
   */
  message: string;

  /**
   * Optional structured data providing additional error context.
   * Can include any relevant metadata specific to the error.
   *
   * @example
   * ```ts
   * {
   *   userId: "123",
   *   field: "email",
   *   constraint: "format",
   *   attemptCount: 3
   * }
   * ```
   */
  details?: TDetails;

  /**
   * Optional underlying error that caused this error.
   * Used to preserve error chains and root cause information.
   *
   * @example
   * ```ts
   * try {
   *   await database.connect();
   * } catch (err) {
   *   throw new StructuredError({
   *     code: "DB_CONNECTION_FAILED",
   *     category: "INFRASTRUCTURE",
   *     retryable: true,
   *     message: "Failed to connect to database",
   *     cause: err // Preserve the original error
   *   });
   * }
   * ```
   */
  cause?: unknown;
};
