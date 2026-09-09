import {
  isInstanceOf,
  readMembers,
  readObjectTag,
  readConstructorName,
  readToJSON,
  UNREADABLE_TO_JSON,
  readOwnEnumerableKeys,
  readOwnProperty,
  readProperty,
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

/**
 * Where a node sits in the log tree, for `redactAllow`'s structure-vs-data
 * decision: `"root"` (the top level, where only the library's own envelope
 * keys are kept), `"cause"` (a cause's top level, structural envelope keys
 * kept, the rest data), `"data"` (a `details` subtree, a cause's foreign
 * subtree, or a subclass-added top-level subtree, where every leaf is data).
 * The deny-list (`redact`) ignores it.
 */
type RedactRegion = "root" | "cause" | "data";

type WalkPosition = { region: RedactRegion; depth: number; spine: number };

/** Markers the redaction walker writes where a bound cut its walk. */
const REDACTION_DEPTH_MARKER = "[Max redaction depth exceeded]";
const REDACTION_CYCLE_MARKER = "[Circular reference]";
const REDACTION_SIZE_MARKER = "[Max redaction size exceeded]";

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

  // A data toJSON callback must not restart hooks or cause traversal.
  static #serializingData = false;

  // Reentrant callbacks share the current synchronous log build allowance.
  static #logBudget: { nodes: number; readonly limit: number } | undefined;
  static readonly #sizeCut = Symbol("log.size");

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
      const masked = BaseError.#redactWalk(
        log,
        (key, value) =>
          denied.has(key)
            ? BaseError.#applyMask(mask, value, key)
            : BaseError.#RECURSE,
        "root",
      ) as Record<string, unknown>;
      if (maskStackHeaders) {
        BaseError.#maskStackHeaders(log, masked, mask);
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
   * fields ({@link BaseError.#ROOT_ENVELOPE_KEYS}: `name`/`message`/`stack`/
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
    this.#redactor = (log) =>
      BaseError.#redactWalk(
        log,
        (key, value, region: RedactRegion) => {
          // Always recurse into containers so nested allowed leaves survive.
          if (Array.isArray(value) || BaseError.#isWalkable(value)) {
            return BaseError.#RECURSE;
          }
          // Leaf. Keep iff the region permits this key.
          const kept =
            (region === "root" && BaseError.#ROOT_ENVELOPE_KEYS.has(key)) ||
            allow.has(key) ||
            (region === "cause" && BaseError.#ENVELOPE_KEYS.has(key));
          return kept ? value : BaseError.#applyMask(mask, value, key);
        },
        "root",
      ) as Record<string, unknown>;
    return this;
  }

  /** Sentinel returned by a redaction decision to mean "descend / keep as-is". */
  static readonly #RECURSE: unique symbol = Symbol("redact.recurse");

  /**
   * Structural fields of an error envelope that survive an allow-list at the
   * **top level of a cause**. Everything else under a cause (foreign siblings
   * and anything nested beneath them, plus `details`) is treated as data, so a
   * plain object mimicking the structured shape cannot smuggle sensitive
   * siblings (or envelope-named keys buried in foreign subtrees) past
   * `redactAllow`. Private: it must not become a process-wide redaction toggle.
   */
  static readonly #ENVELOPE_KEYS: ReadonlySet<string> = new Set([
    "name",
    "message",
    "stack",
    "code",
    "category",
    "retryable",
  ]);

  /**
   * The library's own **top-level** structural fields, the only root leaves an
   * allow-list keeps. Everything else at the top level (a field a subclass
   * adds via `buildOwnLogFields`) is data, so a subclass-added field leaks nothing
   * through `redactAllow` by default. Which region a root **container** enters
   * is decided by {@link BaseError.#childRegion}, not by this set. Private for
   * the same reason as {@link BaseError.#ENVELOPE_KEYS}.
   */
  static readonly #ROOT_ENVELOPE_KEYS: ReadonlySet<string> = new Set([
    ...BaseError.#ENVELOPE_KEYS,
    "timestamp",
    "timestampIso",
    "cause",
    "details",
  ]);

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
  ): value is Record<string, unknown> {
    if (value === null || typeof value !== "object" || Array.isArray(value)) {
      return false;
    }
    const proto = Object.getPrototypeOf(value) as unknown;
    if (proto === Object.prototype || proto === null) return true;
    return Object.keys(value).length > 0;
  }

  /**
   * Single deep-clone walker for redaction. Recurses into arrays and objects
   * that carry own enumerable keys (see {@link BaseError.#isWalkable}); every
   * other value (string, `Date`, `Map`, empty object, …) is a leaf.
   * `decide(key, value, region)` returns the replacement for a key, or
   * `#RECURSE` to descend into a container / keep a leaf unchanged.
   *
   * `region` classifies where we are, so the allow-list can distinguish the
   * structural envelope from data:
   * - `"root"`: the top-level error envelope (kept verbatim by the allow-list);
   * - `"cause"`: at a `cause`'s top level; the structural envelope keys
   *   (`#ENVELOPE_KEYS`) are kept, all other leaves are data;
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
   * cost the same. A cause node starts its data budget afresh, so a deep chain
   * cannot marker-truncate a shallow `details` on a deep cause, and a spine
   * that a subclass supplies past the serializer's cap ends in a marker.
   * The node budget ({@link MAX_DATA_NODES})
   * counts every value the walk visits in a data region, a container or a
   * leaf, so it bounds total work and width alike; the root and cause
   * envelopes are bounded by the spine caps and are never cut by size. When
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
    depth = 0,
    state: { nodes: number; readonly seen: Set<object> } = {
      nodes: 0,
      seen: new Set<object>(),
    },
    key = "",
    spine = 0,
  ): unknown {
    if (!Array.isArray(value) && !BaseError.#isWalkable(value)) {
      return value;
    }
    // Past a cap, replace the container with a marker rather than recursing.
    // Leaves are unaffected (they never recurse), so shallow data is intact.
    if (depth >= MAX_DATA_DEPTH || spine > MAX_CAUSE_DEPTH) {
      return REDACTION_DEPTH_MARKER;
    }
    if (state.seen.has(value)) {
      return REDACTION_CYCLE_MARKER;
    }
    // The node budget is a data-tree budget: the root and cause envelopes are
    // bounded by the spine caps and are never cut by size.
    if (region === "data") {
      if (state.nodes >= MAX_DATA_NODES) {
        return REDACTION_SIZE_MARKER;
      }
      state.nodes++;
    }
    state.seen.add(value);
    try {
      if (Array.isArray(value)) {
        // Aggregate members sit on the cause spine (see #childRegion). Like
        // the rest of that spine they stay out of the data-depth budget, so a
        // deep aggregate cannot marker-truncate a shallow `details` nested
        // beneath it; each member is one hop on the spine instead.
        const position = BaseError.#childPosition(
          { region, depth, spine },
          true,
          key,
          value,
        );
        // Built index by index into a fresh plain array, so the walk can stop
        // at the budget with one marker in place of the rest.
        const items: unknown[] = [];
        for (let index = 0; index < value.length; index++) {
          if (region === "data" && state.nodes >= MAX_DATA_NODES) {
            items.push(REDACTION_SIZE_MARKER);
            break;
          }
          const item: unknown = value[index];
          if (Array.isArray(item) || BaseError.#isWalkable(item)) {
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
        return items;
      }
      // Null-prototype target so an own `__proto__`/`constructor` key from
      // untrusted details is copied as ordinary data (and masked/recursed like
      // any other key) instead of routing through a prototype setter. Matches
      // the null-prototype clones used by the public-error catalog and transport
      // stage. (OWASP Prototype Pollution Prevention.)
      const out = Object.create(null) as Record<string, unknown>;
      for (const [key, val] of Object.entries(value)) {
        if (region === "data" && state.nodes >= MAX_DATA_NODES) {
          out[key] = REDACTION_SIZE_MARKER;
          break;
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
          if (Array.isArray(val) || BaseError.#isWalkable(val)) {
            const position = BaseError.#childPosition(
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
      return out;
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

  /** Shared position rule for serialization and redaction. */
  static #childPosition(
    parent: WalkPosition,
    array: boolean,
    key: string,
    value: unknown,
  ): WalkPosition {
    const region = array
      ? parent.region
      : BaseError.#childRegion(parent.region, key, value);
    return {
      region,
      depth: region === "cause" ? parent.depth : parent.depth + 1,
      spine:
        parent.spine +
        (region === "cause" && (array || !Array.isArray(value)) ? 1 : 0),
    };
  }

  /**
   * Region a child **container** enters (a leaf never transitions; its
   * keep/mask decision is made in the region it lives in). Data is sticky for
   * the whole subtree. `details` → data. `cause`, and `errors` when it holds
   * a list → cause: they are the only containers on the cause spine. Every
   * other container, an object under `errors` included, drops
   * to data, at the root as well as inside a cause. That covers a foreign key
   * (a field a subclass added via `buildOwnLogFields`, a sibling a plain-object
   * cause carries) and also an **envelope-named** key: the envelope fields
   * (`name`/`message`/`stack`/`code`/`category`/`retryable`) are primitives,
   * so a container found under one of those names is not the envelope. It is
   * data, and an envelope-named leaf nested inside it stays masked.
   */
  /*#__PURE__*/ static #childRegion(
    region: RedactRegion,
    key: string,
    value: unknown,
  ): RedactRegion {
    if (region === "data") return "data";
    if (key === "details") return "data";
    if (key === "cause") return "cause";
    // An aggregate's members are further cause nodes, so they keep the same
    // structural envelope a `cause` gets, at the root as well as inside a
    // cause. Only a list transitions: the serializer writes `errors` as a
    // list, so an object under that name is foreign data, and it is bounded
    // by the data depth like any other foreign subtree. `errors` is
    // deliberately **not** added to #ROOT_ENVELOPE_KEYS: a scalar named
    // `errors` is still a data leaf and stays masked under an allow-list.
    if (key === "errors") return Array.isArray(value) ? "cause" : "data";
    return "data";
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
   * @deprecated Override {@link buildOwnLogFields} to contribute data fields.
   * Reshape the completed log in the consumer's logging adapter instead.
   */
  protected buildLogObject(): Record<string, unknown> {
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
    json.cause = this.#serializeCause(cause, new Set(), 0, json, "cause");

    // A subclass that aggregates failures carries them in `errors`, the field
    // a native `AggregateError` uses. Read by shape, so any such subclass gets
    // the same bounded, cycle-safe serialization as an aggregate cause.
    const aggregate = readMembers(this, MAX_AGGREGATE_MEMBERS);
    if (aggregate !== undefined && aggregate.total > 0) {
      json.errors = this.#serializeAggregate(aggregate, new Set([this]), 1);
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
    if (BaseError.#serializingData) return this.#dataErrorEnvelope();
    const previous = BaseError.#logBudget;
    BaseError.#logBudget ??= { nodes: 0, limit: MAX_LOG_NODES };
    try {
      const raw = this.#buildLogObjectTotal();
      return this.#redactor
        ? BaseError.#redactFailClosed(this.#redactor, raw)
        : raw;
    } finally {
      BaseError.#logBudget = previous;
    }
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
   *   than obeyed, and {@link BaseError.#RESERVED_NODE_KEYS} is the list;
   * - a node carries at most {@link MAX_OWN_LOG_FIELDS} of these fields, and
   *   the reader stops there;
   * - a throw, or a return that is not a record, costs these fields and never
   *   the node. A getter that throws costs its own key only;
   * - every value is copied as data (see {@link BaseError.#serializeData}),
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

  /**
   * Bridge to {@link buildOwnLogFields} through a private member, so reaching
   * it is itself the realm brand: a cross-realm instance fails `instanceof`,
   * and a Proxy fails the private access. Both then read as an error without
   * own fields, exactly as {@link BaseError.#redactorOf} treats a policy.
   */
  /*#__PURE__*/ #ownLogFields(): Record<string, unknown> {
    return this.buildOwnLogFields();
  }

  /**
   * Whether `value` is a BaseError of this realm, reachable as one. A
   * cross-realm instance fails `instanceof` and a Proxy fails the private
   * access, so each reads as an error this library cannot ask for its own
   * fields. Probed apart from the hook call, so an unreachable error is not
   * reported as one whose hook failed.
   */
  /*#__PURE__*/ static #sameRealm(value: unknown): value is BaseError<string> {
    try {
      if (!isInstanceOf(value, BaseError)) return false;
      // A Proxy passes `instanceof` and fails the private access, so the
      // private read is the brand.
      void value.#redactor;
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Keys a cause node's own fields may not write: the library writes them
   * itself, and two of them carry the bounded links.
   */
  static readonly #RESERVED_NODE_KEYS: ReadonlySet<string> = new Set([
    // Every envelope name. The allow-list keeps a leaf by key name and not by
    // provenance, so a hook field called `category` or `details` would survive
    // `redactAllow` unmasked. Reserving the whole set keeps an unknown key
    // data, which is what fail-closed means here. Some of these names the
    // cause serializer never writes; they are reserved for that reason alone.
    ...BaseError.#ROOT_ENVELOPE_KEYS,
    "errors",
    // A name the runtime owns. Writing it into a plain object routes through
    // a prototype setter instead of adding a field.
    "__proto__",
  ]);

  /**
   * The own fields a node carries: the hook's record with the library's own
   * key names removed, each value copied as data, cut at the width cap. One
   * reader for the root and for a cause, so both positions carry the same
   * fields under the same rules.
   */
  /*#__PURE__*/ #nodeOwnFields(value: unknown): Record<string, unknown> {
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
      const fields: unknown = value.#ownLogFields();
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
        BaseError.#logBudget,
      )) {
        if (taken >= MAX_OWN_LOG_FIELDS) break;
        if (BaseError.#RESERVED_NODE_KEYS.has(key)) continue;
        // Read through the guarded reader, so one throwing getter costs its
        // own key and leaves every sibling already collected in place.
        const item = readProperty(record, key);
        // An error here re-enters the log build through `toJSON`, with no
        // depth and no seen set, so `{ self: this }` grows without bound. The
        // contract already forbids it; this is where it is enforced.
        if (BaseError.#sameRealm(item) || BaseError.#isNativeError(item)) {
          continue;
        }
        const data = this.#serializeData(item);
        if (data === undefined) continue;
        out[key] = data;
        taken++;
      }
    } catch {
      // A throw mid-enumeration keeps whatever was already collected.
    }
    return out;
  }

  /**
   * The complete log object before redaction: the envelope the subclass chain
   * assembled, copied into an owned record with this error's own log fields.
   * Never write into a foreign target: even a successful setter can revoke it.
   */
  /*#__PURE__*/ #buildLogObjectTotal(): Record<string, unknown> {
    const assembled = this.#assembleLogObject();
    return Object.assign(assembled, this.#nodeOwnFields(this));
  }

  /** Copy once, in source order, with safe own writes even for __proto__. */
  #copyLogRecord(
    record: Record<string, unknown>,
  ): Record<string, unknown> | undefined {
    const envelopeKeys = [...BaseError.#ROOT_ENVELOPE_KEYS, "errors"];
    const keys = Array.from(
      readOwnEnumerableKeys(
        record,
        MAX_LOG_OBJECT_KEYS_READ - envelopeKeys.length,
      ),
    );
    const copied = Object.create(null) as Record<string, unknown>;
    let defined = false;
    for (const key of keys) {
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
    return defined ? { ...copied } : undefined;
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
  /*#__PURE__*/ #assembleLogObject(): Record<string, unknown> {
    try {
      const built: unknown = this.buildLogObject();
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
        if (copied !== undefined) return copied;
      }
    } catch {
      // The override failed. Fall through to the envelope it could not reach.
    }
    try {
      // The base envelope skips the whole subclass chain, so the structural
      // fields a subclass declares are read from the instance, exactly as the
      // triage envelope below reads them. Without this the milder failure
      // loses the machine-readable code that the worse one keeps.
      const base = BaseError.prototype.buildLogObject.call(this);
      for (const key of BaseError.#SAFE_TRIAGE_KEYS) {
        if (base[key] !== undefined) continue;
        const value = this.#serializeData(readProperty(this, key));
        if (value !== undefined) base[key] = value;
      }
      return base;
    } catch {
      // A field of the instance itself throws. Read the rest defensively.
    }
    return this.#triageLogObject();
  }

  /**
   * The last envelope: what this class can read off the instance itself when
   * everything an override touched has failed. Every read is guarded and every
   * value is copied as data, so this cannot throw and cannot hand a consumer's
   * `JSON.stringify` a value it refuses.
   */
  /*#__PURE__*/ #triageLogObject(): Record<string, unknown> {
    const triage: Record<string, unknown> = { message: "[log build failed]" };
    for (const key of BaseError.#SAFE_TRIAGE_KEYS) {
      const value = this.#serializeData(readProperty(this, key));
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
   * survive). Shared by the root log object and by every cause node that
   * carries its own policy, so one node's broken redactor costs that node
   * and nothing above it.
   */
  /*#__PURE__*/ static #redactFailClosed(
    redactor: (log: Record<string, unknown>) => Record<string, unknown>,
    raw: Record<string, unknown>,
  ): Record<string, unknown> {
    try {
      return redactor(raw);
    } catch {
      const safe: Record<string, unknown> = {
        message: "[log redaction failed]",
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
   * The private field is the brand: a cross-realm instance and a Proxy fail
   * it, and so does a value whose prototype check throws, so each of them
   * reads as an error without a policy and is logged like a foreign error.
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
   * Masks a deny-listed message where a `stack` repeats it: in the header of
   * the root, of every `cause`, and of every aggregate member. Walks the raw
   * log object and its masked clone in lockstep and writes into the clone
   * only, because a subclass's `buildLogObject` can hand in shared objects.
   * The clone is the bound: the redaction walk has already cut its depth and
   * size with markers, and this pass stops where the clone holds a marker
   * instead of a node.
   */
  /*#__PURE__*/ static #maskStackHeaders(
    raw: unknown,
    masked: unknown,
    mask: RedactMask,
  ): void {
    let rawNode: unknown = raw;
    let maskedNode: unknown = masked;
    while (BaseError.#isWalkable(maskedNode)) {
      const stack = readProperty(rawNode, "stack");
      if (typeof stack === "string") {
        maskedNode.stack = BaseError.#maskStackHeader(
          stack,
          readProperty(rawNode, "name"),
          readProperty(rawNode, "message"),
          mask,
        );
      }
      const rawMembers = readProperty(rawNode, "errors");
      const maskedMembers = maskedNode.errors;
      if (Array.isArray(rawMembers) && Array.isArray(maskedMembers)) {
        for (let index = 0; index < maskedMembers.length; index++) {
          BaseError.#maskStackHeaders(
            rawMembers[index],
            maskedMembers[index],
            mask,
          );
        }
      }
      rawNode = readProperty(rawNode, "cause");
      maskedNode = maskedNode.cause;
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
   * field taken off a native error is copied as data (see #serializeData),
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
  ): unknown {
    try {
      return this.#serializeCauseNode(cause, seen, depth, holder, key);
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
  ): unknown {
    if (cause === undefined || cause === null) {
      return cause;
    }

    if (!BaseError.#takeLogNode()) {
      return BaseError.#markSerializerMarker(holder, key, MAX_LOG_SIZE_MARKER);
    }

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
      // Every value is copied as data (see #serializeData): the log object
      // must not share a reference with the cause, and the consumer's
      // JSON.stringify must not meet a bigint or a cycle the cause carried.
      const serialized: Record<string, unknown> = {
        name: this.#serializeData(readProperty(cause, "name")),
        message: this.#serializeData(readProperty(cause, "message")),
        stack: this.#serializeData(readProperty(cause, "stack")),
      };

      // Preserve StructuredError fields if present (duck-typing). This is the
      // only route for a foreign cause: a plain `Error` carrying these fields,
      // a cross-realm instance and a Proxy have no reachable hook to ask.
      for (const key of ["code", "category", "retryable", "details"]) {
        const value = this.#serializeData(readProperty(cause, key));
        if (value !== undefined) serialized[key] = value;
      }

      // A cause of this realm says what it is, through the one hook a fixed
      // roster cannot replace. The library's own key names win, so a hook
      // cannot forge an envelope field or a bounded link, and every value is
      // copied as data like the rest of the node.
      Object.assign(serialized, this.#nodeOwnFields(cause));

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
    return this.#serializeData(cause, "cause", depth);
  }

  /** JSON unboxes by internal brand; a consumer tag cannot grant or hide it. */
  static #unboxData(value: object): unknown {
    const tag = readObjectTag(value);
    const tagged =
      tag === undefined ||
      readProperty(value, Symbol.toStringTag) !== undefined;
    let primitive: unknown = value;
    if (tag === "[object Number]" || tagged) {
      try {
        primitive = Number.prototype.valueOf.call(value);
      } catch {
        /* No number brand. */
      }
    }
    if (primitive === value && (tag === "[object String]" || tagged)) {
      try {
        primitive = String.prototype.valueOf.call(value);
      } catch {
        /* No string brand. */
      }
    }
    if (primitive === value && (tag === "[object Boolean]" || tagged)) {
      try {
        primitive = Boolean.prototype.valueOf.call(value);
      } catch {
        /* No boolean brand. */
      }
    }
    if (primitive === value && (tag === "[object BigInt]" || tagged)) {
      try {
        primitive = BigInt.prototype.valueOf.call(value);
      } catch {
        /* No bigint brand. */
      }
    }
    // Number and string wrappers run conversion hooks; booleans use their slot.
    if (typeof primitive === "number") return +(value as unknown as number);
    if (typeof primitive === "string") return String(value);
    return primitive;
  }

  static #takeLogNode(): boolean {
    const budget = BaseError.#logBudget;
    if (budget === undefined) return true;
    if (budget.nodes >= MAX_LOG_NODES) return false;
    budget.nodes++;
    return true;
  }

  /**
   * A foreign value as the log object carries it: decoupled from its source
   * and safe for the consumer's `JSON.stringify`. One rule for a plain-object
   * cause and for every field copied off a native error (`details`, `code`,
   * an object under `stack`), so both branches carry the same guarantees.
   *
   * A primitive passes as-is, except a bigint, which has no JSON form and is
   * written as its decimal string, at every depth. A function or symbol has
   * no JSON form either and reads as absent. A bounded walker copies objects,
   * honors `toJSON`, and applies JSON value conversions. Foreign reads and
   * descriptor inspections are guarded and charged before expansion. A cycle
   * or a throwing `toJSON` uses the legacy
   * circular-object fallback. Budget exhaustion uses the log-size marker.
   * Nothing in here throws.
   *
   * Cause depth and data depth count separately, with the redaction regions.
   * At a depth cap, the copy keeps an empty container and reads no children.
   */
  /*#__PURE__*/ #serializeData(
    value: unknown,
    region: RedactRegion = "data",
    spine = 0,
  ): unknown {
    if (
      value === undefined ||
      typeof value === "function" ||
      typeof value === "symbol"
    )
      return undefined;
    const budget = BaseError.#logBudget ?? { nodes: 0, limit: MAX_LOG_NODES };
    if (budget.nodes >= MAX_LOG_NODES) return MAX_LOG_SIZE_MARKER;
    if (typeof value === "object" && value !== null) {
      const serializing = BaseError.#serializingData;
      BaseError.#serializingData = true;
      const seen = new Set<object>();
      const copy = (
        input: unknown,
        key: string,
        parent?: WalkPosition,
        arrayParent = false,
      ): unknown => {
        if (budget.nodes >= MAX_LOG_NODES) throw BaseError.#sizeCut;
        budget.nodes++;
        let item = input;
        const toJSON = readToJSON(item);
        if (toJSON === UNREADABLE_TO_JSON) throw new Error("unreadable toJSON");
        if (typeof toJSON === "function")
          item = Reflect.apply(toJSON, item, [key]);
        if (item !== null && typeof item === "object") {
          item = BaseError.#unboxData(item);
        }
        if (typeof item === "bigint") return item.toString();
        if (typeof item === "number")
          return Number.isFinite(item) ? item : null;
        if (typeof item === "function" || typeof item === "symbol")
          return undefined;
        if (item === null || typeof item !== "object") return item;
        const array = Array.isArray(item);
        const position =
          parent === undefined
            ? {
                region,
                depth: 0,
                spine: spine + (region === "cause" && !array ? 1 : 0),
              }
            : BaseError.#childPosition(parent, arrayParent, key, item);
        if (
          position.depth >= MAX_DATA_DEPTH ||
          position.spine > MAX_CAUSE_DEPTH
        )
          return array ? [] : {};
        if (seen.has(item)) throw new Error("circular data");
        seen.add(item);
        try {
          if (array) {
            const length = readProperty(item, "length");
            const count =
              typeof length === "number" &&
              Number.isSafeInteger(length) &&
              length >= 0
                ? length
                : 0;
            const out: unknown[] = [];
            for (let index = 0; index < count; index++) {
              if (budget.nodes >= MAX_LOG_NODES) throw BaseError.#sizeCut;
              out.push(
                copy(
                  readProperty(item, String(index)),
                  String(index),
                  position,
                  true,
                ) ?? null,
              );
            }
            return out;
          }
          const out = Object.create(null) as Record<string, unknown>;
          const keys = readOwnEnumerableKeys(item, MAX_LOG_NODES, budget);
          let entry = keys.next();
          while (!entry.done) {
            if (budget.nodes >= MAX_LOG_NODES) throw BaseError.#sizeCut;
            const key = entry.value;
            const field = copy(readProperty(item, key), key, position);
            if (field !== undefined) out[key] = field;
            entry = keys.next();
          }
          if (!entry.value) throw new Error("unreadable data keys");
          // A cut can fall on a non-enumerable key and yield no field.
          if (budget.nodes >= MAX_LOG_NODES) throw BaseError.#sizeCut;
          return { ...out };
        } finally {
          seen.delete(item);
        }
      };
      try {
        const result = copy(value, "");
        return result === undefined
          ? this.#serializeCircularObject(value)
          : result;
      } catch (error) {
        if (error === BaseError.#sizeCut) return MAX_LOG_SIZE_MARKER;
        return this.#serializeCircularObject(value);
      } finally {
        BaseError.#serializingData = serializing;
      }
    }
    budget.nodes++;
    if (typeof value === "bigint") return value.toString();
    return value;
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
  ): unknown[] {
    const serialized: unknown[] = [];
    for (const error of aggregate.members) {
      if ((BaseError.#logBudget?.nodes ?? 0) >= MAX_LOG_NODES) {
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
   * Creates a more useful representation of circular objects for debugging.
   * Instead of just "[object Object]", it extracts key information. Total:
   * the constructor and key reads are foreign, and a Proxy whose traps throw
   * gets the bare marker instead of an exception.
   */
  /*#__PURE__*/ #serializeCircularObject(obj: object): string {
    try {
      const type = readConstructorName(obj) || "Object";
      const keys = Array.from(
        readOwnEnumerableKeys(obj, 6, BaseError.#logBudget),
      );
      const keyInfo =
        keys.length > 0 ? ` with keys: [${keys.slice(0, 5).join(", ")}]` : "";
      const moreKeys = keys.length > 5 ? "..." : "";

      return `[Circular ${type}${keyInfo}${moreKeys}]`;
    } catch {
      return "[Circular Object]";
    }
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
