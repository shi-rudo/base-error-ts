import { RESERVED_NODE_KEYS } from "./log-field-keys.js";
import {
  createLogBuildContext,
  type LogBuildContext,
} from "./log-build-context.js";
import { serializeLogData, normalizeLogNumber } from "./log-data.js";
import { allowListRedaction, denyListRedaction } from "./log-redaction.js";
import { renderCauseChain, renderValue } from "./cause-chain-render.js";
import { rootCauseWalk, type CauseWalk } from "./cause-walk.js";
import { isNativeError } from "./native-error.js";
import {
  readMembers,
  readOwnEnumerableKeys,
  readOwnProperty,
  readProperty,
  readPropertyResult,
  readStack,
  type AggregateMembers,
} from "./guarded-read.js";
import type { JsonSafeValue } from "./json-safe.js";
import { toTimestampIso } from "./timestamp-iso.js";
import {
  CIRCULAR_CAUSE_CHAIN_MARKER,
  LOG_REDACTION_FAILED_MARKER,
  MAX_CAUSE_DEPTH_MARKER,
  MAX_LOG_SIZE_MARKER,
  SHARED_CAUSE_MARKER,
  UNSERIALIZABLE_CAUSE_MARKER,
  UNSERIALIZABLE_VALUE_MARKER,
  droppedMembersMarker,
} from "./serializer-markers.js";
import {
  MAX_AGGREGATE_MEMBERS,
  MAX_CAUSE_DEPTH,
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
 * Application-specific base error that works across full Node.js, isolate "edge"
 * runtimes (Cloudflare Workers, Deno Deploy, Vercel Edge Functions) and modern
 * browsers. It preserves the native `cause` field where available, and it
 * falls back gracefully where it is not. It also produces the richest stack
 * trace that the host can provide.
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

  /**
   * Epoch-ms timestamp (numeric). The log object also states it as an
   * ISO-8601 string, `timestampIso`, which each log build derives from this
   * field.
   */
  public readonly timestamp: number = Date.now();

  /** Rich, filtered stack where the host supports it. */
  public override readonly stack?: string;

  #redactor?: (log: Record<string, unknown>) => Record<string, unknown>;

  /** Whether {@link redactWith} set the policy: its output is consumer data. */
  #customPolicy = false;

  /**
   * Mask for the technical `message` in {@link toString}, set only by a
   * deny-list {@link redact} whose keys include `"message"`. `toString` (unlike
   * `toLogObject`) cannot run an arbitrary redactor. But a denied `message` is
   * an explicit statement that the text is sensitive, so the one string render
   * that the library controls honors it. Follows the redactor's
   * last-wins semantics: `redactAllow`/`redactWith` clear it.
   */
  #messageMask?: RedactMask;

  /**
   * Creates a new BaseError instance with automatic name inference.
   *
   * @param message - Human-readable explanation (name will be inferred from constructor)
   * @param cause - Optional underlying error or extra context
   * @param options - Optional runtime name settings
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
    // A direct `new BaseError(...)` uses the literal instead of inference.
    // The bundler rewrites this class into a renamed binding, because its
    // body reads its own statics. Without the literal, `constructor.name`
    // reports that binding (`_BaseError`). verify-dist.mjs guards this on
    // every build.
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
   * (`toLogObject`/`toJSON`). The policy is sticky on the instance. So it also
   * applies when a logger auto-serializes the error via `JSON.stringify`. It
   * also applies when another error of the same realm logs this one as its
   * `cause` (see {@link toLogObject}).
   *
   * ⚠️ Scope: redaction rewrites the **log object**, not every string render.
   * If `keys` includes `"name"` or `"message"`, the redaction also covers the
   * `stack` fields of the log. This applies on the root, on every `cause`, and
   * on every aggregate member. If a stack starts with the node's own
   * `name: message` header, the redaction rewrites that header with the
   * masked fields and keeps the frames. If a stack does not start with that
   * header, the redaction hands the whole stack to the mask. The
   * {@link toString} render masks a deny-listed technical message as well.
   * The log states the time in two keys, `timestamp` and `timestampIso`; to
   * hide it, deny both. The `err.stack` property and Node's `console.log(err)`
   * inspection (which prints that property) stay unredacted. When redaction
   * matters, log errors only through a structured serializer that hits
   * `toJSON`, never via string interpolation.
   *
   * @param keys - Property names to mask wherever they appear in the log object.
   * @param options - `mask` defaults to `"[REDACTED]"`. The log copies the
   *   result of a function mask as log data.
   */
  public redact(keys: string[], options?: { mask?: RedactMask }): this {
    const mask = options?.mask ?? "[REDACTED]";
    const denied = new Set(keys);
    this.#messageMask = denied.has("message") ? mask : undefined;
    this.#redactor = BaseError.#guardRedactor(
      (log) => denyListRedaction(log, denied, BaseError.#maskApplier(mask)),
      denied,
    );
    this.#customPolicy = false;
    return this;
  }

  /**
   * Allow-list redaction (higher assurance than {@link redact}). Within any
   * **data** region, it masks every leaf whose key is **not** listed. So a
   * newly-added field leaks nothing by default. A data region is a `details`
   * subtree at any depth, the data-bearing fields of a `cause`, or any
   * subclass-added top-level field. The redaction recurses into container
   * objects, so nested allowed leaves survive. A leaf inside an **array** has
   * no key of its own. The redaction judges it under the key of the array
   * that holds it. So a list of tokens is masked as a whole, unless that key
   * is allowed.
   * The redaction keeps only the library's own structural envelope. At the
   * top level, that is the fixed fields (`name`/`message`/`stack`/
   * `code`/`category`/`retryable`/`timestamp`/`timestampIso`). In a cause,
   * that is the top-level structural envelope keys (`name`/`message`/`stack`/
   * `code`/`category`/`retryable`). The top-level `cause` and `details` are
   * links, not envelope leaves. A primitive under them is data. The `cause`
   * slot keeps only a serializer marker or an absent cause. Any other
   * top-level field (e.g. one a
   * subclass adds via `buildOwnLogFields`) is data: its leaves are masked unless
   * allow-listed. The foreign fields of a cause are data: anything outside
   * that fixed set, and everything nested beneath them. So a plain object
   * that only *looks* like a structured error cannot smuggle siblings
   * through. It also cannot smuggle envelope-named keys buried in foreign
   * subtrees. An envelope key holds a primitive. A **container** under an
   * envelope name (`stack: {…}`, `code: {…}`) is data, at the root and inside
   * a cause. So its leaves are masked, whatever their names are. The policy
   * is sticky, and the last redactor wins. It also holds when another error
   * of the same realm logs this one as its `cause` (see {@link toLogObject}).
   *
   * ⚠️ Scope: rewrites the **log object** only. The technical `message` is part
   * of the kept structural envelope. So `toString`, `err.stack`, and Node's
   * `console.log(err)` inspection carry it unchanged. To mask the message
   * itself, see {@link redact}.
   *
   * @param keys - Data leaf keys allowed to survive in the log.
   * @param options - `mask` defaults to `"[REDACTED]"`. The log copies the
   *   result of a function mask as log data.
   */
  public redactAllow(keys: string[], options?: { mask?: RedactMask }): this {
    const mask = options?.mask ?? "[REDACTED]";
    const allow = new Set(keys);
    this.#messageMask = undefined;
    this.#redactor = BaseError.#guardRedactor((log) =>
      allowListRedaction(log, allow, BaseError.#maskApplier(mask)),
    );
    this.#customPolicy = false;
    return this;
  }

  /*#__PURE__*/ static #applyMask(
    mask: RedactMask,
    value: unknown,
    key: string,
  ): unknown {
    return typeof mask === "function" ? mask(value, key) : mask;
  }

  /**
   * The mask as one walk applies it. A function mask is consumer code and can
   * return any value. So each result passes through the log-data copier, and
   * an outer policy meets plain data only. One copy context per walk bounds
   * the results of all its mask calls together.
   */
  /*#__PURE__*/ static #maskApplier(
    mask: RedactMask,
  ): (value: unknown, key: string) => unknown {
    if (typeof mask === "string") return () => mask;
    const context = BaseError.#newLogContext();
    return (value, key) => serializeLogData(mask(value, key), context);
  }

  /**
   * Sets a trusted, synchronous transform of the complete log record.
   * Sticky; the last policy wins, replacing any earlier built-in policy.
   * The callback can mutate its input or return another record.
   * When this error is logged, successful output is not validated, copied, or
   * implicitly redacted again. The consumer owns its shape, JSON safety, and
   * sensitive content. When this error is the cause of another error, the log
   * copies the output with the log-data copier. The policy of the enclosing
   * error then walks that copy.
   * A synchronous throw returns the pre-call diagnostic fields without payload.
   * The input holds copies only, so a mutation cannot reach an error.
   * Public logging calls inside the callback start independent builds.
   * The consumer must bound those calls and terminate the callback.
   *
   * ⚠️ Scope: applies to the **log object** only. The library cannot map a
   * custom redactor onto the one-line {@link toString} render. So `toString`,
   * `err.stack`, and `console.log(err)` inspection keep the raw technical
   * message. This holds even when the redactor scrubs the message from the
   * log.
   * Changing the log's `message` does not automatically scrub its `stack`.
   */
  public redactWith(
    redactor: (log: Record<string, unknown>) => Record<string, unknown>,
  ): this {
    this.#messageMask = undefined;
    this.#redactor = BaseError.#guardRedactor(redactor);
    this.#customPolicy = true;
    return this;
  }

  /** The library owns the envelope; each foreign field is read independently. */
  #baseLogObject(context: LogBuildContext): Record<string, unknown> {
    const json: Record<string, unknown> = {};
    const name = readProperty(this, "name");
    const message = readProperty(this, "message");
    // Both time keys come from one read, so they state one instant.
    const timestamp = readProperty(this, "timestamp");
    const envelope: ReadonlyArray<readonly [string, unknown]> = [
      ["name", name],
      ["message", message],
      ["timestamp", timestamp],
      ["timestampIso", toTimestampIso(timestamp)],
      ["stack", readProperty(this, "stack")],
    ];
    for (const [key, read] of envelope) {
      const value = BaseError.#serializeEnvelopeField(read, context);
      if (value !== undefined) json[key] = value;
    }
    // The cause and the members get a walk each, so a node in both stays in
    // full in the members, where fromJSON rebuilds it.
    json.cause = this.#serializeCause(
      readProperty(this, "cause"),
      rootCauseWalk(this),
      0,
      context,
    );

    // A subclass that aggregates failures carries them in `errors`, the field
    // a native `AggregateError` uses. Read by shape, so any such subclass gets
    // the same bounded, cycle-safe serialization as an aggregate cause.
    const aggregate = readMembers(this, MAX_AGGREGATE_MEMBERS + 1);
    if (aggregate !== undefined && aggregate.total > 0) {
      json.errors = this.#serializeAggregate(
        aggregate,
        rootCauseWalk(this),
        0,
        context,
      );
    }

    // Read structured fields by shape, as the cause serializer does. They
    // belong to the envelope, so an own-fields override cannot replace them.
    for (const key of ["code", "category", "retryable"]) {
      const value = BaseError.#serializeEnvelopeField(
        readProperty(this, key),
        context,
      );
      if (value !== undefined) json[key] = value;
    }
    // The root writes its diagnosis and its cause links before its data, so
    // oversized details cannot cut the chain that explains the failure.
    const details = serializeLogData(readProperty(this, "details"), context);
    if (details !== undefined) json.details = details;

    return json;
  }

  /**
   * Serialises the error for logs. Includes technical message, stack and cause,
   * with the instance redactor applied (see {@link redact} / {@link redactWith}).
   *
   * A cause can be a BaseError of the same realm with its own sticky policy.
   * That policy masks the cause first, over its node and everything beneath
   * it. The redactor of this error walks the result afterwards. This holds
   * for a nested cause and for an aggregate member alike. A cause from
   * another realm (a worker boundary, a second copy of the package) carries
   * no reachable policy. A Proxy around a BaseError carries none either. The
   * log writes both like a foreign error.
   *
   * The log writes an error that two branches share at its first position
   * only, and a cause policy covers the positions beneath its own error. If
   * the first position sits in a branch without a policy, the shared error
   * appears there unmasked. To mask a value at every position, give the
   * policy to the error that carries the value, or to the root.
   *
   * During data serialization, nested errors keep a primitive diagnostic
   * envelope and their sticky policy, without restarting hooks or traversal.
   * During own-fields processing, explicit nested calls skip own-fields hooks
   * across instances while retaining envelopes, causes, and redaction.
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
    const raw = this.#baseLogObject(context);
    Object.assign(raw, BaseError.#nodeOwnFields(this, context));
    return this.#redactor ? this.#redactor(raw) : raw;
  }

  static #newLogContext(): LogBuildContext {
    return createLogBuildContext((value) =>
      BaseError.#sameRealm(value)
        ? () => value.#dataErrorEnvelope()
        : undefined,
    );
  }

  /**
   * Nested data errors retain diagnostics without invoking hooks or links.
   * The view writes no `stack`: header masking covers the cause spine only,
   * so a stack in data would carry a denied `name` or `message`.
   */
  #dataErrorEnvelope(): Record<string, unknown> {
    const log: Record<string, unknown> = {};
    for (const key of [...BaseError.#SAFE_TRIAGE_KEYS, "message"]) {
      // The ISO form derives from the timestamp that this envelope holds.
      const value =
        key === "timestampIso"
          ? toTimestampIso(log.timestamp)
          : readProperty(this, key);
      if (
        value === null ||
        typeof value === "string" ||
        typeof value === "boolean" ||
        (typeof value === "number" && Number.isFinite(value))
      )
        log[key] = value;
    }
    return this.#redactor ? this.#redactor(log) : log;
  }

  /**
   * The fields this error contributes to its own log object, beyond the
   * envelope this class writes. Override this to add fields; return a fresh
   * record and nothing else.
   * Use `OwnLogFields` as the override's return type to check data fields.
   * The base signature accepts unknown values for compatibility and runtime guards.
   * The hook must finish synchronously; its work is not bounded by the serializer.
   *
   * Fields added here survive at every depth of a cause chain. The library
   * builds the fixed envelope independently of this contribution.
   *
   * The contract, because the caller is a logging path that must not throw
   * and must stay bounded:
   *
   * - it takes no arguments, so an error describes itself the same way
   *   wherever it sits in a chain;
   * - it must not walk a cause chain and must not log another error;
   * - while the hook and its returned fields are processed, nested public
   *   log calls skip own-fields hooks on all instances from this package;
   * - every key that carries a name this library writes is dropped rather
   *   than obeyed;
   * - a node carries at most 100 of these fields, and
   *   the reader stops there;
   * - a throw, or a return that is not a record, costs these fields and never
   *   the node. A getter that throws leaves an unserializable-value marker;
   * - every value is copied as data,
   *   so the log shares no reference with the error.
   *
   * That copy follows JSON value conversions. A `Date` becomes its ISO string, a `Map`
   * becomes `{}`, and a bigint becomes its decimal string.
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

  static #ownFieldsActive = false;

  /**
   * The own fields that a node carries: the record of the hook, without the
   * library's own key names. This reader copies each value as data and cuts
   * the record at the width cap. One reader for the root and for a cause, so
   * both positions carry the same fields under the same rules.
   */
  /*#__PURE__*/ static #nodeOwnFields(
    value: unknown,
    context: LogBuildContext,
  ): Record<string, unknown> {
    if (BaseError.#ownFieldsActive || !BaseError.#sameRealm(value)) {
      return {};
    }
    // Null-prototype target, so an own `__proto__` from a hook is copied as
    // ordinary data instead of routing through a prototype setter. Matches
    // the clone target of the redaction walker.
    const out = Object.create(null) as Record<string, unknown>;
    BaseError.#ownFieldsActive = true;
    try {
      // The record is foreign data, not only the call that produced it. A
      // getter on it, a Proxy trap on it, and a read of its keys or its
      // prototype can throw. All of that stays inside this one try, so a
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
        const read = readPropertyResult(record, key);
        const item = read.readable ? read.value : UNSERIALIZABLE_VALUE_MARKER;
        // Own fields describe the node. Error relationships belong in cause.
        // Nested data errors use a shallow diagnostic view in serializeLogData.
        if (BaseError.#sameRealm(item) || isNativeError(item)) {
          continue;
        }
        const data = serializeLogData(item, context);
        if (data === undefined) continue;
        out[key] = data;
        taken++;
      }
    } catch {
      // A throw mid-enumeration keeps whatever was already collected.
    } finally {
      BaseError.#ownFieldsActive = false;
    }
    return out;
  }

  /**
   * Captures permitted diagnostic fields before consumer code can corrupt them.
   * Recovery stays bound to this policy if its callback installs another one.
   * A synchronous throw drops payload, stack, and links from this node.
   * Successful custom output remains consumer-controlled.
   */
  /*#__PURE__*/ static #guardRedactor(
    redactor: (log: Record<string, unknown>) => Record<string, unknown>,
    denied?: ReadonlySet<string>,
  ): (raw: Record<string, unknown>) => Record<string, unknown> {
    return (raw) => {
      const safe: Record<string, unknown> = {
        message: LOG_REDACTION_FAILED_MARKER,
      };
      for (const key of BaseError.#SAFE_TRIAGE_KEYS) {
        if (denied?.has(key)) continue;
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
      try {
        return redactor(raw);
      } catch {
        return safe;
      }
    };
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
   * Structural fields eligible for redaction recovery unless explicitly denied.
   * Consumers must keep undenied original values free of secrets.
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
   * {@link toLogObject}. It returns the same **log** shape: technical message,
   * stack, cause chain and raw `details`.
   *
   * ⚠️ `JSON.stringify(err)`, `res.json(err)`, `Response.json(err)` and
   * `return err` all route through `toJSON`. So an error sent down any of those
   * paths leaks the full technical payload to the client. **Never serialize an
   * error straight into a response.** Produce a client payload through the
   * `public-error` subpath (`project` / `toProblem`) instead. This shape is also
   * the input that `StructuredError.fromJSON` reconstructs, which is why it
   * intentionally retains the stack and cause chain.
   */
  public toJSON(): Record<string, unknown> {
    return this.toLogObject();
  }

  /**
   * Readable one-liner plus the nested cause chain. For a chain of error
   * objects, the render has exactly the same bounds as the log object. It
   * renders the same cause nodes, and past the cap the chain ends with the
   * same depth marker.
   * A plain-object cause carries its data fields in the log object. This
   * render follows its `cause` links and ends them at the cap. Honors a deny-listed
   * `"message"` (see {@link redact}) per BaseError in the chain; other
   * redaction shapes rewrite only the log object. The render writes at most
   * 100,000 lines, and the next line is the size marker of the log object.
   */
  public override toString(): string {
    return renderCauseChain(this, (node) =>
      node instanceof BaseError
        ? `[${renderValue(node.name)}] ${node.#renderMessage()}`
        : undefined,
    );
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
      return renderValue(this.message);
    }
    try {
      return renderValue(
        BaseError.#applyMask(this.#messageMask, this.message, "message"),
      );
    } catch {
      return "[REDACTED]";
    }
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
   * Preserves stack traces, StructuredError fields, and nested data. The
   * serializer copies every field that it takes off a native error as data
   * (see serializeLogData). So the log object shares no reference with the
   * cause. The consumer's `JSON.stringify` also never meets a bigint or a
   * cycle that the cause carried. It uses a cause walk (see {@link CauseWalk})
   * to mark cycles and shared nodes. A depth bound caps an acyclic but very
   * deep chain. `depth` is the cause hop of the node that holds `cause`: 0
   * for the cause and the members of the logged error.
   *
   * Total per node: each foreign read is guarded. A value that still defeats
   * serialization (a Proxy whose traps throw) becomes a marker. So one hostile
   * node costs its own entry in the log and nothing else.
   *
   * A node can be a BaseError of this realm with a sticky redaction policy.
   * Then that policy masks the node, subtree included, before the serializer
   * returns it (see {@link BaseError.#redactorOf}). A throwing policy
   * collapses that node to the triage envelope and nothing above it.
   */
  /*#__PURE__*/ #serializeCause(
    cause: unknown,
    walk: CauseWalk,
    depth: number,
    context: LogBuildContext,
  ): unknown {
    try {
      return this.#serializeCauseNode(cause, walk, depth, context);
    } catch {
      return UNSERIALIZABLE_CAUSE_MARKER;
    }
  }

  /*#__PURE__*/ #serializeCauseNode(
    cause: unknown,
    walk: CauseWalk,
    depth: number,
    context: LogBuildContext,
  ): unknown {
    if (cause === undefined || cause === null) {
      return cause;
    }

    if (context.budget.nodes >= context.budget.limit) {
      return MAX_LOG_SIZE_MARKER;
    }

    context.budget.nodes++;

    if (depth >= MAX_CAUSE_DEPTH) {
      return MAX_CAUSE_DEPTH_MARKER;
    }

    if (isNativeError(cause)) {
      if (walk.path.has(cause)) {
        return CIRCULAR_CAUSE_CHAIN_MARKER;
      }
      if (walk.seen.has(cause)) {
        return SHARED_CAUSE_MARKER;
      }
      walk.seen.add(cause);
      walk.path.add(cause);
      try {
        return this.#serializeErrorNode(cause, walk, depth, context);
      } finally {
        walk.path.delete(cause);
      }
    }

    // A cause that is not an error is data.
    return serializeLogData(cause, context, "cause", depth);
  }

  /**
   * Writes one error node that the walk reaches for the first time. The node
   * holds its envelope, its structured fields, its own fields, its members
   * and its cause. Its own sticky policy masks the node last.
   */
  /*#__PURE__*/ #serializeErrorNode(
    cause: Error,
    walk: CauseWalk,
    depth: number,
    context: LogBuildContext,
  ): unknown {
    // Every field is a foreign read: a cause is whatever the caller threw.
    // This code runs in a catch path, so a throwing getter reads as absent.
    // Every value is copied as data (see serializeLogData). The log object
    // must not share a reference with the cause. The consumer's
    // JSON.stringify must not meet a bigint or a cycle that the cause carried.
    const name = readProperty(cause, "name");
    const message = readProperty(cause, "message");
    const serialized: Record<string, unknown> = {
      name: BaseError.#serializeEnvelopeField(name, context),
      message: BaseError.#serializeEnvelopeField(message, context),
      stack: BaseError.#serializeEnvelopeField(
        readStack(cause, name, message),
        context,
      ),
    };

    // Preserve StructuredError fields if present (duck-typing). This is the
    // only route for a foreign cause. A plain `Error` that carries these
    // fields, a cross-realm instance and a Proxy have no reachable hook to ask.
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
    // cannot forge an envelope field or a bounded link. Every value is
    // copied as data, like the rest of the node.
    Object.assign(serialized, BaseError.#nodeOwnFields(cause, context));

    // An aggregate's members (`AggregateError.errors`, and any error-like
    // value with the same shape) are own but **non-enumerable** on every
    // supported runtime. So `JSON.stringify` and `Object.entries` drop them
    // exactly like `message`/`stack`. Read explicitly, by shape rather than
    // by `instanceof AggregateError`, so cross-realm and custom fan-out
    // errors serialize too. Without this the branch failures that produced
    // the error never reach the log at all.
    const aggregate = readMembers(cause, MAX_AGGREGATE_MEMBERS + 1);
    if (aggregate !== undefined && aggregate.total > 0) {
      serialized.errors = this.#serializeAggregate(
        aggregate,
        walk,
        depth + 1,
        context,
      );
    }

    // Recursively serialize nested causes
    const nested = readProperty(cause, "cause");
    if (nested !== undefined) {
      serialized.cause = this.#serializeCause(nested, walk, depth + 1, context);
    }

    // The cause's own sticky policy runs last, over the node and the subtree
    // serialized above it. So the policy covers the descendants of the cause
    // exactly as it does when the cause logs itself. Bottom-up by
    // construction: every deeper node applied its own policy first. The
    // enclosing error's redactor walks the result afterwards.
    const redactor = BaseError.#redactorOf(cause);
    if (redactor === undefined) return serialized;
    const masked = redactor(serialized);
    // A custom policy returns consumer data. The copier turns it into plain
    // log data, so the policy of an outer error walks plain data only.
    return BaseError.#sameRealm(cause) && cause.#customPolicy
      ? serializeLogData(masked, context, "cause", depth)
      : masked;
  }

  /** The fixed envelope must never turn a scalar decision into a size marker. */
  static #serializeEnvelopeField(
    value: unknown,
    context: LogBuildContext,
  ): unknown {
    if (context.budget.nodes >= context.budget.limit) {
      if (typeof value === "number") return normalizeLogNumber(value);
      if (
        value === null ||
        typeof value === "string" ||
        typeof value === "boolean"
      )
        return value;
      // An exhausted envelope omits other values instead of forging a scalar.
      return undefined;
    }
    return serializeLogData(value, context);
  }

  /**
   * Serializes an aggregate's members, at most {@link MAX_AGGREGATE_MEMBERS}.
   * The reader takes one entry past the cap, so the tail of a list from an
   * earlier log keeps its count; the count that the reader reports marks
   * any other remainder. Members share the enclosing cause walk. So the serializer
   * writes an error that more than one branch reaches at its first
   * occurrence, and marks it as shared afterwards. A self-referencing
   * aggregate ends in the circular marker. `depth` is the cause hop of the
   * aggregate that holds the members.
   */
  /*#__PURE__*/ #serializeAggregate(
    aggregate: AggregateMembers,
    walk: CauseWalk,
    depth: number,
    context: LogBuildContext,
  ): unknown[] {
    const { members, total } = aggregate;
    const serialized: unknown[] = [];
    for (const error of members.slice(0, MAX_AGGREGATE_MEMBERS)) {
      if (context.budget.nodes >= context.budget.limit) {
        serialized.push(MAX_LOG_SIZE_MARKER);
        return serialized;
      }
      serialized.push(this.#serializeCause(error, walk, depth, context));
    }

    const dropped = total - serialized.length;
    if (dropped > 0) {
      serialized.push(
        droppedMembersMarker(dropped, members[serialized.length]),
      );
    }
    return serialized;
  }

  /**
   * Captures the stack now but defers symbolization and filtering to the
   * first read. V8 formats stacks lazily (via `Error.prepareStackTrace`), only
   * when code reads `stack`. A read in the constructor would force that work
   * for every error, including errors that are caught and never logged. So
   * the raw capture lands on a side holder, and `this.stack` becomes a
   * memoizing accessor. The first get symbolizes, filters, and replaces
   * itself with a plain writable data property. A set before the first get
   * (a rehydrated or user-assigned stack) wins unfiltered.
   *
   * This capture duplicates the one `super()` already performed, and that is
   * deliberate: both remedies measure or behave worse. If `super()` runs with
   * `Error.stackTraceLimit = 0` to suppress the first capture, V8 deopts its
   * capture fast path process-wide. A measurement on Node 24 showed
   * construction 4x slower, and plain `new Error` slower for the rest of the
   * process. And the frames that `super()` captured cannot replace the
   * frames of the holder. On V8 11 (for example Chromium 110 to 119), a read
   * of their descriptor materializes them eagerly. On V8 12+, they lack the
   * constructor trimming that `captureStackTrace` gives the holder. The unread
   * first capture costs ~1 microsecond. The `delete` of the own `stack` in
   * this method discards it unformatted.
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
    // The code removes the engine-managed `stack` that `super()` captured,
    // and does not redefine over it. On V8 11 (for example Chromium 110 to
    // 119), a redefinition materializes the held stack first. That calls
    // `Error.prepareStackTrace` eagerly for frames that nobody reads.
    // `delete` discards them without formatting on every engine; V8 12+
    // (`stack` as a plain accessor pair) needs neither.
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
    filteredLines.push(
      `${renderValue(this.name)}: ${renderValue(this.message)}`,
    );

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
