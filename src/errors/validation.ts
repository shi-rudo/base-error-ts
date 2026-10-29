import { StructuredError } from "./StructuredError.js";
import { readProperty } from "./guarded-read.js";

/**
 * A single validation issue. Structurally identical to Standard Schema's
 * `Issue` (standardschema.dev), so Zod / Valibot / ArkType / TanStack Form
 * output pipes in unchanged, with no dependency. Extra fields a validator
 * attaches are kept for logs but never cross to a client.
 */
export type ValidationIssue = {
  /**
   * Human-readable message. A validator's default message can embed the
   * rejected value, so `publicIssues()` leaves it out unless `messages` is true.
   */
  readonly message: string;
  /** Path to the offending value (Standard Schema form). */
  readonly path?: ReadonlyArray<PropertyKey | { readonly key: PropertyKey }>;
};

/** The fixed, client-safe shape an issue takes on the wire. */
export type PublicIssue = {
  /**
   * Included only when `messages` is true and the source issue carried a
   * string message.
   */
  message?: string;
  /**
   * The path of the source issue, with each key copied. `null` stands for a
   * key that is no property key, such as an object key of a `Map`.
   */
  path?: ReadonlyArray<
    PropertyKey | null | { readonly key: PropertyKey | null }
  >;
  /** Included only when the source issue carried one. */
  code?: string;
  /**
   * The path segments joined with dots (e.g. "address.zip"), for HTTP clients.
   * Not an RFC 6901 JSON Pointer ("/address/zip").
   */
  pointer?: string;
};

/** Options for {@link ValidationError}. */
export type ValidationErrorOptions<
  TCode extends string,
  TCategory extends string,
> = {
  issues?: readonly ValidationIssue[];
  cause?: unknown;
  /** Override the code (default `"VALIDATION_FAILED"`). */
  code?: TCode;
  /** Override the category (default `"VALIDATION"`). */
  category?: TCategory;
};

/** Options for {@link ValidationError.publicIssues}. */
export type PublicIssuesOptions = {
  /**
   * Adds the `message` of each issue. The default messages of Valibot and
   * ArkType (and of Zod 3 for `enum`) embed the rejected value. Set it only
   * for messages that you wrote.
   */
  readonly messages?: boolean;
};

/**
 * Aggregate error for validation: collects N field-level issues into one
 * `StructuredError`. Issues are stored in full for logs, but only ever cross to
 * a client through the safe `publicIssues()` whitelist, on explicit opt-in.
 *
 * @example
 * ```ts
 * const v = new ValidationError("Registration is invalid");
 * if (!isEmail(email)) v.addIssue({ message: "Enter a valid email.", path: ["email"] });
 * if (v.hasIssues()) throw v;
 *
 * // or ingest a Standard Schema validator's output directly:
 * const result = schema["~standard"].validate(input);
 * if (result.issues) throw new ValidationError("Invalid input", { issues: result.issues });
 * ```
 */
export class ValidationError<
  TCode extends string = "VALIDATION_FAILED",
  TCategory extends string = "VALIDATION",
> extends StructuredError<TCode, TCategory, { issues: ValidationIssue[] }> {
  public override readonly _tag: string = "ValidationError";

  /** Live array shared by reference with `details.issues` (full, with extras). */
  readonly #issues: ValidationIssue[];

  public constructor(
    message: string,
    options?: ValidationErrorOptions<TCode, TCategory>,
  ) {
    const issues = options?.issues ? [...options.issues] : [];
    super({
      code: (options?.code ?? "VALIDATION_FAILED") as TCode,
      category: (options?.category ?? "VALIDATION") as TCategory,
      retryable: false,
      message,
      details: { issues },
      ...(options?.cause !== undefined && { cause: options.cause }),
    });
    this.#issues = issues;
  }

  public addIssue(issue: ValidationIssue): this {
    this.#issues.push(issue);
    return this;
  }

  public addIssues(issues: readonly ValidationIssue[]): this {
    this.#issues.push(...issues);
    return this;
  }

  public hasIssues(): boolean {
    return this.#issues.length > 0;
  }

  public get issues(): readonly ValidationIssue[] {
    return this.#issues;
  }

  /**
   * Projection of the issues for a client with a custom wire shape, such as
   * RFC 7807 `{ name, reason }`. The mapper replaces the default whitelist. It
   * receives the raw issue with all validator extras, so it applies its own
   * whitelist.
   */
  public publicIssues<TWire>(options: {
    readonly mapIssue: (issue: ValidationIssue) => TWire;
  }): TWire[];
  /**
   * Projection of the issues for a client. Returns only the fixed whitelist
   * `path`, `pointer` and `code`, and never the raw validator extras. The
   * `message` crosses only when `messages` is true, because a validator's
   * default message can embed the rejected value.
   */
  public publicIssues(options?: PublicIssuesOptions): PublicIssue[];
  public publicIssues(
    options?: PublicIssuesOptions & {
      readonly mapIssue?: (issue: ValidationIssue) => unknown;
    },
  ): unknown[] {
    const mapIssue = options?.mapIssue;
    if (mapIssue !== undefined) return this.#issues.map(mapIssue);
    const withMessages = options?.messages === true;
    return this.#issues.map((issue) =>
      ValidationError.#defaultProjection(issue, withMessages),
    );
  }

  static #defaultProjection(
    issue: ValidationIssue,
    withMessages: boolean,
  ): PublicIssue {
    const out: PublicIssue = {};
    if (withMessages) {
      const message = readProperty(issue, "message");
      if (typeof message === "string") out.message = message;
    }
    const path = readProperty(issue, "path");
    if (Array.isArray(path)) {
      // Fresh copy with object segments narrowed to { key }. A validator can
      // attach internals to segment objects (Valibot puts the parent input and
      // the rejected value there). The whitelist must not carry them (or a
      // shared array reference) to the wire.
      const segments = path.map((segment: unknown) =>
        typeof segment === "object" && segment !== null
          ? {
              key: ValidationError.#toPropertyKey(readProperty(segment, "key")),
            }
          : ValidationError.#toPropertyKey(segment),
      );
      out.path = segments;
      out.pointer = segments
        .map((segment) =>
          typeof segment === "object" && segment !== null
            ? segment.key
            : segment,
        )
        .map((key) => String(key))
        .join(".");
    }
    const code = readProperty(issue, "code");
    if (typeof code === "string") {
      out.code = code;
    }
    return out;
  }

  // A `Map` key can be any value. Only a property key names a field without
  // carrying data of its own.
  static #toPropertyKey(key: unknown): PropertyKey | null {
    return typeof key === "string" ||
      typeof key === "number" ||
      typeof key === "symbol"
      ? key
      : null;
  }
}
