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
   * Human-readable message. It crosses `publicIssues()` unchanged, and a
   * validator's default message can embed the rejected value.
   */
  readonly message: string;
  /** Path to the offending value (Standard Schema form). */
  readonly path?: ReadonlyArray<PropertyKey | { readonly key: PropertyKey }>;
};

/** The fixed, client-safe shape an issue takes on the wire. */
export type PublicIssue = {
  message: string;
  path?: ReadonlyArray<PropertyKey | { readonly key: PropertyKey }>;
  /** Included only when the source issue carried one. */
  code?: string;
  /** Derived string path (e.g. "address.zip") for HTTP clients. */
  pointer?: string;
};

/** Options for {@link ValidationError}. */
export type ValidationErrorOptions<
  TCode extends string,
  TCategory extends string,
> = {
  issues?: ValidationIssue[];
  cause?: unknown;
  /** Override the code (default `"VALIDATION_FAILED"`). */
  code?: TCode;
  /** Override the category (default `"VALIDATION"`). */
  category?: TCategory;
};

/** Options for {@link ValidationError.publicIssues}. */
export type PublicIssuesOptions = {
  /**
   * Fully customize the wire shape (e.g. RFC-7807 `{ name, reason }`).
   * Replaces the default whitelist entirely: a custom mapper receives the raw
   * issue (validator extras included) and must apply its own whitelist,
   * including copying `path` and narrowing object segments to `{ key }` if it
   * forwards them.
   */
  mapIssue?: (issue: ValidationIssue) => PublicIssue;
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

  public addIssues(issues: ValidationIssue[]): this {
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
   * Projection of the issues for a client. Returns only the fixed whitelist
   * (`message`, `path`, `code?`, `pointer?`); raw validator extras are never included.
   * `message` crosses unchanged, and the default messages of Valibot and ArkType
   * (and of Zod 3 for `enum`) embed the rejected value. When the messages are
   * not yours, project `pointer` and `code` only, or provide `mapIssue` to emit
   * a fully custom wire shape (e.g. RFC-7807 `{ name, reason }`).
   */
  public publicIssues(options?: PublicIssuesOptions): PublicIssue[] {
    const mapIssue = options?.mapIssue ?? ValidationError.#defaultProjection;
    return this.#issues.map(mapIssue);
  }

  static #defaultProjection(issue: ValidationIssue): PublicIssue {
    const out: PublicIssue = { message: issue.message };
    if (issue.path !== undefined) {
      // Fresh copy with object segments narrowed to { key }: a validator may
      // attach internals to segment objects, and the whitelist must not carry
      // them (or a shared array reference) to the wire.
      out.path = issue.path.map((segment) =>
        typeof segment === "object" && segment !== null
          ? { key: segment.key }
          : segment,
      );
      out.pointer = ValidationError.#toPointer(issue.path);
    }
    const code = readProperty(issue, "code");
    if (typeof code === "string") {
      out.code = code;
    }
    return out;
  }

  static #toPointer(
    path: ReadonlyArray<PropertyKey | { readonly key: PropertyKey }>,
  ): string {
    return path
      .map((segment) => (typeof segment === "object" ? segment.key : segment))
      .map((key) => String(key))
      .join(".");
  }
}
