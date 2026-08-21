import { BaseError } from "./BaseError.js";
import type { ErrorOptions } from "./ErrorOptions.js";
import { UNKNOWN_ERROR_DEFAULTS } from "./defaults.js";
import { moreAggregatedErrorsMarker } from "./serializer-markers.js";

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
   * prototype pollution). `details` is copied shallowly (the top level is
   * decoupled from the payload; nested values stay shared). The original
   * `stack`/`timestamp` and the cause chain are restored. Reconstructed
   * fields are **not** an authority on trust: whoever produced the payload
   * can forge them.
   *
   * Always returns a base `StructuredError`: subclass identity and behavior are
   * **not** restored (a `ValidationError` round-trips to a `StructuredError`,
   * losing `publicIssues()`/`addIssue()`; its raw `details.issues` survive as
   * data). Narrow on `code`, not on `_tag`/instanceof.
   */
  public static fromJSON(json: unknown): StructuredError<string, string> {
    return StructuredError.#fromJSON(json, 0, {
      nodes: StructuredError.#MAX_NODES,
    });
  }

  static readonly #MAX_DEPTH = 100;

  /**
   * Total number of cause-graph nodes one `fromJSON` call reconstructs. The
   * depth cap and the per-node width cap still allow `100^depth`
   * reconstructions, and a shared reference makes such a payload tiny in
   * memory, so the walk also carries a node budget. Sized above the ~1500
   * nodes a maximal serializer output legitimately carries (width 100, deep
   * branch chains), so this library's own log shape round-trips losslessly,
   * while a hostile payload is capped at ~10^4 stack captures (tens of
   * milliseconds, not seconds). Past the budget, a `cause` drops like it does
   * past the depth cap, and the remaining members of an aggregate collapse
   * into the count marker. Charged at exactly one site, the top of
   * {@link StructuredError.#reconstructCause}'s object path.
   */
  static readonly #MAX_NODES = 10_000;

  static #fromJSON(
    json: unknown,
    depth: number,
    budget: { nodes: number },
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
    // Shallow copy: decouples the error's top-level details from the input
    // payload, so mutating the payload afterwards cannot change the error.
    // Values nested deeper stay shared; a freshly JSON.parsed payload is not
    // normally reused, so that is an accepted depth of guarantee.
    const details =
      typeof obj.details === "object" && obj.details !== null
        ? { ...(obj.details as Record<string, unknown>) }
        : undefined;
    const cause = StructuredError.#reconstructCause(obj.cause, depth, budget);

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

    // A structured error can carry aggregate members too (a fan-out error that
    // sets its own `errors`). The log serializer reads them by shape, so the
    // wire keeps them; restore them the way a native aggregate holds them,
    // non-enumerable, which also makes the round-trip stable across repeats.
    if (Array.isArray(obj.errors)) {
      Object.defineProperty(error, "errors", {
        value: StructuredError.#reconstructMembers(obj.errors, depth, budget),
        configurable: true,
        writable: true,
        enumerable: false,
      });
    }

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

  /**
   * Largest number of aggregate members reconstructed per node. Mirrors the
   * serializer's own width cap, so this library's log shape round-trips
   * unchanged while a foreign or hostile payload cannot amplify: every
   * reconstructed `Error` captures a stack, which is far more expensive than
   * the array entry that asks for it.
   */
  static readonly #MAX_MEMBERS = 100;

  /**
   * Rebuilds an aggregate's members. Each member goes back through
   * {@link StructuredError.#reconstructCause}, so a nested aggregate, a
   * structured branch and the serializer's width marker (a plain string) all
   * come back in the shape they were logged in. The walk stops at the width
   * cap or when the node budget runs out, whichever comes first.
   */
  static #reconstructMembers(
    members: readonly unknown[],
    depth: number,
    budget: { nodes: number },
  ): unknown[] {
    const reconstructed: unknown[] = [];
    let taken = 0;
    while (
      taken < members.length &&
      taken < StructuredError.#MAX_MEMBERS &&
      budget.nodes > 0
    ) {
      reconstructed.push(
        StructuredError.#reconstructCause(members[taken], depth + 1, budget),
      );
      taken++;
    }

    const rest = members.slice(taken);
    if (rest.length > 0) {
      // A payload this library produced is already capped, and its tail is the
      // serializer's own count marker. Carry that string through verbatim
      // rather than replacing it with "[1 more …]", which would understate the
      // original truncation on every round-trip.
      const tail = rest[0];
      reconstructed.push(
        rest.length === 1 && typeof tail === "string"
          ? tail
          : moreAggregatedErrorsMarker(rest.length),
      );
    }
    return reconstructed;
  }

  static #reconstructCause(
    value: unknown,
    depth: number,
    budget: { nodes: number },
  ): unknown {
    if (depth >= StructuredError.#MAX_DEPTH) {
      return undefined;
    }
    if (typeof value !== "object" || value === null) {
      // Primitives (and null) are kept verbatim.
      return value;
    }
    if (budget.nodes <= 0) {
      return undefined;
    }
    budget.nodes--;

    const obj = value as Record<string, unknown>;

    // Structured shape -> nested StructuredError.
    if (
      typeof obj.code === "string" &&
      typeof obj.category === "string" &&
      typeof obj.retryable === "boolean"
    ) {
      return StructuredError.#fromJSON(obj, depth + 1, budget);
    }

    // Aggregate shape -> a real AggregateError, so the branch failures survive
    // the wire. `structuredClone` drops them (verified on Node, Bun, Deno and
    // workerd, where it also degrades the class to a plain `Error`), which makes
    // this round-trip the only lossless way across a worker or queue boundary.
    if (Array.isArray(obj.errors)) {
      const aggregate = new AggregateError(
        StructuredError.#reconstructMembers(obj.errors, depth, budget),
        typeof obj.message === "string" ? obj.message : "",
      );
      if (typeof obj.name === "string") {
        aggregate.name = obj.name;
      }
      if (typeof obj.stack === "string") {
        aggregate.stack = obj.stack;
      }
      const nested = StructuredError.#reconstructCause(
        obj.cause,
        depth + 1,
        budget,
      );
      if (nested !== undefined) {
        (aggregate as unknown as { cause: unknown }).cause = nested;
      }
      return aggregate;
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
      // A Node-style errno `code` (`ECONNREFUSED`, `ENOENT`, …) is what
      // {@link hasErrorCode} matches on, and it is what an aggregate's members
      // usually carry. The serializer already writes it, so restore it rather
      // than handing back an error the library's own guard can no longer
      // recognize. It stays a lone field: without `category`/`retryable` the
      // result does not read as a `StructuredError`.
      if (typeof obj.code === "string" || typeof obj.code === "number") {
        (err as unknown as Record<string, unknown>).code = obj.code;
      }
      const nested = StructuredError.#reconstructCause(
        obj.cause,
        depth + 1,
        budget,
      );
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
