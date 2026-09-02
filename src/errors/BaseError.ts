import { readMembers, readProperty } from "./guarded-read.js";
import {
  CIRCULAR_CAUSE_CHAIN_MARKER,
  MAX_CAUSE_DEPTH_MARKER,
  UNSERIALIZABLE_CAUSE_MARKER,
  isSerializerMarker,
  moreAggregatedErrorsMarker,
} from "./serializer-markers.js";

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
   * subclass adds via `buildLogObject`) is data: its leaves are masked unless
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
   * Largest **data** nesting depth the redaction walker descends into. Bounded
   * so a pathologically deep `details` tree degrades to a marker at the deep end
   * (shallow fields survive) instead of overflowing the stack and tripping the
   * fail-closed path, which would drop the whole log. The cap is host-stack
   * independent, so behavior is identical on small isolate stacks (edge
   * runtimes). The cause chain is its own separately bounded spine ({@link
   * BaseError.#MAX_CAUSE_DEPTH}) and is **exempt** from this budget, so a deep
   * chain cannot marker-truncate a shallow `details` on a deep cause.
   */
  static readonly #MAX_REDACT_DEPTH = 100;

  /**
   * Total-node budget for one redaction walk. The depth cap bounds depth, not
   * width: shared (DAG) references are cloned once per reference, so a small
   * `details` value can legally expand exponentially. Past the budget any
   * further container degrades to a marker (like the depth cap), keeping the
   * logging path fail-safe instead of walking a blowup to completion.
   */
  static readonly #MAX_REDACT_NODES = 100_000;

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
   * adds via `buildLogObject`) is data, so a subclass-added field leaks nothing
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
   */
  /*#__PURE__*/ static #redactWalk(
    value: unknown,
    decide: (key: string, value: unknown, region: RedactRegion) => unknown,
    region: RedactRegion,
    depth = 0,
    state: { nodes: number } = { nodes: 0 },
    key = "",
  ): unknown {
    // Past a cap, replace any container with a marker rather than recursing.
    // Leaves are unaffected (they never recurse), so shallow data is intact.
    // The node budget bounds total work (shared references expand per
    // reference); the depth cap bounds the stack.
    if (Array.isArray(value) || BaseError.#isWalkable(value)) {
      if (depth >= BaseError.#MAX_REDACT_DEPTH) {
        return "[Max redaction depth exceeded]";
      }
      if (++state.nodes > BaseError.#MAX_REDACT_NODES) {
        return "[Max redaction size exceeded]";
      }
    }
    if (Array.isArray(value)) {
      // Aggregate members sit on the cause spine (see #childRegion), bounded
      // separately by #MAX_CAUSE_DEPTH at serialization time. Like the rest of
      // that spine they stay out of the data-depth budget, so a deep aggregate
      // cannot marker-truncate a shallow `details` nested beneath it.
      const itemDepth = region === "cause" ? depth : depth + 1;
      return value.map((item) => {
        if (typeof item === "function") return null;
        if (Array.isArray(item) || BaseError.#isWalkable(item)) {
          return BaseError.#redactWalk(
            item,
            decide,
            region,
            itemDepth,
            state,
            key,
          );
        }
        // A leaf inside an array has no key of its own, so it is judged under
        // the key of the array that holds it, in every region. Without this an
        // allow-list keeps every scalar element, which is the opposite of what
        // it promises: an aggregate's members are arbitrary values (a
        // `Promise.allSettled` reason need not be an `Error`), and `errors` is
        // not an envelope key, so a string member is data like any other.
        if (BaseError.#isStructuralMarker(item, region)) return item;
        const decision = decide(key, item, region);
        return decision === BaseError.#RECURSE ? item : decision;
      });
    }
    if (BaseError.#isWalkable(value)) {
      // Null-prototype target so an own `__proto__`/`constructor` key from
      // untrusted details is copied as ordinary data (and masked/recursed like
      // any other key) instead of routing through a prototype setter. Matches
      // the null-prototype clones used by the public-error catalog and transport
      // stage. (OWASP Prototype Pollution Prevention.)
      const out = Object.create(null) as Record<string, unknown>;
      for (const [key, val] of Object.entries(value)) {
        if (typeof val === "function") continue;
        if (BaseError.#isStructuralMarker(val, region)) {
          out[key] = val;
          continue;
        }
        // A leaf's keep/mask decision is made in the region it *lives in* (the
        // parent); the child region only governs recursion. Conflating the two
        // wrongly masks a region-transition key that holds a leaf (e.g. a
        // top-level `cause: undefined`).
        const decision = decide(key, val, region);
        if (decision === BaseError.#RECURSE) {
          if (Array.isArray(val) || BaseError.#isWalkable(val)) {
            const childRegion = BaseError.#childRegion(region, key);
            // The cause chain is its own bounded spine (see #serializeCause), so
            // descending it must not consume the data-depth budget; otherwise a
            // deep chain would marker-truncate a shallow `details` on a deep
            // cause. The cap stays for genuinely deep data trees.
            const childDepth = childRegion === "cause" ? depth : depth + 1;
            out[key] = BaseError.#redactWalk(
              val,
              decide,
              childRegion,
              childDepth,
              state,
              key,
            );
          } else {
            out[key] = val;
          }
        } else {
          out[key] = decision;
        }
      }
      return out;
    }
    return value;
  }

  /**
   * Whether `value` is one of the serializer's own markers **in a place the
   * serializer writes them**: the cause spine. There a marker is the
   * library's word (a `cause` cut by the cycle or depth cap, an aggregate
   * tail, a node it could not serialize) and stays readable through any
   * redaction. In a data region an exact lookalike is user data and must not
   * slip past a deny- or allow-list. One predicate owns both halves of the
   * rule, so a walker branch cannot apply one without the other.
   */
  /*#__PURE__*/ static #isStructuralMarker(
    value: unknown,
    region: RedactRegion,
  ): boolean {
    return region === "cause" && isSerializerMarker(value);
  }

  /**
   * Region a child **container** enters (a leaf never transitions; its
   * keep/mask decision is made in the region it lives in). Data is sticky for
   * the whole subtree. `details` → data. `cause` and `errors` → cause: they
   * are the only containers on the cause spine. Every other container drops
   * to data, at the root as well as inside a cause. That covers a foreign key
   * (a field a subclass added via `buildLogObject`, a sibling a plain-object
   * cause carries) and also an **envelope-named** key: the envelope fields
   * (`name`/`message`/`stack`/`code`/`category`/`retryable`) are primitives,
   * so a container found under one of those names is not the envelope. It is
   * data, and an envelope-named leaf nested inside it stays masked.
   */
  /*#__PURE__*/ static #childRegion(
    region: RedactRegion,
    key: string,
  ): RedactRegion {
    if (region === "data") return "data";
    if (key === "details") return "data";
    if (key === "cause") return "cause";
    // An aggregate's members are further cause nodes, so they keep the same
    // structural envelope a `cause` gets, at the root as well as inside a
    // cause. `errors` is deliberately **not** added to #ROOT_ENVELOPE_KEYS:
    // only a container transitions region, so a scalar named `errors` is still
    // a data leaf and stays masked under an allow-list.
    if (key === "errors") return "cause";
    return "data";
  }

  /**
   * Sets a custom redactor applied to the full log object. Use for allow-lists
   * or scrubbing the technical `message`. Sticky; the last redactor wins.
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
   * Assembles the raw log object (no redaction). Subclasses override this to
   * add their own fields; the public {@link toLogObject} applies redaction to
   * the complete assembled object.
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
      cause: this.#serializeCause(cause, new Set(), 0),
    };

    // A subclass that aggregates failures carries them in `errors`, the field
    // a native `AggregateError` uses. Read by shape, so any such subclass gets
    // the same bounded, cycle-safe serialization as an aggregate cause.
    const members = readMembers(this);
    if (members.length > 0) {
      json.errors = this.#serializeAggregate(members, new Set([this]), 1);
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
   * ⚠️ This is a **log** serialization: it carries the technical message, stack,
   * cause chain and raw `details`. **Never return it to a client.** Anything that
   * auto-serializes the error (`JSON.stringify`, `res.json(err)`, `Response.json`,
   * `return err`) reaches {@link toJSON}, which is an alias of this method, and
   * leaks the same payload. For client-safe output use the `public-error`
   * subpath (`@shirudo/base-error/public-error`, `project`), which projects only
   * an allow-listed, message-free public view.
   */
  public toLogObject(): Record<string, unknown> {
    const raw = this.buildLogObject();
    if (!this.#redactor) {
      return raw;
    }
    return BaseError.#redactFailClosed(this.#redactor, raw);
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
      for (const key of BaseError.#SAFE_TRIAGE_KEYS) {
        if (Object.prototype.hasOwnProperty.call(raw, key)) {
          safe[key] = raw[key];
        }
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
    try {
      return value instanceof BaseError ? value.#redactor : undefined;
    } catch {
      return undefined;
    }
  }

  /**
   * Non-sensitive structural fields preserved in the fail-closed redaction
   * marker. Only those a given error's `buildLogObject()` actually emits are
   * copied (guarded by `key in raw`), so `code`/`category`/`retryable` appear
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
   * Readable one-liner plus full nested cause chain. Honors a deny-listed
   * `"message"` (see {@link redact}) per BaseError in the chain; other
   * redaction shapes rewrite only the log object.
   */
  public override toString(): string {
    return BaseError.#renderChain(this, new Set<unknown>(), "", 0).join("\n");
  }

  /**
   * Renders one cause chain into lines. A node that carries aggregate members
   * gets a count on its own line, and each member is rendered as its own
   * chain, indented one level deeper. The `seen` set is shared across the whole
   * tree, so a cycle or a repeated branch ends with a marker instead of
   * recursing.
   */
  /*#__PURE__*/ static #renderChain(
    start: unknown,
    seen: Set<unknown>,
    indent: string,
    depth: number,
  ): string[] {
    // Aggregates recurse, and a string render must never throw: bound the
    // nesting with the same cap the log serializer uses, so a pathologically
    // deep tree degrades to a marker instead of overflowing the host stack
    // (which is far smaller on an edge isolate than on Node).
    if (depth > BaseError.#MAX_CAUSE_DEPTH) {
      return [`${indent}${MAX_CAUSE_DEPTH_MARKER}`];
    }
    const lines: string[] = [];
    let current: unknown = start;
    let first = true;

    while (current != null) {
      const prefix = first ? indent : `${indent}Caused by: `;
      first = false;

      if (seen.has(current)) {
        lines.push(`${prefix}${CIRCULAR_CAUSE_CHAIN_MARKER}`);
        break;
      }
      seen.add(current);

      const members = readMembers(current);
      const suffix =
        members.length > 0 ? ` (+${members.length} aggregated)` : "";
      lines.push(`${prefix}${BaseError.#renderNode(current)}${suffix}`);

      const shown = members.slice(0, BaseError.#MAX_AGGREGATE_ERRORS);
      for (const member of shown) {
        const rendered = BaseError.#renderChain(
          member,
          seen,
          `${indent}    `,
          depth + 1,
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
      if (members.length > shown.length) {
        lines.push(
          `${indent}  ${moreAggregatedErrorsMarker(members.length - shown.length)}`,
        );
      }

      current = readProperty(current, "cause");
    }

    return lines;
  }

  /**
   * One node as a single line, honoring a deny-listed `message`. A string
   * render runs in catch paths and must not throw: a foreign `name`/`message`
   * that throws falls back to the `Error.prototype` defaults, and a value with
   * no string form at all (a null-prototype object, a throwing
   * `Symbol.toPrimitive`) renders as a marker.
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
   * Largest cause-chain depth serialized into a log object. Matches the cap used
   * by `StructuredError.fromJSON` and the traversal helpers, so a pathologically
   * deep (but acyclic) chain can never overflow the stack while logging.
   */
  static readonly #MAX_CAUSE_DEPTH = 100;

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
  ): unknown {
    try {
      return this.#serializeCauseNode(cause, seen, depth);
    } catch {
      return UNSERIALIZABLE_CAUSE_MARKER;
    }
  }

  /*#__PURE__*/ #serializeCauseNode(
    cause: unknown,
    seen: Set<unknown>,
    depth: number,
  ): unknown {
    if (cause === undefined || cause === null) {
      return cause;
    }

    if (depth >= BaseError.#MAX_CAUSE_DEPTH) {
      return MAX_CAUSE_DEPTH_MARKER;
    }

    if (BaseError.#isNativeError(cause)) {
      if (seen.has(cause)) {
        return CIRCULAR_CAUSE_CHAIN_MARKER;
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

      // Preserve StructuredError fields if present (duck-typing)
      // This avoids circular dependency between BaseError and StructuredError
      for (const key of ["code", "category", "retryable", "details"]) {
        const value = this.#serializeData(readProperty(cause, key));
        if (value !== undefined) serialized[key] = value;
      }

      // An aggregate's members (`AggregateError.errors`, and any error-like
      // value carrying the same shape) are own but **non-enumerable** on every
      // supported runtime, so `JSON.stringify` and `Object.entries` drop them
      // exactly like `message`/`stack`. Read explicitly, by shape rather than
      // by `instanceof AggregateError`, so cross-realm and custom fan-out
      // errors serialize too. Without this the branch failures that produced
      // the error never reach the log at all.
      const members = readMembers(cause);
      if (members.length > 0) {
        serialized.errors = this.#serializeAggregate(members, seen, depth + 1);
      }

      // Recursively serialize nested causes
      const nested = readProperty(cause, "cause");
      if (nested !== undefined) {
        serialized.cause = this.#serializeCause(nested, seen, depth + 1);
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
    return this.#serializeData(cause);
  }

  /**
   * A foreign value as the log object carries it: decoupled from its source
   * and safe for the consumer's `JSON.stringify`. One rule for a plain-object
   * cause and for every field copied off a native error (`details`, `code`,
   * an object under `stack`), so both branches carry the same guarantees.
   *
   * A primitive passes as-is, except a bigint, which has no JSON form and is
   * written as its decimal string. A function or symbol has no JSON form
   * either and reads as absent. An object is copied through the native JSON
   * round-trip: it keeps structured data, honors `toJSON`, drops what JSON
   * drops, and shares no reference with the source. A value the round-trip
   * cannot take (a cycle, a nested bigint, a throwing `toJSON`, a graph past
   * the node budget) degrades to the circular-object marker. Total: nothing
   * in here throws.
   */
  /*#__PURE__*/ #serializeData(value: unknown): unknown {
    if (typeof value === "object" && value !== null) {
      try {
        // The counting replacer bounds the total node count: JSON.stringify
        // duplicates shared (DAG) references per reference, so a small
        // hostile payload could expand exponentially; past the budget it
        // degrades to the fallback marker. Kept as the native stringify/parse
        // round-trip on purpose: it measures ~40% faster than an equivalent
        // JS walker.
        let nodes = 0;
        const json = JSON.stringify(value, (_key, item: unknown) => {
          if (++nodes > BaseError.#MAX_JSON_NODES) {
            throw new Error("payload exceeds serialization bounds");
          }
          return item;
        });
        if (json === undefined) {
          // A top-level toJSON returning undefined has no JSON form.
          return this.#serializeCircularObject(value);
        }
        return JSON.parse(json);
      } catch {
        // If JSON.stringify fails (circular references, BigInt, a size
        // blowup, ...), create a more useful representation
        return this.#serializeCircularObject(value);
      }
    }
    if (typeof value === "bigint") return value.toString();
    if (typeof value === "function" || typeof value === "symbol") {
      return undefined;
    }
    return value;
  }

  /**
   * Total-node budget for one data value in the log object (a plain-object
   * cause, a native cause's `details`), enforced by a counting replacer so a
   * shared-reference (DAG) blowup degrades to the fallback marker instead of
   * exhausting CPU. Matches the redaction and wire-clone budgets.
   */
  static readonly #MAX_JSON_NODES = 100_000;

  /**
   * Largest number of members serialized per aggregate node. The cause budget
   * bounds the spine's depth, not an aggregate's width: one `Promise.any` over
   * a large pool rejects with a member per branch, and a log line is not the
   * place for thousands of them. The remainder collapses to a count marker.
   */
  static readonly #MAX_AGGREGATE_ERRORS = 100;

  /**
   * Serializes an aggregate's members, capped in width. Members share the
   * enclosing `seen` set, so an error reachable from more than one branch is
   * rendered at its first occurrence and marked afterwards, and the walk
   * terminates on a self-referencing aggregate.
   */
  /*#__PURE__*/ #serializeAggregate(
    errors: readonly unknown[],
    seen: Set<unknown>,
    depth: number,
  ): unknown[] {
    const serialized: unknown[] = errors
      .slice(0, BaseError.#MAX_AGGREGATE_ERRORS)
      .map((error) => this.#serializeCause(error, seen, depth));

    const dropped = errors.length - serialized.length;
    if (dropped > 0) {
      serialized.push(moreAggregatedErrorsMarker(dropped));
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
      const type = obj.constructor?.name || "Object";
      const keys = Object.keys(obj).slice(0, 5); // Show first 5 keys
      const keyInfo = keys.length > 0 ? ` with keys: [${keys.join(", ")}]` : "";
      const moreKeys = Object.keys(obj).length > 5 ? "..." : "";

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
