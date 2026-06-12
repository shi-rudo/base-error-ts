// This avoids polluting the global scope
interface V8ErrorConstructor {
  captureStackTrace?(
    targetObject: object,
    constructorOpt?: (...args: unknown[]) => unknown,
  ): void;
}

export const DEFAULT_PUBLIC_ERROR_CODE = "INTERNAL_ERROR" as const;
export const DEFAULT_PUBLIC_ERROR_CATEGORY = "INTERNAL" as const;
export const DEFAULT_PUBLIC_ERROR_MESSAGE =
  "An unexpected error occurred." as const;

export type BaseErrorOptions<TPublicCode extends string = string> = {
  /** Override the runtime error name. Intended for framework errors with stable codes. */
  name?: string;
  /** Stable, client-safe error code. */
  publicCode?: TPublicCode;
  /** Client-safe message. */
  publicMessage?: string;
  /** Allows technical name/message fallback in explicit public serialization. */
  expose?: boolean;
};

export type PublicErrorOptions<TCode extends string = string> = {
  /** Per-call public code override. */
  code?: TCode;
  /** Per-call public message override. */
  message?: string;
  /** Per-call exposure override. */
  expose?: boolean;
  /** Optional correlation id for public responses. */
  traceId?: string;
  /**
   * Preferred locale for the client-safe message. When set and a matching
   * user/localized message exists, it is used as the public message — these
   * are author-provided, client-safe strings, so they surface without `expose`.
   */
  locale?: string;
  /** Fallback locale used when the preferred locale has no message. */
  fallbackLocale?: string;
};

export type PublicErrorJSON<TCode extends string = string> = {
  code: TCode;
  message: string;
  traceId?: string;
};

/**
 * Replacement used by {@link BaseError.redact}/{@link BaseError.redactAllow}.
 * Either a fixed value, or a function of the original `(value, key)` — useful
 * for partial masking (`****6789`) or preserving the value's type.
 */
export type RedactMask = string | ((value: unknown, key: string) => unknown);

/**
 * Where a node sits in the log tree, for `redactAllow`'s structure-vs-data
 * decision: `"root"` (top-level envelope, kept), `"cause"` (a cause's top level
 * — structural envelope keys kept, the rest data), `"data"` (a `details`
 * subtree or a cause's foreign subtree — every leaf is data). The deny-list
 * (`redact`) ignores it.
 */
type RedactRegion = "root" | "cause" | "data";

/**
 * Application-specific base error that works across full Node.js, isolate "edge"
 * runtimes (Cloudflare Workers, Deno Deploy, Vercel Edge Functions) and modern
 * browsers. It preserves the native `cause` field where available, falls back
 * gracefully where it is not, and produces the richest stack trace the host
 * can provide.
 *
 * This class includes support for default and localized user-friendly messages.
 *
 * @example
 * ```ts
 * // Using automatic name inference
 * class UserNotFoundError extends BaseError<'UserNotFoundError'> {
 * constructor(userId: string) {
 * super(`User with id ${userId} not found in database lookup`); // Technical message
 * this.withUserMessage(`User ${userId} was not found.`); // User-friendly message
 * }
 * }
 * ```
 */
export class BaseError<
  T extends string,
  TPublicCode extends string = string,
