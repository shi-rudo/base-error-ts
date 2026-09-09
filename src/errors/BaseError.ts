import {
  ENVELOPE_KEYS,
  ROOT_ENVELOPE_KEYS,
  RESERVED_NODE_KEYS,
} from "./log-field-keys.js";
import {
  createLogBuildContext,
  type LogBuildContext,
} from "./log-build-context.js";
import {
  serializeLogData,
  isLogDataDepthCut,
  copyLogDataDepthCut,
} from "./log-data.js";
import {
  childPosition,
  type LogRegion as RedactRegion,
} from "./log-position.js";
import {
  readMembers,
  readOwnKeys,
  readPrototype,
  readOwnPropertyDescriptor,
  UNREADABLE_REFLECTION,
  readOwnEnumerableKeys,
  readOwnProperty,
  readProperty,
  readPropertyResult,
  type AggregateMembers,
} from "./guarded-read.js";
import type { JsonSafeValue } from "./json-safe.js";
import {
  CIRCULAR_CAUSE_CHAIN_MARKER,
  MAX_CAUSE_DEPTH_MARKER,
  MAX_LOG_SIZE_MARKER,
  UNSERIALIZABLE_CAUSE_MARKER,
  moreAggregatedErrorsMarker,
} from "./serializer-markers.js";
import {
  MAX_AGGREGATE_MEMBERS,
  MAX_CAUSE_DEPTH,
  MAX_DATA_DEPTH,
  MAX_DATA_NODES,
  MAX_LOG_OBJECT_KEYS_READ,
  MAX_REDACTION_READS,
  MAX_LOG_NODES,
  MAX_OWN_LOG_FIELDS,
  MAX_OWN_LOG_FIELDS_READ,
} from "./walker-bounds.js";

// This avoids polluting the global scope
interface V8ErrorConstructor {
  captureStackTrace?(
    targetObject: object,
    constructorOpt?: (...args: unknown[]) => unknown,
  ): void;
}

export type BaseErrorOptions = {
  /** Override the runtime error name. Intended for framework errors with stable codes. */
  name?: string;
};

/**
 * Recommended data contract for {@link BaseError.buildOwnLogFields} overrides.
 * Convert dates, collections, and bigints explicitly. Return a plain record
 * whose values are JSON primitives, arrays, or nested records.
 * Do not return getters or serialization callbacks.
 * Types cannot enforce finite numbers, plain prototypes, acyclicity, or size.
 * Runtime guards and redaction still apply, including the reserved-key rules.
 */
export type OwnLogFields = Readonly<Record<string, JsonSafeValue>>;

/**
 * Replacement used by {@link BaseError.redact}/{@link BaseError.redactAllow}.
 * Either a fixed value, or a function of the original `(value, key)`: useful
 * for partial masking (`****6789`) or preserving the value's type.
 */
export type RedactMask = string | ((value: unknown, key: string) => unknown);

/** Markers the redaction walker writes where a bound cut its walk. */
const REDACTION_DEPTH_MARKER = "[Max redaction depth exceeded]";
const REDACTION_CYCLE_MARKER = "[Circular reference]";
const REDACTION_SIZE_MARKER = "[Max redaction size exceeded]";
const REDACTION_READ_CUT = Symbol("redaction.read.cut");

type RedactionStackHeader = {
  target: Record<string, unknown>;
  name?: unknown;
  message?: unknown;
  stack?: unknown;
};

/**
 * Application-specific base error that works across full Node.js, isolate "edge"
 * runtimes (Cloudflare Workers, Deno Deploy, Vercel Edge Functions) and modern
 * browsers. It preserves the native `cause` field where available, falls back
 * gracefully where it is not, and produces the richest stack trace the host
 * can provide.
 *
 * @example
 * ```ts
 * // Using automatic name inference
 * class UserNotFoundError extends BaseError<'UserNotFoundError'> {
 * constructor(userId: string) {
 * super(`User with id ${userId} not found in database lookup`); // Technical message
 * }
 * }
 * ```
 */
export class BaseError<T extends string> extends Error {
  /**
   * Nominal type brand - makes each subclass structurally distinct at compile time.
   * Using 'this' ensures every subclass gets its own unique type identity.
   * @internal - This property is for type-checking only, never use it directly.
   */
  protected readonly __brand!: this;

  /**
   * Discriminant tag for type narrowing. Derived from the resolved error name
   * (an explicit `name` option, otherwise the constructor name), so it never
   * diverges from {@link name}.
   *
   * Because the fallback is `constructor.name`, a build that minifies class
   * names will mangle it. For a stable discriminant either pass an explicit
   * `name`, or override `_tag` with a literal, which also narrows the
   * type:
   *
   * @example
   * ```ts
   * class MyError extends BaseError<'MyError'> {
   *   readonly _tag = 'MyError' as const; // stable + strictly typed
   * }
   * ```
   */
  public readonly _tag: string;

  public override readonly name: T;

  /** Epoch-ms timestamp (numeric) */
  public readonly timestamp: number = Date.now();

  /**
   * ISO-8601 timestamp (string) for log aggregators that prefer text. Derived
   * from {@link timestamp} (one clock read), so the two can never disagree
   * across a millisecond boundary.
   */
  public readonly timestampIso: string = new Date(this.timestamp).toISOString();

  /** Rich, filtered stack where the host supports it. */
  public override readonly stack?: string;

  #redactor?: (log: Record<string, unknown>) => Record<string, unknown>;

  /**
   * Mask for the technical `message` in {@link toString}, set only by a
   * deny-list {@link redact} whose keys include `"message"`. `toString` (unlike
   * `toLogObject`) cannot run an arbitrary redactor, but a denied `message` is
   * an explicit statement that the text is sensitive, so the one string
   * rendering the library controls honors it. Follows the redactor's
   * last-wins semantics: `redactAllow`/`redactWith` clear it.
   */
  #messageMask?: RedactMask;

  /**
   * Creates a new BaseError instance with automatic name inference.
   *
   * @param message – Human-readable explanation (name will be inferred from constructor)
   * @param cause   – Optional underlying error or extra context
   * @param options – Optional runtime name settings
   */
  // The /*#__PURE__*/ pragma lets tree-shakers know the constructor is side-effect free
  public /*#__PURE__*/ constructor(
    message: string,
    cause?: unknown,
    options: BaseErrorOptions = {},
  ) {
    // Always call super with just message for TypeScript compatibility
    super(message);

    // Resolve the error's stable identity once. An explicit `name` wins;
    // otherwise fall back to the constructor name. Both `name` and `_tag`
    // derive from it so they can never diverge. Passing an explicit
    // `name` stabilizes the discriminant under class-name minification.
    // A direct `new BaseError(...)` uses the literal instead of inference:
    // the bundler rewrites this class into a renamed binding (its body reads
    // its own statics), and `constructor.name` would report that binding
    // (`_BaseError`). verify-dist.mjs guards this on every build.
    const resolvedName =
      options.name ??
      (new.target === BaseError ? "BaseError" : this.constructor.name);
    this.name = resolvedName as T;
    this._tag = resolvedName;

    // Handle cause with native support when available, fallback otherwise
    if (cause !== undefined) {
      this.#setCause(cause);
    }

    // Preserve prototype chain for `instanceof` checks after transpilation.
    // Guarded: under native class semantics the prototype is already correct,
    // and an unconditional setPrototypeOf would deopt every construction (V8
    // hidden-class transition) for nothing.
    if (Object.getPrototypeOf(this) !== new.target.prototype) {
      Object.setPrototypeOf(this, new.target.prototype);
    }

    // Cross-runtime best-effort stack collection, deferred: capturing is
    // cheap, symbolizing/filtering is not, so both happen on first read.
    this.#installLazyStack();
  }

