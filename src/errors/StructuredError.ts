import { BaseError } from "./BaseError.js";
import type { ErrorOptions } from "./ErrorOptions.js";
import { UNKNOWN_ERROR_DEFAULTS } from "./defaults.js";
import { moreAggregatedErrorsMarker } from "./serializer-markers.js";
import {
  readMembers,
  readProperty,
  type AggregateMembers,
} from "./guarded-read.js";

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
   * memory, so the walk also carries a node budget.
   *
   * The serializer has no total-node cap (depth 100 and width 100 per node
   * compound), so no finite budget covers every legal serializer output and
   * this constant cannot come from the serializer caps. 10,000 is a deliberate
   * ceiling: every realistic log shape round-trips losslessly, while a hostile
   * payload is capped at ~10^4 stack captures (tens of milliseconds, not
   * seconds). Reconstruction of deeper-nested aggregates truncates: past the
   * budget, a `cause` drops like it does past the depth cap, and the
   * remaining members of an aggregate collapse into the count marker. Charged
   * at exactly one site, the top of
   * {@link StructuredError.#reconstructCause}'s object path.
   */
  static readonly #MAX_NODES = 10_000;

  static #fromJSON(
    json: unknown,
    depth: number,
    budget: { nodes: number },
  ): StructuredError<string, string> {
    // Every payload field is a foreign read: the documented contract is that
    // malformed input yields the fallback envelope and never a throw, and an
    // in-process payload can carry throwing getters.
    const obj: unknown = typeof json === "object" && json !== null ? json : {};

    const rawCode = readProperty(obj, "code");
    const code =
      typeof rawCode === "string" ? rawCode : UNKNOWN_ERROR_DEFAULTS.code;
    const rawCategory = readProperty(obj, "category");
    const category =
      typeof rawCategory === "string"
        ? rawCategory
        : UNKNOWN_ERROR_DEFAULTS.category;
    const rawRetryable = readProperty(obj, "retryable");
    const retryable =
      typeof rawRetryable === "boolean"
        ? rawRetryable
        : UNKNOWN_ERROR_DEFAULTS.retryable;
    const rawMessage = readProperty(obj, "message");
    const message =
      typeof rawMessage === "string"
        ? rawMessage
        : UNKNOWN_ERROR_DEFAULTS.message;
    // Shallow copy: decouples the error's top-level details from the input
    // payload, so mutating the payload afterwards cannot change the error.
    // Values nested deeper stay shared; a freshly JSON.parsed payload is not
    // normally reused, so that is an accepted depth of guarantee.
    const details = StructuredError.#copyDetails(readProperty(obj, "details"));
    const cause = StructuredError.#reconstructCause(
      readProperty(obj, "cause"),
      depth,
      budget,
    );

    const error = new StructuredError({
      code,
      category,
      retryable,
      message,
      ...(details !== undefined && { details }),
      ...(cause !== undefined && { cause }),
    });

    // Rehydrate the original identity rather than the freshly generated values.
    StructuredError.#rehydrate(
      error,
      "stack",
      readProperty(obj, "stack"),
      "string",
    );
    StructuredError.#rehydrate(
      error,
      "timestamp",
      readProperty(obj, "timestamp"),
      "number",
    );
    StructuredError.#rehydrate(
      error,
      "timestampIso",
      readProperty(obj, "timestampIso"),
      "string",
    );

    // A structured error can carry aggregate members too (a fan-out error that
    // sets its own `errors`). The log serializer reads them by shape, so the
    // wire keeps them; restore them the way a native aggregate holds them,
    // non-enumerable, which also makes the round-trip stable across repeats.
    const aggregate = readMembers(obj, StructuredError.#MEMBERS_READ);
    if (aggregate !== undefined) {
      Object.defineProperty(error, "errors", {
        value: StructuredError.#reconstructMembers(aggregate, depth, budget),
        configurable: true,
        writable: true,
        enumerable: false,
      });
    }

    return error as StructuredError<string, string>;
  }

  /**
   * The shallow, decoupled copy of a payload's `details`, or `undefined`. A
   * details object whose own getter throws during the copy is dropped: the
   * envelope survives without it.
   */
  static #copyDetails(value: unknown): Record<string, unknown> | undefined {
    if (typeof value !== "object" || value === null || Array.isArray(value)) {
      return undefined;
    }
    try {
      return { ...(value as Record<string, unknown>) };
    } catch {
      return undefined;
    }
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
   * Members read from a payload: one past the width cap, so the element that
   * follows the last reconstructed member is in hand when the tail is the
   * serializer's own count marker.
   */
  static readonly #MEMBERS_READ = StructuredError.#MAX_MEMBERS + 1;

  /**
   * Rebuilds an aggregate's members. Each member goes back through
   * {@link StructuredError.#reconstructCause}, so a nested aggregate, a
   * structured branch and the serializer's width marker (a plain string) all
   * come back in the shape they were logged in. The walk stops at the width
   * cap or when the node budget runs out, whichever comes first.
   */
  static #reconstructMembers(
    aggregate: AggregateMembers,
    depth: number,
    budget: { nodes: number },
  ): unknown[] {
    const { members, total } = aggregate;
    const reconstructed: unknown[] = [];
    let taken = 0;
    while (
      taken < total &&
      taken < StructuredError.#MAX_MEMBERS &&
      budget.nodes > 0
    ) {
      reconstructed.push(
        StructuredError.#reconstructCause(members[taken], depth + 1, budget),
      );
      taken++;
    }

    const rest = total - taken;
    if (rest > 0) {
      // A payload this library produced is already capped, and its tail is the
      // serializer's own count marker. Carry that string through verbatim
      // rather than replacing it with "[1 more …]", which would understate the
      // original truncation on every round-trip.
      const tail = members[taken];
      reconstructed.push(
        rest === 1 && typeof tail === "string"
          ? tail
          : moreAggregatedErrorsMarker(rest),
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

    const obj: unknown = value;

    // Structured shape -> nested StructuredError. Guarded reads throughout:
    // the never-throws contract covers every nested node too.
    if (
      typeof readProperty(obj, "code") === "string" &&
      typeof readProperty(obj, "category") === "string" &&
      typeof readProperty(obj, "retryable") === "boolean"
    ) {
      return StructuredError.#fromJSON(obj, depth + 1, budget);
    }

    // Aggregate shape -> a real AggregateError, so the branch failures survive
    // the wire. `structuredClone` drops them (verified on Node, Bun, Deno and
    // workerd, where it also degrades the class to a plain `Error`), which makes
    // this round-trip the only lossless way across a worker or queue boundary.
    const members = readMembers(obj, StructuredError.#MEMBERS_READ);
    const messageField = readProperty(obj, "message");
    const nameField = readProperty(obj, "name");
    const stackField = readProperty(obj, "stack");
    if (members !== undefined) {
      const aggregate = new AggregateError(
        StructuredError.#reconstructMembers(members, depth, budget),
        typeof messageField === "string" ? messageField : "",
      );
      if (typeof nameField === "string") {
        aggregate.name = nameField;
      }
      if (typeof stackField === "string") {
        aggregate.stack = stackField;
      }
      const nested = StructuredError.#reconstructCause(
        readProperty(obj, "cause"),
        depth + 1,
        budget,
      );
      if (nested !== undefined) {
        const aggregateCause = aggregate as unknown as { cause: unknown };
        aggregateCause.cause = nested;
      }
      return aggregate;
    }

    // Plain error shape -> a basic Error, chained.
    if (typeof messageField === "string") {
      const err = new Error(messageField);
      if (typeof nameField === "string") {
        err.name = nameField;
      }
      if (typeof stackField === "string") {
        err.stack = stackField;
      }
      // A Node-style errno `code` (`ECONNREFUSED`, `ENOENT`, …) is what
      // {@link hasErrorCode} matches on, and it is what an aggregate's members
      // usually carry. The serializer already writes it, so restore it rather
      // than handing back an error the library's own guard can no longer
      // recognize. It stays a lone field: without `category`/`retryable` the
      // result does not read as a `StructuredError`.
      const codeField = readProperty(obj, "code");
      if (typeof codeField === "string" || typeof codeField === "number") {
        const errProperties = err as unknown as Record<string, unknown>;
        errProperties.code = codeField;
      }
      const nested = StructuredError.#reconstructCause(
        readProperty(obj, "cause"),
        depth + 1,
        budget,
      );
      if (nested !== undefined) {
        const errCause = err as unknown as { cause: unknown };
        errCause.cause = nested;
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
