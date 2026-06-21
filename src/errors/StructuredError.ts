import { BaseError } from "./BaseError.js";
import type { ErrorOptions } from "./ErrorOptions.js";
import { UNKNOWN_ERROR_DEFAULTS } from "./defaults.js";

/**
 * A structured error class that extends BaseError with enhanced error metadata.
 *
 * StructuredError provides a standardized way to create errors with:
 * - Error codes for programmatic error handling
 * - Categories for grouping related errors
 * - Retryability flags for automatic retry logic
 * - Structured details for additional context
 *
 * All BaseError features are preserved, including timestamps, cause chains, and
 * log serialization.
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
> extends BaseError<`${TCode}`> {
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
    options: ErrorOptions<TCode, TCategory, TDetails>,
  ) {
    super(options.message, options.cause, {
      name: options.code,
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
   * prototype pollution). The original `stack`/`timestamp` and the cause chain
   * are restored. Reconstructed fields are **not** an authority on trust:
   * whoever produced the payload can forge them.
   *
   * Always returns a base `StructuredError`: subclass identity and behavior are
   * **not** restored (a `ValidationError` round-trips to a `StructuredError`,
   * losing `publicIssues()`/`addIssue()`; its raw `details.issues` survive as
   * data). Narrow on `code`, not on `_tag`/instanceof.
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
}