  /**
   * Redacts the given keys (deep, at any depth) from the **log** output
   * (`toLogObject`/`toJSON`). Sticky on the instance, so it also applies when a
   * logger auto-serializes the error via `JSON.stringify`, and when another
   * error of the same realm logs this one as its `cause` (see
   * {@link toLogObject}).
   *
   * ⚠️ Scope: redaction rewrites the **log object**, not every string render.
   * When `keys` includes `"message"`, the `stack` fields of the log object
   * are covered too: on the root, on every `cause`, and on every aggregate
   * member, a header that repeats the node's own `name: message` is rewritten
   * with the masked message and keeps its frames, and a stack that does not
   * start with that header is handed to the mask as a whole. {@link toString}
   * masks the technical message as well. The `err.stack` property and Node's
   * `console.log(err)` inspection (which prints that property) stay
   * unredacted. When redaction matters, log errors only through a structured
   * serializer that hits `toJSON`, never via string interpolation.
   *
   * @param keys - Property names to mask wherever they appear in the log object.
   * @param options - `mask` defaults to `"[REDACTED]"`.
   */
  public redact(keys: string[], options?: { mask?: RedactMask }): this {
    const mask = options?.mask ?? "[REDACTED]";
    const denied = new Set(keys);
    this.#messageMask = denied.has("message") ? mask : undefined;
    // A denied `stack` is masked whole by the walk, so the header pass is
    // needed only for a denied `message` on its own.
    const maskStackHeaders = denied.has("message") && !denied.has("stack");
    this.#redactor = (log) => {
      const headers: RedactionStackHeader[] | undefined = maskStackHeaders
        ? []
        : undefined;
      const state = {
        nodes: 0,
        seen: new Set<object>(),
        reads: { nodes: 0 },
        headers,
      };
      const masked = BaseError.#redactWalk(
        log,
        (key, value) =>
          denied.has(key)
            ? BaseError.#applyMask(mask, value, key)
            : BaseError.#RECURSE,
        "root",
        0,
        state,
      ) as Record<string, unknown>;
      for (const header of headers ?? []) {
        if (typeof header.stack === "string") {
          header.target.stack = BaseError.#maskStackHeader(
            header.stack,
            header.name,
            header.message,
            mask,
          );
        }
      }
      return masked;
    };
    return this;
  }

  /**
   * Allow-list redaction (higher assurance than {@link redact}): within any
   * **data** region (a `details` subtree at any depth, the data-bearing
   * fields of a `cause`, and any subclass-added top-level field): masks every
   * leaf whose key is **not** listed, so a newly-added field leaks nothing by
   * default. Container objects are recursed so nested allowed leaves survive.
   * A leaf inside an **array** has no key of its own and is judged under the
   * key of the array that holds it, so a list of tokens is masked as a whole
   * unless that key is allowed.
   * Only the library's own structural envelope is kept: the fixed top-level
   * fields ({@link ROOT_ENVELOPE_KEYS}: `name`/`message`/`stack`/
   * `code`/`category`/`retryable`/`timestamp`/`timestampIso`/`cause`/`details`)
   * and a cause's top-level structural envelope keys (`name`/`message`/`stack`/
   * `code`/`category`/`retryable`). Any other top-level field (e.g. one a
   * subclass adds via `buildOwnLogFields`) is data: its leaves are masked unless
   * allow-listed. A cause's foreign fields (anything outside that fixed set,
   * and everything nested beneath them) are treated as data, so a plain object
   * that merely *looks* like a structured error cannot smuggle siblings (or
   * envelope-named keys buried in foreign subtrees) through. An envelope key
   * holds a primitive: a **container** under an envelope name (`stack: {…}`,
   * `code: {…}`) is data, at the root and inside a cause, so its leaves are
   * masked whatever they are named. Sticky; last redactor wins, and the
   * policy holds when another error of the same realm logs this one as its
   * `cause` (see {@link toLogObject}).
   *
   * ⚠️ Scope: rewrites the **log object** only. The technical `message` is part
   * of the kept structural envelope, so `toString`, `err.stack`, and Node's
   * `console.log(err)` inspection carry it unchanged; see {@link redact} for
   * masking the message itself.
   *
   * @param keys - Data leaf keys allowed to survive in the log.
   * @param options - `mask` defaults to `"[REDACTED]"`.
   */
  public redactAllow(keys: string[], options?: { mask?: RedactMask }): this {
    const mask = options?.mask ?? "[REDACTED]";
    const allow = new Set(keys);
    this.#messageMask = undefined;
    this.#redactor = (log) => {
      const state = {
        nodes: 0,
        seen: new Set<object>(),
        reads: { nodes: 0 },
      };
      return BaseError.#redactWalk(
        log,
        (key, value, region: RedactRegion) => {
          // Always recurse into containers so nested allowed leaves survive.
          if (
            Array.isArray(value) ||
            BaseError.#isWalkable(value, state.reads)
          ) {
            return BaseError.#RECURSE;
          }
          // Leaf. Keep iff the region permits this key.
          const kept =
            (region === "root" && ROOT_ENVELOPE_KEYS.has(key)) ||
            allow.has(key) ||
            (region === "cause" && ENVELOPE_KEYS.has(key));
          return kept ? value : BaseError.#applyMask(mask, value, key);
        },
        "root",
        0,
        state,
      ) as Record<string, unknown>;
    };
    return this;
  }

  /** Sentinel returned by a redaction decision to mean "descend / keep as-is". */
  static readonly #RECURSE: unique symbol = Symbol("redact.recurse");

  /*#__PURE__*/ static #applyMask(
    mask: RedactMask,
    value: unknown,
    key: string,
  ): unknown {
    return typeof mask === "function" ? mask(value, key) : mask;
  }

  /**
   * Whether the walker should descend into `value`. A **plain object**
   * (`{}` / `Object.create(null)`) is always a container, even when empty, so
   * it is preserved as `{}` rather than masked or collapsed. Any **other**
   * object is a container only if it carries its own enumerable keys: a class
   * instance with own fields *is* descended (so a deny/allow list reaches keys
   * nested inside it), while `Date`/`Map`/`Set`/`RegExp` (no own enumerable
   * keys) stay preserved leaves rather than collapsing to `{}`.
   */
  /*#__PURE__*/ static #isWalkable(
    value: unknown,
    reads: { nodes: number },
  ): value is Record<string, unknown> {
    if (value === null || typeof value !== "object" || Array.isArray(value)) {
      return false;
    }
    if (reads.nodes >= MAX_REDACTION_READS) throw REDACTION_READ_CUT;
    reads.nodes++;
    const proto = readPrototype(value);
    if (proto === UNREADABLE_REFLECTION) throw UNREADABLE_REFLECTION;
    if (proto === Object.prototype || proto === null) return true;
    return !BaseError.#redactionKeys(value, reads).next().done;
  }

  /** Guard classification and copying with the same inspection allowance. */
  static *#redactionKeys(
    value: object,
    reads: { nodes: number },
  ): Generator<string> {
    if (reads.nodes >= MAX_REDACTION_READS) throw REDACTION_READ_CUT;
    reads.nodes++;
    const keys = readOwnKeys(value);
    if (keys === UNREADABLE_REFLECTION) throw UNREADABLE_REFLECTION;
    for (const key of keys) {
      if (reads.nodes >= MAX_REDACTION_READS) throw REDACTION_READ_CUT;
      reads.nodes++;
      if (typeof key !== "string") continue;
      const descriptor = readOwnPropertyDescriptor(value, key);
      if (descriptor === UNREADABLE_REFLECTION) throw UNREADABLE_REFLECTION;
      if (descriptor?.enumerable) yield key;
    }
  }

  /**
   * Single deep-clone walker for redaction. Recurses into arrays and objects
   * that carry own enumerable keys (see {@link BaseError.#isWalkable}); every
   * other value (string, `Date`, `Map`, …) is a leaf.
   * `decide(key, value, region)` returns the replacement for a key, or
   * `#RECURSE` to descend into a container / keep a leaf unchanged.
   *
   * `region` classifies where we are, so the allow-list can distinguish the
   * structural envelope from data:
   * - `"root"`: the top-level error envelope (kept verbatim by the allow-list);
   * - `"cause"`: at a `cause`'s top level; the structural envelope keys
   *   (`ENVELOPE_KEYS`) are kept, all other leaves are data;
   * - `"data"`: inside a `details` subtree or a cause's foreign subtree; every
   *   leaf is data.
   *
   * The transition is by key name only, not duck-typing, so a cause that
   * merely resembles a structured error cannot reclassify its data as envelope.
   * The deny-list ignores `region`.
   *
   * A function-valued leaf is never log data and is not passed to `decide`:
   * in an object it is dropped, in an array it becomes `null`, exactly as
   * `JSON.stringify` writes it. This keeps an own `toJSON` out of the clone in
   * both modes; copied as a leaf, the consumer's `JSON.stringify` would call
   * it and re-materialize a masked key.
   *
   * Four bounds keep the walk total on any host stack. The data depth
   * ({@link MAX_DATA_DEPTH}) and the cause-spine depth (`spine`, capped at
   * {@link MAX_CAUSE_DEPTH}) count separately. On the spine an object is one
   * hop, a list is free and each of its container elements is one hop, so a
   * `cause` object, a member of `errors`, and each level of a nested list
   * cost the same. Data depth restarts at each cause node, so a deep chain
   * cannot marker-truncate a shallow `details` on a deep cause, and a spine
   * that a subclass supplies past the serializer's cap ends in a marker.
   * The node budget ({@link MAX_DATA_NODES})
   * counts every value the walk visits in a data region, a container or a
   * leaf. The separate read allowance ({@link MAX_REDACTION_READS}) covers
   * classification, key inspections, and value reads across every region.
   * Its exhaustion uses the safe envelope with the redaction-size message.
   * An uninspected object is never treated as an opaque leaf. When
   * the budget runs out, the data container being walked ends with one size
   * marker in place of the rest, in key order, and every data container not
   * yet entered is the marker. `state.seen` holds the containers on the
   * current path, so a cycle is one marker at its first repeat; a shared
   * reference without a cycle is still cloned once per reference and is
   * bounded by the node budget.
   */
  /*#__PURE__*/ static #redactWalk(
    value: unknown,
    decide: (key: string, value: unknown, region: RedactRegion) => unknown,
    region: RedactRegion,
    depth: number,
    state: {
      nodes: number;
      readonly seen: Set<object>;
      readonly reads: { nodes: number };
      readonly headers?: RedactionStackHeader[];
    },
    key = "",
    spine = 0,
  ): unknown {
    if (!Array.isArray(value) && !BaseError.#isWalkable(value, state.reads)) {
      return value;
    }
    // Preserve serializer cuts; otherwise the redactor diagnoses its own cap.
    // Leaves never recurse, so shallow data is intact.
    if (depth >= MAX_DATA_DEPTH || spine > MAX_CAUSE_DEPTH) {
      return isLogDataDepthCut(value)
        ? copyLogDataDepthCut(value, Array.isArray(value) ? [] : {})
        : REDACTION_DEPTH_MARKER;
    }
    if (state.seen.has(value)) {
      return REDACTION_CYCLE_MARKER;
    }
    // The node budget counts data values. The separate read allowance also
    // bounds root and cause envelope inspection.
    if (region === "data") {
      if (state.nodes >= MAX_DATA_NODES) {
        return REDACTION_SIZE_MARKER;
      }
      state.nodes++;
    }
    state.seen.add(value);
    try {
      if (Array.isArray(value)) {
        // Aggregate members sit on the cause spine (see childPosition). Like
        // the rest of that spine they stay out of the data-depth budget, so a
        // deep aggregate cannot marker-truncate a shallow `details` nested
        // beneath it; each member is one hop on the spine instead.
        const position = childPosition(
          { region, depth, spine },
          true,
          key,
          value,
        );
        // Built index by index into a fresh plain array, so the walk can stop
        // at the budget with one marker in place of the rest.
        const items: unknown[] = [];
        if (state.reads.nodes >= MAX_REDACTION_READS) throw REDACTION_READ_CUT;
        state.reads.nodes++;
        const lengthRead = readPropertyResult(value, "length");
        if (!lengthRead.readable) throw UNREADABLE_REFLECTION;
        const length = lengthRead.value;
        const count =
          typeof length === "number" &&
          Number.isSafeInteger(length) &&
          length >= 0
            ? length
            : 0;
        for (let index = 0; index < count; index++) {
          if (region === "data" && state.nodes >= MAX_DATA_NODES) {
            items.push(REDACTION_SIZE_MARKER);
            break;
          }
          if (state.reads.nodes >= MAX_REDACTION_READS)
            throw REDACTION_READ_CUT;
          state.reads.nodes++;
          const itemRead = readPropertyResult(value, String(index));
          if (!itemRead.readable) throw UNREADABLE_REFLECTION;
          const item = itemRead.value;
          if (Array.isArray(item) || BaseError.#isWalkable(item, state.reads)) {
            items.push(
              BaseError.#redactWalk(
                item,
                decide,
                region,
                position.depth,
                state,
                key,
                position.spine,
              ),
            );
            continue;
          }
          if (region === "data") state.nodes++;
          if (typeof item === "function") {
            items.push(null);
            continue;
          }
          // A leaf inside an array has no key of its own, so it is judged under
          // the key of the array that holds it, in every region. Without this an
          // allow-list keeps every scalar element, which is the opposite of what
          // it promises: an aggregate's members are arbitrary values (a
          // `Promise.allSettled` reason need not be an `Error`), and `errors` is
          // not an envelope key, so a string member is data like any other.
          const slot = String(index);
          const decision =
            region === "cause" &&
            BaseError.#hasSerializerMarker(value, slot, item)
              ? BaseError.#RECURSE
              : decide(key, item, region);
          const redacted = decision === BaseError.#RECURSE ? item : decision;
          if (redacted === item) {
            BaseError.#copySerializerMarker(value, items, slot, item);
          }
          items.push(redacted);
        }
        return copyLogDataDepthCut(value, items);
      }
      // Null-prototype target so an own `__proto__`/`constructor` key from
      // untrusted details is copied as ordinary data (and masked/recursed like
      // any other key) instead of routing through a prototype setter. Matches
      // the null-prototype clones used by the public-error catalog and transport
      // stage. (OWASP Prototype Pollution Prevention.)
      const out = Object.create(null) as Record<string, unknown>;
      const header: RedactionStackHeader | undefined =
        region !== "data" && state.headers !== undefined
          ? { target: out }
          : undefined;
      if (header !== undefined) state.headers?.push(header);
      for (const key of BaseError.#redactionKeys(value, state.reads)) {
        if (region === "data" && state.nodes >= MAX_DATA_NODES) {
          out[key] = REDACTION_SIZE_MARKER;
          break;
        }
        if (state.reads.nodes >= MAX_REDACTION_READS) throw REDACTION_READ_CUT;
        state.reads.nodes++;
        const fieldRead = readPropertyResult(value, key);
        if (!fieldRead.readable) throw UNREADABLE_REFLECTION;
        const val = fieldRead.value;
        if (
          header !== undefined &&
          (key === "name" || key === "message" || key === "stack")
        ) {
          header[key] = val;
        }
        if (typeof val === "function") continue;
        if (
          region === "cause" &&
          BaseError.#hasSerializerMarker(value, key, val)
        ) {
          out[key] = BaseError.#markSerializerMarker(out, key, val);
          continue;
        }
        // A leaf's keep/mask decision is made in the region it *lives in* (the
        // parent); the child region only governs recursion. Conflating the two
        // wrongly masks a region-transition key that holds a leaf (e.g. a
        // top-level `cause: undefined`).
        const decision = decide(key, val, region);
        if (decision === BaseError.#RECURSE) {
          if (Array.isArray(val) || BaseError.#isWalkable(val, state.reads)) {
            const position = childPosition(
              { region, depth, spine },
              false,
              key,
              val,
            );
            out[key] = BaseError.#redactWalk(
              val,
              decide,
              position.region,
              position.depth,
              state,
              key,
              position.spine,
            );
          } else {
            if (region === "data") state.nodes++;
            out[key] = val;
          }
        } else {
          if (region === "data") state.nodes++;
          out[key] = decision;
        }
        if (out[key] === val) {
          BaseError.#copySerializerMarker(value, out, key, val);
        }
      }
      return copyLogDataDepthCut(value, out);
    } finally {
      state.seen.delete(value);
    }
  }

  // Strings cannot carry provenance. Track the emitted slot and exact value
  // privately, so a consumer's matching string or changed slot is still data.
  static readonly #serializerMarkers = new WeakMap<
    object,
    Map<string, string>
  >();

  /*#__PURE__*/ static #hasSerializerMarker(
    holder: object,
    key: string,
    value: unknown,
  ): value is string {
    return (
      typeof value === "string" &&
      BaseError.#serializerMarkers.get(holder)?.get(key) === value
    );
  }

  /*#__PURE__*/ static #markSerializerMarker(
    holder: object,
    key: string,
    marker: string,
  ): string {
    let markers = BaseError.#serializerMarkers.get(holder);
    if (markers === undefined) {
      markers = new Map();
      BaseError.#serializerMarkers.set(holder, markers);
    }
    markers.set(key, marker);
    return marker;
  }

  /*#__PURE__*/ static #copySerializerMarker(
    source: object,
    target: object,
    key: string,
    value: unknown,
  ): void {
    if (BaseError.#hasSerializerMarker(source, key, value)) {
      BaseError.#markSerializerMarker(target, key, value);
    }
  }

  /**
   * Sets a custom redactor applied to the full log object. Use for allow-lists
   * or scrubbing the technical `message`. Sticky; the last redactor wins.
   * Consumer copies do not transfer serializer-marker provenance. An outer
   * redactor treats copied marker strings as data under its normal key policy.
   *
   * ⚠️ Scope: applies to the **log object** only. A custom redactor cannot be
   * mapped onto the one-line {@link toString} render, so `toString`,
   * `err.stack`, and `console.log(err)` inspection keep the raw technical
   * message even when the redactor scrubs it from the log.
   */
  public redactWith(
    redactor: (log: Record<string, unknown>) => Record<string, unknown>,
  ): this {
    this.#messageMask = undefined;
    this.#redactor = redactor;
    return this;
  }

  /**
   * Assembles the raw log object (no redaction). The public {@link toLogObject}
   * applies redaction to the complete assembled object.
   *
   * Existing overrides and `super.buildLogObject()` calls remain supported
   * during migration. An override runs at the root only.
   *
   * Forward the optional `buildBase` continuation through `super` to share
   * this build's allowance. Calling `super` without it starts a bounded sub-build.
   *
   * @deprecated Override {@link buildOwnLogFields} to contribute data fields.
   * Reshape the completed log in the consumer's logging adapter instead.
   */
  protected buildLogObject(
    buildBase?: () => Record<string, unknown>,
  ): Record<string, unknown> {
    return buildBase === undefined
      ? this.#baseLogObject(BaseError.#newLogContext())
      : buildBase();
  }

  #baseLogObject(context: LogBuildContext): Record<string, unknown> {
    const { name, message, timestamp, timestampIso, stack } = this;
    const ownProperties = this as unknown as Record<string, unknown>;
    const cause = ownProperties.cause;

    const json: Record<string, unknown> = {
      name,
      message, // The original technical message
      timestamp,
      timestampIso,
      stack,
    };
    json.cause = this.#serializeCause(
      cause,
      new Set(),
      0,
      json,
      "cause",
      context,
    );

    // A subclass that aggregates failures carries them in `errors`, the field
    // a native `AggregateError` uses. Read by shape, so any such subclass gets
    // the same bounded, cycle-safe serialization as an aggregate cause.
    const aggregate = readMembers(this, MAX_AGGREGATE_MEMBERS);
    if (aggregate !== undefined && aggregate.total > 0) {
      json.errors = this.#serializeAggregate(
        aggregate,
        new Set([this]),
        1,
        context,
      );
    }

    return json;
  }

  /**
   * Serialises the error for logs. Includes technical message, stack and cause,
   * with the instance redactor applied (see {@link redact} / {@link redactWith}).
   *
   * A cause that is a BaseError of the same realm and carries its own sticky
   * policy is masked by that policy first, over its node and everything
   * beneath it, and this error's redactor walks the result afterwards. This
   * holds for a nested cause and for an aggregate member alike. A cause from
   * another realm (a worker boundary, a second copy of the package) and a
   * Proxy around a BaseError carry no reachable policy and are logged like a
   * foreign error.
   *
   * During data serialization, nested errors keep a primitive diagnostic
   * envelope and their sticky policy, without restarting hooks or traversal.
   *
   * ⚠️ This is a **log** serialization: it carries the technical message, stack,
   * cause chain and raw `details`. **Never return it to a client.** Anything that
   * auto-serializes the error (`JSON.stringify`, `res.json(err)`, `Response.json`,
   * `return err`) reaches {@link toJSON}, which is an alias of this method, and
   * leaks the same payload. For client-safe output use the `public-error`
   * subpath (`@shirudo/base-error/public-error`, `project`), which projects only
   * an allow-listed, message-free public view.
   */
  public toLogObject(): Record<string, unknown> {
    const context = BaseError.#newLogContext();
    const raw = this.#assembleLogObject(context);
    Object.assign(raw, this.#nodeOwnFields(this, context));
    return this.#redactor
      ? BaseError.#redactFailClosed(this.#redactor, raw)
      : raw;
  }

  static #newLogContext(): LogBuildContext {
    return createLogBuildContext((value) =>
      BaseError.#sameRealm(value) ? value.#dataErrorEnvelope() : undefined,
    );
  }

  /** Nested data errors retain diagnostics without invoking hooks or links. */
  #dataErrorEnvelope(): Record<string, unknown> {
    const log: Record<string, unknown> = {};
    for (const key of [...BaseError.#SAFE_TRIAGE_KEYS, "message", "stack"]) {
      const value = readProperty(this, key);
      if (
        value === null ||
        typeof value === "string" ||
        typeof value === "boolean" ||
        (typeof value === "number" && Number.isFinite(value))
      )
        log[key] = value;
    }
    return this.#redactor
      ? BaseError.#redactFailClosed(this.#redactor, log)
      : log;
  }

  /**
   * The fields this error contributes to its own log object, beyond the
   * envelope this class writes. Override this to add fields; return a fresh
   * record and nothing else.
   * Use {@link OwnLogFields} as the override's return type to check data fields.
   * The base signature accepts unknown values for compatibility and runtime guards.
   * The hook must finish synchronously; its work is not bounded by the serializer.
   *
   * This is the hook the serializer can reach on a **cause**, so fields added
   * here survive at every depth of every chain that wraps this error, while
   * fields added by overriding {@link buildLogObject} appear at the root only.
   * That is the reason the narrow hook exists.
   *
   * The contract, because the caller is a logging path that must not throw
   * and must stay bounded:
   *
   * - it takes no arguments, so an error describes itself the same way
   *   wherever it sits in a chain;
   * - it must not walk a cause chain and must not log another error;
   * - every key that carries a name this library writes is dropped rather
   *   than obeyed, and {@link RESERVED_NODE_KEYS} is the list;
   * - a node carries at most {@link MAX_OWN_LOG_FIELDS} of these fields, and
   *   the reader stops there;
   * - a throw, or a return that is not a record, costs these fields and never
   *   the node. A getter that throws costs its own key only;
   * - every value is copied as data (see {@link serializeLogData}),
   *   so the log shares no reference with the error.
   *
   * That copy follows JSON value conversions. A `Date` becomes its ISO string, a `Map`
   * becomes `{}`, and a bigint becomes its decimal string. The same values
   * passed through untouched when the fields were added by overriding
   * {@link buildLogObject}.
   *
   * Rejected keys and values are omitted. Exhausting the shared log budget
   * replaces a field with the log-size marker, which remains data under redaction.
   *
   * Everything returned here is logged wherever this error is logged. Treat it
   * as the place to put identifiers, not payloads.
   */
  protected buildOwnLogFields(): Record<string, unknown> {
    return {};
  }

  /** Private brands reject foreign instances and proxies without walking prototypes. */
  static #sameRealm(value: unknown): value is BaseError<string> {
    if (typeof value !== "object" || value === null) return false;
    // eslint-disable-next-line no-restricted-syntax -- Private brands invoke no foreign reads or Proxy traps.
    return #redactor in value;
  }

  /**
   * The own fields a node carries: the hook's record with the library's own
   * key names removed, each value copied as data, cut at the width cap. One
   * reader for the root and for a cause, so both positions carry the same
   * fields under the same rules.
   */
  /*#__PURE__*/ #nodeOwnFields(
    value: unknown,
    context: LogBuildContext,
  ): Record<string, unknown> {
    if (!BaseError.#sameRealm(value)) {
      return {};
    }
    // Null-prototype target, so an own `__proto__` from a hook is copied as
    // ordinary data instead of routing through a prototype setter. Matches
    // the clone target of the redaction walker.
    const out = Object.create(null) as Record<string, unknown>;
    try {
      // The record is foreign data, not just the call that produced it: a
      // getter on it throws, a Proxy trap on it throws, and reading its keys
      // or its prototype throws. All of that stays inside this one try, so a
      // hostile record costs these fields and never the node.
      const fields: unknown = value.buildOwnLogFields();
      if (
        typeof fields !== "object" ||
        fields === null ||
        Array.isArray(fields)
      ) {
        return {};
      }
      const record = fields as Record<string, unknown>;
      let taken = 0;
      for (const key of readOwnEnumerableKeys(
        record,
        MAX_OWN_LOG_FIELDS_READ,
        context.budget,
      )) {
        if (taken >= MAX_OWN_LOG_FIELDS) break;
        if (RESERVED_NODE_KEYS.has(key)) continue;
        // Read through the guarded reader, so one throwing getter costs its
        // own key and leaves every sibling already collected in place.
        const item = readProperty(record, key);
        // Own fields describe the node. Error relationships belong in cause.
        // Nested data errors use a shallow diagnostic view in serializeLogData.
        if (BaseError.#sameRealm(item) || BaseError.#isNativeError(item)) {
          continue;
        }
        const data = serializeLogData(item, context);
        if (data === undefined) continue;
        out[key] = data;
        taken++;
      }
    } catch {
      // A throw mid-enumeration keeps whatever was already collected.
    }
    return out;
  }

  /** Copy once, in source order, with safe own writes even for __proto__. */
  #copyLogRecord(record: Record<string, unknown>): {
    fields: Record<string, unknown> | undefined;
    cut: boolean;
  } {
    const envelopeKeys = [...ROOT_ENVELOPE_KEYS, "errors"];
    const keys = readOwnKeys(record);
    if (keys === UNREADABLE_REFLECTION)
      return { fields: undefined, cut: false };
    const limit = MAX_LOG_OBJECT_KEYS_READ - envelopeKeys.length;
    // Short-circuit wide inputs to bound the tail scan by the envelope width.
    const cut =
      keys.length > MAX_LOG_OBJECT_KEYS_READ ||
      keys.slice(limit).some((key) => !envelopeKeys.includes(key as string));
    const copied = Object.create(null) as Record<string, unknown>;
    let defined = false;
    for (let index = 0; index < keys.length && index < limit; index++) {
      const key = keys[index];
      if (typeof key !== "string") continue;
      const descriptor = readOwnPropertyDescriptor(record, key);
      if (
        descriptor === undefined ||
        descriptor === UNREADABLE_REFLECTION ||
        !descriptor.enumerable
      )
        continue;
      const value = readProperty(record, key);
      copied[key] = value;
      if (value !== undefined) defined = true;
    }
    // The fixed envelope remains reachable beyond the custom-key allowance.
    for (const key of envelopeKeys) {
      if (Object.prototype.hasOwnProperty.call(copied, key)) continue;
      const value = readOwnProperty(record, key);
      if (value !== undefined) {
        copied[key] = value;
        defined = true;
      }
    }
    // Spread creates own data properties and preserves the public prototype.
    return { fields: defined ? { ...copied } : undefined, cut };
  }

  /**
   * The envelope as the subclass chain builds it, with the totality contract
   * of this path. {@link buildLogObject} may be overridden, and an override is
   * code this library did not write, running inside `catch`, where a new
   * exception destroys the error the caller set out to log.
   *
   * The fallback keeps what it can. The envelope this class builds carries
   * `name`, `message`, `stack` and the bounded cause chain, and no subclass
   * contributed to it, so a broken override costs its own shaping.
   * When that envelope throws as well, a field of the instance
   * is hostile, and only the guarded triage envelope remains.
   */
  /*#__PURE__*/ #assembleLogObject(
    context: LogBuildContext,
  ): Record<string, unknown> {
    let cut = false;
    const finish = (log: Record<string, unknown>): Record<string, unknown> => {
      if (cut) {
        log.message =
          typeof log.message === "string" && log.message.length > 0
            ? `${log.message} ${MAX_LOG_SIZE_MARKER}`
            : MAX_LOG_SIZE_MARKER;
      }
      return log;
    };
    try {
      const built: unknown = this.buildLogObject(() =>
        this.#baseLogObject(context),
      );
      // An override can return the wrong shape as easily as it can throw: a
      // missing `return` yields undefined, and a primitive would be handed
      // to a caller whose contract says record. Both count as a failure.
      // A record, not merely an object: a `Date`, a `Map` and an array all
      // pass a `typeof` test and carry nothing this library can read, so
      // accepting one would erase the error rather than log it.
      if (
        typeof built === "object" &&
        built !== null &&
        !Array.isArray(built)
      ) {
        const copied = this.#copyLogRecord(built as Record<string, unknown>);
        cut = copied.cut;
        if (copied.fields !== undefined) return finish(copied.fields);
      }
    } catch {
      // The override failed. Fall through to the envelope it could not reach.
    }
    try {
      // The base envelope skips the whole subclass chain, so the structural
      // fields a subclass declares are read from the instance, exactly as the
      // triage envelope below reads them. Without this the milder failure
      // loses the machine-readable code that the worse one keeps.
      const base = this.#baseLogObject(context);
      for (const key of BaseError.#SAFE_TRIAGE_KEYS) {
        if (base[key] !== undefined) continue;
        const value = BaseError.#serializeEnvelopeField(
          readProperty(this, key),
          context,
        );
        if (value !== undefined) base[key] = value;
      }
      return finish(base);
    } catch {
      // A field of the instance itself throws. Read the rest defensively.
    }
    return finish(this.#triageLogObject(context));
  }

  /**
   * The last envelope: what this class can read off the instance itself when
   * everything an override touched has failed. Every read is guarded and every
   * value is copied as data, so this cannot throw and cannot hand a consumer's
   * `JSON.stringify` a value it refuses.
   */
  /*#__PURE__*/ #triageLogObject(
    context: LogBuildContext,
  ): Record<string, unknown> {
    const triage: Record<string, unknown> = { message: "[log build failed]" };
    for (const key of BaseError.#SAFE_TRIAGE_KEYS) {
      const value = BaseError.#serializeEnvelopeField(
        readProperty(this, key),
        context,
      );
      if (value !== undefined) {
        triage[key] = value;
      }
    }
    return triage;
  }

  /**
   * Runs a redactor over a log object. Fail-closed: a broken redactor must
   * neither crash the logging path nor leak the unredacted payload, so a
   * throw replaces the object with the triage envelope (message, stack,
   * details, and cause are dropped; only the non-sensitive structural fields
   * survive). Read exhaustion uses the redaction-size message instead of a
   * failure diagnosis. Shared by the root log object and by every cause node that
   * carries its own policy, so one node's broken redactor costs that node
   * and nothing above it.
   */
  /*#__PURE__*/ static #redactFailClosed(
    redactor: (log: Record<string, unknown>) => Record<string, unknown>,
    raw: Record<string, unknown>,
  ): Record<string, unknown> {
    try {
      return redactor(raw);
    } catch (error) {
      const safe: Record<string, unknown> = {
        message:
          error === REDACTION_READ_CUT
            ? REDACTION_SIZE_MARKER
            : "[log redaction failed]",
      };
      // Guarded reads: `raw` came from a subclass override, so a getter on it
      // can throw, and this is the one path that must never throw.
      for (const key of BaseError.#SAFE_TRIAGE_KEYS) {
        const value = readOwnProperty(raw, key);
        const type =
          key === "retryable"
            ? "boolean"
            : key === "timestamp"
              ? "number"
              : "string";
        if (
          typeof value !== type &&
          !(key === "code" && typeof value === "number")
        )
          continue;
        if (typeof value === "number" && !Number.isFinite(value)) continue;
        safe[key] = value;
      }
      return safe;
    }
  }

  /**
   * The sticky redactor of `value`, when `value` is a BaseError of this realm.
   * A foreign instance or Proxy lacks this class's private brand and carries
   * no reachable policy. The brand check does not inspect prototypes.
   */
  /*#__PURE__*/ static #redactorOf(
    value: unknown,
  ): ((log: Record<string, unknown>) => Record<string, unknown>) | undefined {
    return BaseError.#sameRealm(value) ? value.#redactor : undefined;
  }

  /**
   * Non-sensitive structural fields preserved in the fail-closed redaction
   * marker. Only the fields the log object actually
   * carries are copied, through the guarded reader, so `code`/`category`/`retryable` appear
   * for a `StructuredError` but are simply absent for a plain `BaseError`.
   */
  static readonly #SAFE_TRIAGE_KEYS = [
    "name",
    "code",
    "category",
    "retryable",
    "timestamp",
    "timestampIso",
  ] as const;

  /**
   * JSON serialization for logging-oriented consumers. Alias of
   * {@link toLogObject}, so it returns the same **log** shape: technical message,
   * stack, cause chain and raw `details`.
   *
   * ⚠️ Because `JSON.stringify(err)`, `res.json(err)`, `Response.json(err)` and
   * `return err` all route through `toJSON`, sending an error down any of those
   * paths leaks the full technical payload to the client. **Never serialize an
   * error straight into a response.** Produce a client payload through the
   * `public-error` subpath (`project` / `toProblem`) instead. This shape is also
   * the input that {@link StructuredError.fromJSON} reconstructs, which is why it
   * intentionally retains the stack and cause chain.
   */
  public toJSON(): Record<string, unknown> {
    return this.toLogObject();
  }

  /**
   * Readable one-liner plus the nested cause chain. For a chain of error
   * objects it is bounded exactly like the log object: the same cause nodes
   * are rendered, and past the cap the chain ends with the same depth marker.
   * A plain-object cause carries its data fields in the log object. This
   * render follows its `cause` links and ends them at the cap. Honors a deny-listed
   * `"message"` (see {@link redact}) per BaseError in the chain; other
   * redaction shapes rewrite only the log object.
   */
  public override toString(): string {
    return BaseError.#renderChain(this, new Set<unknown>(), "", 0, 0).join(
      "\n",
    );
  }

  /**
   * Renders one cause chain into lines. A node that carries aggregate members
   * gets a count on its own line, and each member is rendered as its own
   * chain, indented one level deeper. The `seen` set is shared across the whole
   * tree, so a cycle or a repeated branch ends with a marker instead of
   * recursing.
   *
   * `depth` is the serializer depth of `start`, and `causeDepth` is the depth
   * at which its `cause` lands. The two differ only at the root: the log
   * serializer starts the root's `cause` at depth 0 and the root's members at
   * depth 1, and every cause node puts both one level below itself. Both
   * counters mirror {@link BaseError.#serializeCauseNode}, so for a chain of
   * error objects `toString()` shows the same nodes as `toLogObject()` and
   * cuts at the same marker. For a plain-object cause, the serializer also
   * copies its data fields and cuts deep containers without a marker.
   */
  /*#__PURE__*/ static #renderChain(
    start: unknown,
    seen: Set<unknown>,
    indent: string,
    depth: number,
    causeDepth: number,
  ): string[] {
    // Aggregates recurse, and a string render must never throw: bound the
    // nesting with the same cap the log serializer uses, so a pathologically
    // deep tree degrades to a marker instead of overflowing the host stack
    // (which is far smaller on an edge isolate than on Node).
    if (depth >= MAX_CAUSE_DEPTH) {
      return [`${indent}${MAX_CAUSE_DEPTH_MARKER}`];
    }
    const lines: string[] = [];
    let current: unknown = start;
    let nodeDepth = depth;
    let nextCauseDepth = causeDepth;
    let first = true;

    while (current != null) {
      const prefix = first ? indent : `${indent}Caused by: `;
      first = false;

      if (seen.has(current)) {
        lines.push(`${prefix}${CIRCULAR_CAUSE_CHAIN_MARKER}`);
        break;
      }
      seen.add(current);

      const aggregate = readMembers(current, MAX_AGGREGATE_MEMBERS);
      const total = aggregate === undefined ? 0 : aggregate.total;
      const suffix = total > 0 ? ` (+${total} aggregated)` : "";
      lines.push(`${prefix}${BaseError.#renderNode(current)}${suffix}`);

      const shown = aggregate === undefined ? [] : aggregate.members;
      for (const member of shown) {
        const rendered = BaseError.#renderChain(
          member,
          seen,
          `${indent}    `,
          nodeDepth + 1,
          nodeDepth + 2,
        );
        // The head of a member is bulleted at the parent's indent; its own
        // chain keeps the deeper indent, so the tree stays readable. Appended
        // one by one: a spread of an unbounded chain exceeds the argument
        // limit, which is another way for a string render to throw.
        for (let index = 0; index < rendered.length; index++) {
          const line = rendered[index] as string;
          lines.push(index === 0 ? `${indent}  - ${line.trimStart()}` : line);
        }
      }
      if (total > shown.length) {
        lines.push(
          `${indent}  ${moreAggregatedErrorsMarker(total - shown.length)}`,
        );
      }

      // The linear spine is bounded the way the serializer bounds it: a cause
      // that would land past the cap is the depth marker, and a missing or
      // null cause ends the chain without one. Only the hops up to the cap
      // are read, so the length of the chain never sets the cost.
      const cause = readProperty(current, "cause");
      if (cause != null && nextCauseDepth >= MAX_CAUSE_DEPTH) {
        lines.push(`${indent}Caused by: ${MAX_CAUSE_DEPTH_MARKER}`);
        break;
      }
      current = cause;
      nodeDepth = nextCauseDepth;
      nextCauseDepth++;
    }

    return lines;
  }

  /**
   * One node as a single line, honoring a deny-listed `message`. A native
   * error and an error-shaped plain object (string `name` and `message`)
   * render as `name: message`. A string render runs in catch paths and must
   * not throw: a foreign `name`/`message` that throws falls back to the
   * `Error.prototype` defaults, and a value with no string form at all (a
   * null-prototype object, a throwing `Symbol.toPrimitive`) renders as a
   * marker.
   */
  /*#__PURE__*/ static #renderNode(node: unknown): string {
    try {
      if (node instanceof BaseError) {
        return `[${node.name}] ${node.#renderMessage()}`;
      }
      if (BaseError.#isNativeError(node)) {
        const name = readProperty(node, "name") ?? "Error";
        const message = readProperty(node, "message") ?? "";
        return `${String(name)}: ${String(message)}`;
      }
      // A plain object shaped like an error (a revived or cloned error at a
      // worker boundary) reads as its name and message, not as
      // "[object Object]".
      const name = readProperty(node, "name");
      const message = readProperty(node, "message");
      if (typeof name === "string" && typeof message === "string") {
        return `${name}: ${message}`;
      }
      return String(node);
    } catch {
      return "[Unrenderable cause]";
    }
  }

  /**
   * Whether `value` is a native `Error` from any realm. `instanceof` is
   * realm-bound: an error from a worker, a `vm` context, an iframe, or a second
   * copy of this package fails it and would fall to the plain-object path,
   * which drops the non-enumerable `name`/`message`/`stack` and logs `{}`.
   * `Error.isError` (where the runtime has it) reads the `[[ErrorData]]`
   * slot; the `Object.prototype.toString` fallback approximates it. A plain
   * object that merely *looks* like an error is deliberately not matched: its
   * fields are enumerable, and the plain-object path keeps all of them.
   *
   * A string `Symbol.toStringTag` drives `Object.prototype.toString`, so for
   * a tag carrier the brand probes are consulted only when the value is at
   * least error-shaped (string `name` and `message`, the same shape `isError`
   * requires): a tagged non-error is data whatever a patched `Error.isError`
   * says, while a genuine cross-realm Error that carries a tag (a subclass
   * can add one) stays recognized on every runtime. The accepted residual: a
   * tagged, error-shaped forgery takes the native path and keeps only the
   * envelope. `Error.isError` runs inside its own try, and a broken patched
   * implementation falls through to the `toString` probe.
   */
  /*#__PURE__*/ static #isNativeError(value: unknown): value is Error {
    if (value instanceof Error) return true;
    if (typeof value !== "object" || value === null) return false;
    try {
      if (
        readProperty(value, Symbol.toStringTag) !== undefined &&
        (typeof readProperty(value, "name") !== "string" ||
          typeof readProperty(value, "message") !== "string")
      ) {
        return false;
      }
      const ErrorCtor = Error as { isError?: (value: unknown) => boolean };
      if (typeof ErrorCtor.isError === "function") {
        try {
          return ErrorCtor.isError(value) === true;
        } catch {
          // A broken patched Error.isError falls through to the probe below.
        }
      }
      return Object.prototype.toString.call(value) === "[object Error]";
    } catch {
      return false;
    }
  }

  // ----------------------------------------------------------------
  // Internal helpers
  // ----------------------------------------------------------------

  /**
   * The message as {@link toString} renders it: masked when a deny-list
   * covers `"message"`, verbatim otherwise. Fail-closed: a throwing function
   * mask yields the default marker, never the raw message.
   */
  /*#__PURE__*/ #renderMessage(): string {
    if (this.#messageMask === undefined) {
      return this.message;
    }
    try {
      return String(
        BaseError.#applyMask(this.#messageMask, this.message, "message"),
      );
    } catch {
      return "[REDACTED]";
    }
  }

  /**
   * The `stack` of one node whose message is deny-listed. A header that is
   * the node's own `name: message` (or the bare `name` that V8 writes for an
   * empty message) is replaced by the masked message, and the frames after
   * it stay. Any other stack goes to the mask as a whole, under the key
   * `stack`, because the library cannot prove that the message is absent
   * from it: a foreign error can carry a header from an earlier name or
   * message, and some engines write no header at all.
   */
  /*#__PURE__*/ static #maskStackHeader(
    stack: string,
    name: unknown,
    message: unknown,
    mask: RedactMask,
  ): unknown {
    if (typeof name === "string" && typeof message === "string") {
      const headers =
        message === "" ? [`${name}: `, name] : [`${name}: ${message}`];
      for (const header of headers) {
        if (stack === header || stack.startsWith(`${header}\n`)) {
          const maskedMessage = String(
            BaseError.#applyMask(mask, message, "message"),
          );
          return `${name}: ${maskedMessage}${stack.slice(header.length)}`;
        }
      }
    }
    return BaseError.#applyMask(mask, stack, "stack");
  }

  /**
   * Sets the cause property as non-enumerable (like native Error.cause).
   *
   * Uses Object.defineProperty instead of native `new Error(msg, { cause })`
   * for universal compatibility. This approach works across all runtimes
   * (Node.js 14+, Deno, Cloudflare Workers, browsers) without version detection,
   * since Object.defineProperty is ES5 and universally supported.
   */
  /*#__PURE__*/ #setCause(cause: unknown): void {
    try {
      Object.defineProperty(this, "cause", {
        value: cause,
        configurable: true,
        writable: true,
        enumerable: false,
      });
    } catch {
      // Fallback for environments where defineProperty fails
      const ownProperties = this as unknown as Record<string, unknown>;
      ownProperties.cause = cause;
    }
  }

  /**
   * Intelligently serializes the cause for JSON output.
   * Preserves stack traces, StructuredError fields, and nested data. Every
   * field taken off a native error is copied as data (see serializeLogData),
   * so the log object shares no reference with the cause and the consumer's
   * `JSON.stringify` never meets a bigint or a cycle the cause carried.
   * Uses a seen set to detect circular cause chains, and a depth bound so an
   * acyclic-but-very-deep chain is capped instead of recursing unbounded.
   *
   * Total per node: each foreign read is guarded, and a value that still
   * defeats serialization (a Proxy whose traps throw) becomes a marker, so one
   * hostile node costs its own entry in the log and nothing else.
   *
   * A node that is a BaseError of this realm with a sticky redaction policy
   * is masked by that policy, subtree included, before it is returned (see
   * {@link BaseError.#redactorOf}). A throwing policy collapses that node to
   * the triage envelope and nothing above it.
   */
  /*#__PURE__*/ #serializeCause(
    cause: unknown,
    seen: Set<unknown>,
    depth: number,
    holder: object,
    key: string,
    context: LogBuildContext,
  ): unknown {
    try {
      return this.#serializeCauseNode(cause, seen, depth, holder, key, context);
    } catch {
      return BaseError.#markSerializerMarker(
        holder,
        key,
        UNSERIALIZABLE_CAUSE_MARKER,
      );
    }
  }

  /*#__PURE__*/ #serializeCauseNode(
    cause: unknown,
    seen: Set<unknown>,
    depth: number,
    holder: object,
    key: string,
    context: LogBuildContext,
  ): unknown {
    if (cause === undefined || cause === null) {
      return cause;
    }

    if (context.budget.nodes >= MAX_LOG_NODES) {
      return BaseError.#markSerializerMarker(holder, key, MAX_LOG_SIZE_MARKER);
    }

    context.budget.nodes++;

    if (depth >= MAX_CAUSE_DEPTH) {
      return BaseError.#markSerializerMarker(
        holder,
        key,
        MAX_CAUSE_DEPTH_MARKER,
      );
    }

    if (BaseError.#isNativeError(cause)) {
      if (seen.has(cause)) {
        return BaseError.#markSerializerMarker(
          holder,
          key,
          CIRCULAR_CAUSE_CHAIN_MARKER,
        );
      }
      seen.add(cause);

      // Every field is a foreign read: a cause is whatever the caller threw,
      // and this runs in a catch path, so a throwing getter reads as absent.
      // Every value is copied as data (see serializeLogData): the log object
      // must not share a reference with the cause, and the consumer's
      // JSON.stringify must not meet a bigint or a cycle the cause carried.
      const serialized: Record<string, unknown> = {
        name: BaseError.#serializeEnvelopeField(
          readProperty(cause, "name"),
          context,
        ),
        message: BaseError.#serializeEnvelopeField(
          readProperty(cause, "message"),
          context,
        ),
        stack: BaseError.#serializeEnvelopeField(
          readProperty(cause, "stack"),
          context,
        ),
      };

      // Preserve StructuredError fields if present (duck-typing). This is the
      // only route for a foreign cause: a plain `Error` carrying these fields,
      // a cross-realm instance and a Proxy have no reachable hook to ask.
      for (const key of ["code", "category", "retryable", "details"]) {
        const value =
          key === "details"
            ? serializeLogData(readProperty(cause, key), context)
            : BaseError.#serializeEnvelopeField(
                readProperty(cause, key),
                context,
              );
        if (value !== undefined) serialized[key] = value;
      }

      // A cause of this realm says what it is, through the one hook a fixed
      // roster cannot replace. The library's own key names win, so a hook
      // cannot forge an envelope field or a bounded link, and every value is
      // copied as data like the rest of the node.
      Object.assign(serialized, this.#nodeOwnFields(cause, context));

      // An aggregate's members (`AggregateError.errors`, and any error-like
      // value carrying the same shape) are own but **non-enumerable** on every
      // supported runtime, so `JSON.stringify` and `Object.entries` drop them
      // exactly like `message`/`stack`. Read explicitly, by shape rather than
      // by `instanceof AggregateError`, so cross-realm and custom fan-out
      // errors serialize too. Without this the branch failures that produced
      // the error never reach the log at all.
      const aggregate = readMembers(cause, MAX_AGGREGATE_MEMBERS);
      if (aggregate !== undefined && aggregate.total > 0) {
        serialized.errors = this.#serializeAggregate(
          aggregate,
          seen,
          depth + 1,
          context,
        );
      }

      // Recursively serialize nested causes
      const nested = readProperty(cause, "cause");
      if (nested !== undefined) {
        serialized.cause = this.#serializeCause(
          nested,
          seen,
          depth + 1,
          serialized,
          "cause",
          context,
        );
      }

      // The cause's own sticky policy runs last, over the node and the subtree
      // serialized above it, so it covers the cause's descendants exactly as
      // it does when the cause logs itself. Bottom-up by construction: every
      // deeper node applied its own policy first. The enclosing error's
      // redactor walks the result afterwards.
      const redactor = BaseError.#redactorOf(cause);
      return redactor === undefined
        ? serialized
        : BaseError.#redactFailClosed(redactor, serialized);
    }

    // A cause that is not an error is data.
    return serializeLogData(cause, context, "cause", depth);
  }

  /** The fixed envelope must never turn a scalar decision into a size marker. */
  static #serializeEnvelopeField(
    value: unknown,
    context: LogBuildContext,
  ): unknown {
    if (context.budget.nodes >= context.budget.limit) {
      if (
        value === null ||
        typeof value === "string" ||
        typeof value === "boolean" ||
        typeof value === "number"
      )
        return value;
      // An exhausted envelope omits other values instead of forging a scalar.
      return undefined;
    }
    return serializeLogData(value, context);
  }

  /**
   * Serializes an aggregate's members. The reader already capped them at
   * {@link MAX_AGGREGATE_MEMBERS}; the count it reports marks the
   * remainder. Members share the enclosing `seen` set, so an error reachable
   * from more than one branch is rendered at its first occurrence and marked
   * afterwards, and the walk terminates on a self-referencing aggregate.
   */
  /*#__PURE__*/ #serializeAggregate(
    aggregate: AggregateMembers,
    seen: Set<unknown>,
    depth: number,
    context: LogBuildContext,
  ): unknown[] {
    const serialized: unknown[] = [];
    for (const error of aggregate.members) {
      if (context.budget.nodes >= MAX_LOG_NODES) {
        serialized.push(
          BaseError.#markSerializerMarker(
            serialized,
            String(serialized.length),
            MAX_LOG_SIZE_MARKER,
          ),
        );
        return serialized;
      }
      serialized.push(
        this.#serializeCause(
          error,
          seen,
          depth,
          serialized,
          String(serialized.length),
          context,
        ),
      );
    }

    const dropped = aggregate.total - serialized.length;
    if (dropped > 0) {
      serialized.push(
        BaseError.#markSerializerMarker(
          serialized,
          String(serialized.length),
          moreAggregatedErrorsMarker(dropped),
        ),
      );
    }
    return serialized;
  }

  /**
   * Captures the stack now but defers symbolization and filtering to the
   * first read. V8 formats stacks lazily (via `Error.prepareStackTrace`) only
   * when `stack` is accessed; reading it in the constructor would force that
   * work for every error, including ones that are caught and never logged. So
   * the raw capture lands on a side holder, and `this.stack` becomes a
   * memoizing accessor: the first get symbolizes, filters, and replaces
   * itself with a plain writable data property; a set before the first get
   * (a rehydrated or user-assigned stack) wins unfiltered.
   *
   * This capture duplicates the one `super()` already performed, and that is
   * deliberate: both remedies measure or behave worse. Suppressing the first
   * capture with `Error.stackTraceLimit = 0` around `super()` deopts V8's
   * capture fast path process-wide (measured on Node 24: construction 4x
   * slower, and plain `new Error` slower for the rest of the process). And
   * the frames `super()` captured cannot replace the holder's: on V8 11
   * (Node 20) reading their descriptor materializes them eagerly, and on
   * V8 12+ they lack the constructor trimming `captureStackTrace` gives the
   * holder. The unread first capture costs ~1 microsecond and is discarded
   * unformatted (see the `delete` below).
   */
  /*#__PURE__*/ #installLazyStack(): void {
    // Cast Error to our local interface for type-safe access.
    const V8Error = Error as V8ErrorConstructor;

    let readRawStack: () => string | undefined;
    if (typeof V8Error.captureStackTrace === "function") {
      // V8: capture onto a plain holder, not `this`, so the engine-lazy stack
      // stays unformatted until our getter reads it. The holder's own header
      // is discarded by #filterInternalFrames, which writes `name: message`.
      const holder: { stack?: string } = {};
      V8Error.captureStackTrace(
        holder,
        this.constructor as (...args: unknown[]) => unknown,
      );
      readRawStack = () => holder.stack;
    } else {
      // Non-V8 engines build the stack string eagerly at throw; only the
      // filtering is deferrable here.
      let tempStack: string | undefined;
      try {
        throw new Error();
      } catch (e) {
        const thrown = e as Error;
        tempStack = thrown.stack;
      }
      readRawStack = () => tempStack;
    }

    const install = (value: string | undefined): void => {
      Object.defineProperty(this, "stack", {
        value,
        writable: true,
        configurable: true,
        enumerable: false,
      });
    };
    // The engine-managed `stack` that `super()` captured is removed, not
    // redefined over: on V8 11 (Node 20) redefining it materializes the held
    // stack first, which calls `Error.prepareStackTrace` eagerly for frames
    // nobody reads. `delete` discards them without formatting on every
    // engine; V8 12+ (`stack` as a plain accessor pair) needs neither.
    const ownStack = this as { stack?: string };
    delete ownStack.stack;
    Object.defineProperty(this, "stack", {
      configurable: true,
      enumerable: false,
      get: (): string | undefined => {
        const filtered = this.#filterInternalFrames(readRawStack());
        install(filtered);
        return filtered;
      },
      set: install,
    });
  }

  /**
   * Filters out internal BaseError frames and updates the error header.
   * This provides cleaner stack traces by removing implementation details.
   */
  /*#__PURE__*/ #filterInternalFrames(
    stack: string | undefined,
  ): string | undefined {
    if (!stack) {
      return undefined;
    }

    const lines = stack.split("\n");
    const filteredLines: string[] = [];

    // Update the header with proper error name and message
    filteredLines.push(`${this.name}: ${this.message}`);

    // Filter out internal frames
    for (let i = 1; i < lines.length; i++) {
      const line = lines[i];

      // Skip undefined lines (shouldn't happen, but satisfy TypeScript)
      if (!line) {
        continue;
      }

      // Skip internal BaseError frames
      if (
        line.includes("#installLazyStack") ||
        line.includes("#filterInternalFrames") ||
        line.includes("BaseError.constructor") ||
        line.includes("new BaseError") ||
        line.includes("installLazyStack_fn") || // Compiled private method name
        line.includes("filterInternalFrames_fn") || // Compiled private method name
        // Skip the temporary error creation frame
        (line.includes("Object.<anonymous>") &&
          line.includes("installLazyStack"))
      ) {
        continue;
      }

      filteredLines.push(line);
    }

    return filteredLines.join("\n");
  }
}