> extends Error {
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
   * `name`, or override `_tag` with a literal — the latter also narrows the
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

  /** ISO-8601 timestamp (string) for log aggregators that prefer text */
  public readonly timestampIso: string = new Date().toISOString();

  /** Rich, filtered stack where the host supports it. */
  public override readonly stack?: string;

  // --- Properties for user-friendly messages ---
  private _defaultUserMessage?: string;
  private _localizedMessages = new Map<string, string>();
  private _publicCode?: TPublicCode;
  private _publicMessage?: string;
  private _expose = false;
  #redactor?: (log: Record<string, unknown>) => Record<string, unknown>;

  /**
   * Creates a new BaseError instance with automatic name inference.
   *
   * @param message – Human-readable explanation (name will be inferred from constructor)
   * @param cause   – Optional underlying error or extra context
   * @param options – Optional public serialization and runtime name settings
   */
  // The /*#__PURE__*/ pragma lets tree-shakers know the constructor is side-effect free
  public /*#__PURE__*/ constructor(
    message: string,
    cause?: unknown,
    options: BaseErrorOptions<TPublicCode> = {},
  ) {
    // Always call super with just message for TypeScript compatibility
    super(message);

    // Resolve the error's stable identity once. An explicit `name` wins;
    // otherwise fall back to the constructor name. Both `name` and `_tag`
    // derive from it so they can never diverge — and passing an explicit
    // `name` stabilizes the discriminant under class-name minification.
    const resolvedName = options.name ?? this.constructor.name;
    this.name = resolvedName as T;
    this._tag = resolvedName;
    this._publicCode = options.publicCode;
    this._publicMessage = options.publicMessage;
    this._expose = options.expose ?? false;

    // Handle cause with native support when available, fallback otherwise
    if (cause !== undefined) {
      this.#setCause(cause);
    }

    // Preserve prototype chain for `instanceof` checks after transpilation.
    Object.setPrototypeOf(this, new.target.prototype);

    // Cross-runtime best-effort stack collection
    this.stack = this.#captureStack();
  }

  // ————————————————————————————————————————————————————————————————
  // Methods for User-Friendly Messages
  // ————————————————————————————————————————————————————————————————

  /**
   * Sets the default user-friendly message.
   * This is used as a fallback when a specific localization is not available.
   * @param message The default user-friendly message (typically in English).
   * @returns The error instance for chaining.
   */
  public withUserMessage(message: string): this {
    this._defaultUserMessage = message;
    return this;
  }

  /**
   * Adds a user-friendly message for a specific language.
   * Throws an error if a message for the given language already exists.
   * @param lang The language code (e.g., 'de', 'es', 'fr-CA').
   * @param message The localized message.
   * @returns The error instance for chaining.
   * @throws Error if a message for the given language already exists.
   */
  public addLocalizedMessage(lang: string, message: string): this {
    if (this._localizedMessages.has(lang)) {
      throw new Error(
        `Localized message for language '${lang}' already exists. Use updateLocalizedMessage() to modify existing messages.`,
      );
    }
    this._localizedMessages.set(lang, message);
    return this;
  }

  /**
   * Updates or sets a user-friendly message for a specific language.
   * This method allows overwriting existing messages for the same language.
   * @param lang The language code (e.g., 'de', 'es', 'fr-CA').
   * @param message The localized message.
   * @returns The error instance for chaining.
   */
  public updateLocalizedMessage(lang: string, message: string): this {
    this._localizedMessages.set(lang, message);
    return this;
  }

  /**
   * Sets a stable, client-safe error code for public serialization.
   * Use this to map internal domain or infrastructure failures to API codes.
   */
  public withPublicCode(code: TPublicCode): this {
    this._publicCode = code;
    return this;
  }

  /**
   * Sets a client-safe message for public serialization.
   */
  public withPublicMessage(message: string): this {
    this._publicMessage = message;
    return this;
  }

  /**
   * Enables or disables technical name/message fallback for public serialization.
   */
  public exposeToClients(expose = true): this {
    this._expose = expose;
    return this;
  }

  /**
   * Redacts the given keys (deep, at any depth) from the **log** output
   * (`toLogObject`/`toJSON`). Sticky on the instance, so it also applies when a
   * logger auto-serializes the error via `JSON.stringify`. Does not affect the
   * client serializers, which are already safe by default.
   *
   * @param keys - Property names to mask wherever they appear in the log object.
   * @param options - `mask` defaults to `"[REDACTED]"`.
   */
  public redact(keys: string[], options?: { mask?: RedactMask }): this {
    const mask = options?.mask ?? "[REDACTED]";
    const denied = new Set(keys);
    this.#redactor = (log) =>
      BaseError.#redactWalk(
        log,
        (key, value) =>
          denied.has(key)
            ? BaseError.#applyMask(mask, value, key)
            : BaseError.#RECURSE,
        "root",
      ) as Record<string, unknown>;
    return this;
  }

  /**
   * Allow-list redaction (higher assurance than {@link redact}): within any
   * **data** region — a `details` subtree (at any depth) and the data-bearing
   * fields of a `cause` — masks every leaf whose key is **not** listed, so a
   * newly-added field leaks nothing by default. Container objects are recursed
   * so nested allowed leaves survive. The structural envelope (`message`/`code`/
   * …) at the top level, and a cause's top-level structural envelope keys
   * (`name`/`message`/`stack`/`code`/`category`/`retryable`), are kept — but a
   * cause's foreign fields (anything outside that fixed set, and everything
   * nested beneath them) are treated as data, so a plain object that merely
   * *looks* like a structured error cannot smuggle siblings — or envelope-named
   * keys buried in foreign subtrees — through. Sticky; last redactor wins.
   *
   * @param keys - Data leaf keys allowed to survive in the log.
   * @param options - `mask` defaults to `"[REDACTED]"`.
   */
  public redactAllow(keys: string[], options?: { mask?: RedactMask }): this {
    const mask = options?.mask ?? "[REDACTED]";
    const allow = new Set(keys);
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
            region === "root" ||
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
   * siblings — or envelope-named keys buried in foreign subtrees — past
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

  /*#__PURE__*/ static #applyMask(
    mask: RedactMask,
    value: unknown,
    key: string,
  ): unknown {
    return typeof mask === "function" ? mask(value, key) : mask;
  }

  /**
   * Whether the walker should descend into `value`. A **plain object**
   * (`{}` / `Object.create(null)`) is always a container — even when empty, so
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
   * - `"root"` — the top-level error envelope (kept verbatim by the allow-list);
   * - `"cause"` — at a `cause`'s top level; the structural envelope keys
   *   (`#ENVELOPE_KEYS`) are kept, all other leaves are data;
   * - `"data"` — inside a `details` subtree or a cause's foreign subtree; every
   *   leaf is data.
   *
   * The transition is by key name only — no duck-typing — so a cause that
   * merely resembles a structured error cannot reclassify its data as envelope.
   * The deny-list ignores `region`.
   */
  /*#__PURE__*/ static #redactWalk(
    value: unknown,
    decide: (key: string, value: unknown, region: RedactRegion) => unknown,
    region: RedactRegion,
  ): unknown {
    if (Array.isArray(value)) {
      return value.map((item) => BaseError.#redactWalk(item, decide, region));
    }
    if (BaseError.#isWalkable(value)) {
      const out: Record<string, unknown> = {};
      for (const [key, val] of Object.entries(value)) {
        // A leaf's keep/mask decision is made in the region it *lives in* (the
        // parent); the child region only governs recursion. Conflating the two
        // wrongly masks a region-transition key that holds a leaf (e.g. a
        // top-level `cause: undefined`).
        const decision = decide(key, val, region);
        if (decision === BaseError.#RECURSE) {
          out[key] =
            Array.isArray(val) || BaseError.#isWalkable(val)
              ? BaseError.#redactWalk(
                  val,
                  decide,
                  BaseError.#childRegion(region, key),
                )
              : val;
        } else {
          out[key] = decision;
        }
      }
      return out;
    }
    return value;
  }

  /**
   * Region a child key enters. `details` → data (data is sticky for the whole
   * subtree); `cause` → cause. Inside a `cause`, only the structural envelope
   * keys stay `cause`; every other (foreign) child — and therefore everything
   * nested beneath it — drops to data, so envelope-named keys buried in a
   * cause's foreign subtrees cannot be mistaken for the cause's own envelope.
   */
  /*#__PURE__*/ static #childRegion(
    region: RedactRegion,
    key: string,
  ): RedactRegion {
    if (region === "data") return "data";
    if (key === "details") return "data";
    if (key === "cause") return "cause";
    if (region === "cause") {
      return BaseError.#ENVELOPE_KEYS.has(key) ? "cause" : "data";
    }
    return region;
  }

  /**
   * Sets a custom redactor applied to the full log object — use for allow-lists
   * or scrubbing the technical `message`. Sticky; the last redactor wins.
   */
  public redactWith(
    redactor: (log: Record<string, unknown>) => Record<string, unknown>,
  ): this {
    this.#redactor = redactor;
    return this;
  }

  /**
   * Retrieves the most appropriate user-friendly message based on language preference.
   * The fallback order is: preferred language -> fallback language -> default message.
   * @param options - Language preference options.
   * @returns The user-friendly message, or `undefined` if none is set.
   */
  public getUserMessage(options?: {
    preferredLang?: string;
    fallbackLang?: string;
  }): string | undefined {
    const { preferredLang, fallbackLang } = options || {};

    // 1. Try to get the message for the preferred language.
    if (preferredLang && this._localizedMessages.has(preferredLang)) {
      return this._localizedMessages.get(preferredLang);
    }

    // 2. If not found, try the fallback language (e.g., 'en').
    if (fallbackLang && this._localizedMessages.has(fallbackLang)) {
      return this._localizedMessages.get(fallbackLang);
    }

    // 3. If still not found, return the default user message.
    return this._defaultUserMessage;
  }

  /**
   * Assembles the raw log object (no redaction). Subclasses override this to
   * add their own fields; the public {@link toLogObject} applies redaction to
   * the complete assembled object.
   */
  protected buildLogObject(): Record<string, unknown> {
    const { name, message, timestamp, timestampIso, stack } = this;
    const cause = (this as unknown as Record<string, unknown>).cause;

    const json: Record<string, unknown> = {
      name,
      message, // The original technical message
      timestamp,
      timestampIso,
      stack,
      cause: this.#serializeCause(cause, new Set()),
    };

    // Add user messages to the JSON output for logging if they exist
    if (this._defaultUserMessage !== undefined) {
      json.userMessage = this._defaultUserMessage;
    }
    if (this._localizedMessages.size > 0) {
      json.localizedMessages = Object.fromEntries(this._localizedMessages);
    }

    return json;
  }

  /**
   * Serialises the error for logs. Includes technical message, stack and cause,
   * with the instance redactor applied (see {@link redact} / {@link redactWith}).
   */
  public toLogObject(): Record<string, unknown> {
    const raw = this.buildLogObject();
    if (!this.#redactor) {
      return raw;
    }
    try {
      return this.#redactor(raw);
    } catch {
      // Fail-closed: a broken redactor must neither crash the logging path nor
      // leak the unredacted payload (message/details/stack/cause are dropped).
      // Keep only the non-sensitive structural fields needed for triage.
      const safe: Record<string, unknown> = {
        message: "[log redaction failed]",
      };
      for (const key of BaseError.#SAFE_TRIAGE_KEYS) {
        if (key in raw) {
          safe[key] = raw[key];
        }
      }
      return safe;
    }
  }

  /**
   * Non-sensitive structural fields preserved in the fail-closed redaction
   * marker. Only those a given error's `buildLogObject()` actually emits are
   * copied (guarded by `key in raw`), so `code`/`category`/`retryable` appear
   * for a `StructuredError` but are simply absent for a plain `BaseError`.
   * `traceId` is intentionally not listed — it is a serialization parameter of
   * the client path, never a log-object field.
   */
  static readonly #SAFE_TRIAGE_KEYS = [
    "name",
    "code",
    "category",
    "retryable",
    "timestamp",
    "timestampIso",
  ] as const;

  /** Backwards-compatible JSON serialization for logging-oriented consumers. */
  public toJSON(): Record<string, unknown> {
    return this.toLogObject();
  }

  /**
   * Resolves a single client-safe localized message from the author-provided
   * locale entries: the preferred `locale` first, then `fallbackLocale`. Returns
   * the matched message **tagged with the locale that actually produced it**, or
   * `undefined` when neither has an entry.
   *
   * This is the single source of truth for locale resolution, shared by
   * {@link toPublicJSON} (which renders the string) and the response serializers
   * (which also tag it with its locale via `messageLocalized`). Author-provided
   * localized messages are client-safe by design, so this resolves them without
   * needing `expose`; the default user message is never surfaced here.
   */
  protected resolveLocalizedMessage(
    locale?: string,
    fallbackLocale?: string,
  ): { locale: string; message: string } | undefined {
    if (locale !== undefined) {
      const message = this._localizedMessages.get(locale);
      if (message !== undefined) return { locale, message };
    }
    if (fallbackLocale !== undefined) {
      const message = this._localizedMessages.get(fallbackLocale);
      if (message !== undefined) return { locale: fallbackLocale, message };
    }
    return undefined;
  }

  /**
   * Serializes the error for client-facing responses.
   *
   * This method is safe by default: it does not expose the technical error name,
   * technical message, stack trace, cause chain, or structured details unless
   * explicitly configured with public fields or `expose`.
   */
  public toPublicJSON(options: PublicErrorOptions = {}): PublicErrorJSON {
    const expose = options.expose ?? this._expose;
    const code =
      options.code ??
      this._publicCode ??
      (expose ? this.name : DEFAULT_PUBLIC_ERROR_CODE);
    const localized = this.resolveLocalizedMessage(
      options.locale,
      options.fallbackLocale,
    )?.message;
    const message =
      options.message ??
      localized ??
      this._publicMessage ??
      (expose
        ? (this.getUserMessage() ?? this.message)
        : DEFAULT_PUBLIC_ERROR_MESSAGE);

    return {
      code,
      message,
      ...(options.traceId !== undefined && { traceId: options.traceId }),
    };
  }

  protected shouldExposeToClients(): boolean {
    return this._expose;
  }

  /** Readable one-liner plus full nested cause chain. */
  public override toString(): string {
    const parts: string[] = [];
    let current: unknown = this as unknown;
    const seen = new Set<unknown>();

    while (current != null) {
      if (seen.has(current)) {
        parts.push("[Circular cause chain]");
        break;
      }
      seen.add(current);

      if (current instanceof BaseError) {
        parts.push(`[${current.name}] ${current.message}`);
      } else if (current instanceof Error) {
        parts.push(`${current.name}: ${current.message}`);
      } else {
        parts.push(String(current));
      }

      current =
        typeof current === "object" && current !== null && "cause" in current
          ? (current as Record<string, unknown>).cause
          : undefined;
    }

    return parts.join("\nCaused by: ");
  }

  // ————————————————————————————————————————————————————————————————
  // Internal helpers
  // ————————————————————————————————————————————————————————————————

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
      (this as unknown as Record<string, unknown>).cause = cause;
    }
  }

  /**
   * Intelligently serializes the cause for JSON output.
   * Preserves stack traces, StructuredError fields, and nested data.
   * Uses a seen set to detect circular cause chains.
   */
  /*#__PURE__*/ #serializeCause(cause: unknown, seen: Set<unknown>): unknown {
    if (cause === undefined || cause === null) {
      return cause;
    }

    if (cause instanceof Error) {
      if (seen.has(cause)) {
        return "[Circular cause chain]";
      }
      seen.add(cause);

      const serialized: Record<string, unknown> = {
        name: cause.name,
        message: cause.message,
        stack: cause.stack,
      };

      // Preserve StructuredError fields if present (duck-typing)
      // This avoids circular dependency between BaseError and StructuredError
      const errorRecord = cause as unknown as Record<string, unknown>;
      if ("code" in cause) serialized.code = errorRecord.code;
      if ("category" in cause) serialized.category = errorRecord.category;
      if ("retryable" in cause) serialized.retryable = errorRecord.retryable;
      if ("details" in cause) serialized.details = errorRecord.details;

      // Recursively serialize nested causes
      if ("cause" in cause && errorRecord.cause !== undefined) {
        serialized.cause = this.#serializeCause(errorRecord.cause, seen);
      }

      return serialized;
    }

    if (typeof cause === "object" && cause !== null) {
      try {
        // For plain objects, try to serialize them directly
        // This preserves structured data that might be useful for debugging
        return JSON.parse(JSON.stringify(cause));
      } catch {
        // If JSON.stringify fails (circular references, etc.), create a more useful representation
        return this.#serializeCircularObject(cause);
      }
    }

    // For primitives (string, number, boolean), return as-is
    return cause;
  }

  /**
   * Creates a more useful representation of circular objects for debugging.
   * Instead of just "[object Object]", it extracts key information.
   */
  /*#__PURE__*/ #serializeCircularObject(obj: object): string {
    const type = obj.constructor?.name || "Object";
    const keys = Object.keys(obj).slice(0, 5); // Show first 5 keys
    const keyInfo = keys.length > 0 ? ` with keys: [${keys.join(", ")}]` : "";
    const moreKeys = Object.keys(obj).length > 5 ? "..." : "";

    return `[Circular ${type}${keyInfo}${moreKeys}]`;
  }

  /**
   * Captures and filters the stack trace without affecting global state.
   * Filters out internal BaseError frames for cleaner stack traces.
   */
  /*#__PURE__*/ #captureStack(): string | undefined {
    // Cast Error to our local interface for type-safe access.
    const V8Error = Error as V8ErrorConstructor;

    // First, try to capture stack directly on this instance when possible
    if (typeof V8Error.captureStackTrace === "function") {
      // V8/Node.js: Capture stack directly on this instance, excluding constructor
      V8Error.captureStackTrace(
        this,
        this.constructor as (...args: unknown[]) => unknown,
      );
      return this.#filterInternalFrames(this.stack);
    }

    // For non-V8 engines, create a temporary error to get the stack
    let tempStack: string | undefined;
    try {
      throw new Error();
    } catch (e) {
      tempStack = (e as Error).stack;
    }

    if (!tempStack) {
      return undefined;
    }

    // Filter out internal frames and update the header
    return this.#filterInternalFrames(tempStack);
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
        line.includes("#captureStack") ||
        line.includes("#filterInternalFrames") ||
        line.includes("BaseError.constructor") ||
        line.includes("new BaseError") ||
        line.includes("captureStack_fn") || // Compiled private method name
        line.includes("filterInternalFrames_fn") || // Compiled private method name
        // Skip the temporary error creation frame
        (line.includes("Object.<anonymous>") && line.includes("captureStack"))
      ) {
        continue;
      }

      filteredLines.push(line);
    }

    return filteredLines.join("\n");
  }
}
