import type { LocalizedMessageSet } from "./LocalizedMessageSet.js";
import { resolveByCodeThenPredicate } from "../utils/error-resolution.js";
import type { PredicateEntry } from "../utils/error-resolution.js";
import {
  isHttpStatusCode,
  isNonEmptyString,
} from "../utils/problem-validation.js";
import type {
  OnProject,
  ProjectionOutcome,
  PublicError,
  PublicErrorDescriptor,
} from "./types.js";

/** A descriptor with its types erased, as stored and returned by the catalog. */
type AnyDescriptor = PublicErrorDescriptor<unknown, unknown>;

/**
 * The static wire metadata of a public code, as read by {@link toProblem}:
 * status, the RFC 9457 type, and the static developer-facing title.
 */
export type Transport = {
  readonly status: number;
  readonly type?: string;
  /** Static, developer-facing problem-type summary (RFC 9457 `title`). */
  readonly title?: string;
};

/** Transport plus the curated category, kept internal for the conflict check. */
type StoredTransport = Transport & { readonly category?: string };

/**
 * The outcome of resolving an error against the catalog. `matcherThrew` lets a
 * caller distinguish a genuine miss from a broken matcher, mirroring the
 * presentation registry.
 */
export type CatalogResolution =
  | {
      readonly found: true;
      readonly via: "code" | "predicate";
      readonly descriptor: AnyDescriptor;
      readonly matcherThrew: boolean;
    }
  | { readonly found: false; readonly matcherThrew: boolean };

/**
 * The single source of truth: one descriptor per public error code, addressable
 * both by the internal error `code`/predicate (for {@link project}) and by
 * public code (for {@link toProblem}'s transport facet and {@link localize}'s
 * messages). Unifies what used to be a registry (messages/details) plus a
 * separate adapter map (status/type), so the two cannot drift.
 *
 * Resolution order matches the presentation registry: exact internal `code`,
 * then predicate matchers in registration order, then a miss (the `fallback`).
 */
export class PublicErrorCatalog<TPublicCode extends string = string> {
  readonly #byCode = new Map<string, AnyDescriptor>();
  readonly #predicates: Array<PredicateEntry<AnyDescriptor>> = [];
  readonly #transportByPublicCode = new Map<string, StoredTransport>();
  readonly #messagesByPublicCode = new Map<string, LocalizedMessageSet>();
  readonly #onProject: OnProject | undefined;
  readonly #categories: ReadonlySet<string> | undefined;

  /** The generic descriptor used for any unmatched error. */
  public readonly fallback: AnyDescriptor;

  public constructor(options: {
    fallback: PublicErrorDescriptor<never, never, TPublicCode>;
    /** Fire-and-forget observer invoked once per {@link project} through this catalog. */
    onProject?: OnProject;
    /**
     * Optional closed vocabulary for the advisory public `category`. When given,
     * every descriptor's `category` must be a member, validated at registration
     * to prevent drift. `category` remains advisory: branch on `publicCode`.
     */
    categories?: readonly string[];
  }) {
    this.fallback = options.fallback as AnyDescriptor;
    this.#onProject = options.onProject;
    this.#categories =
      options.categories !== undefined
        ? new Set(options.categories)
        : undefined;
    this.#index(this.fallback);
    if (
      this.#categories !== undefined &&
      this.fallback.category === undefined
    ) {
      throw new Error(
        "PublicErrorCatalog: the fallback must declare a category when categories are declared; it is the bucket a client uses for codes it does not recognize.",
      );
    }
  }

  /**
   * Invokes the configured {@link OnProject} observer, swallowing any error so
   * telemetry can never break projection totality. Called by `project`.
   */
  public observeProjection(
    error: unknown,
    view: PublicError,
    outcome: ProjectionOutcome,
  ): void {
    if (this.#onProject === undefined) return;
    try {
      this.#onProject(error, view, outcome);
    } catch {
      // Telemetry must never break totality.
    }
  }

  /**
   * Registers a descriptor keyed by an exact internal error `code`. Returns a
   * catalog widened with the new public code, so a chain of registrations
   * accumulates the public-code union for end-to-end typing.
   */
  public registerByCode<
    TError = unknown,
    TDetails = never,
    const TNewCode extends string = string,
  >(
    code: string,
    descriptor: PublicErrorDescriptor<TError, TDetails, TNewCode>,
  ): PublicErrorCatalog<TPublicCode | TNewCode> {
    if (this.#byCode.has(code)) {
      throw new Error(
        `PublicErrorCatalog: code "${code}" is already registered.`,
      );
    }
    this.#byCode.set(code, descriptor as AnyDescriptor);
    this.#index(descriptor as AnyDescriptor);
    return this as unknown as PublicErrorCatalog<TPublicCode | TNewCode>;
  }

  /** Registers a descriptor guarded by a type-guard matcher, tried after code matches. */
  public register<
    TError,
    TDetails = never,
    const TNewCode extends string = string,
  >(entry: {
    match: (error: unknown) => error is TError;
    descriptor: PublicErrorDescriptor<TError, TDetails, TNewCode>;
  }): PublicErrorCatalog<TPublicCode | TNewCode> {
    this.#predicates.push({
      match: entry.match as (error: unknown) => boolean,
      value: entry.descriptor as AnyDescriptor,
    });
    this.#index(entry.descriptor as AnyDescriptor);
    return this as unknown as PublicErrorCatalog<TPublicCode | TNewCode>;
  }

  /** Resolves the descriptor for `error`, or a miss. */
  public resolve(error: unknown): CatalogResolution {
    const resolution = resolveByCodeThenPredicate(
      error,
      this.#byCode,
      this.#predicates,
    );
    return resolution.found
      ? {
          found: true,
          via: resolution.via,
          descriptor: resolution.value,
          matcherThrew: resolution.matcherThrew,
        }
      : { found: false, matcherThrew: resolution.matcherThrew };
  }

  /**
   * The static wire metadata (status/type/title) for a registered public code,
   * or `undefined` if the code is not registered (including the fallback, which
   * is indexed at construction). An unknown code is a foreign/stale view that
   * must not be paired with this catalog's fallback status; the caller decides.
   */
  public transportFor(publicCode: string): Transport | undefined {
    return this.#transportByPublicCode.get(publicCode);
  }

  /** The localized messages registered for a public code, if any. */
  public messagesFor(publicCode: string): LocalizedMessageSet | undefined {
    return this.#messagesByPublicCode.get(publicCode);
  }

  /**
   * Asserts that every code in `knownCodes` has a `registerByCode` descriptor.
   * An opt-in completeness check for the consumer's composition root.
   */
  public assertCoverage(knownCodes: readonly string[]): void {
    const missing = knownCodes.filter((code) => !this.#byCode.has(code));
    if (missing.length > 0) {
      throw new Error(
        `PublicErrorCatalog: no descriptor registered for code(s): ${missing.join(", ")}.`,
      );
    }
  }

  #index(descriptor: AnyDescriptor): void {
    if (!isNonEmptyString(descriptor.publicCode)) {
      throw new Error(
        "PublicErrorCatalog: descriptor has an empty or invalid publicCode.",
      );
    }
    if (!isHttpStatusCode(descriptor.status)) {
      throw new Error(
        `PublicErrorCatalog: descriptor "${descriptor.publicCode}" has an invalid status; expected an integer in [100, 599], got ${String(descriptor.status)}.`,
      );
    }
    if (descriptor.type !== undefined && !isNonEmptyString(descriptor.type)) {
      throw new Error(
        `PublicErrorCatalog: descriptor "${descriptor.publicCode}" has an empty type.`,
      );
    }
    if (descriptor.category !== undefined) {
      if (!isNonEmptyString(descriptor.category)) {
        throw new Error(
          `PublicErrorCatalog: descriptor "${descriptor.publicCode}" has an empty category.`,
        );
      }
      if (
        this.#categories !== undefined &&
        !this.#categories.has(descriptor.category)
      ) {
        throw new Error(
          `PublicErrorCatalog: descriptor "${descriptor.publicCode}" uses category "${descriptor.category}" not in the declared categories.`,
        );
      }
    }
    const transport: StoredTransport = {
      status: descriptor.status,
      ...(descriptor.type !== undefined && { type: descriptor.type }),
      ...(descriptor.title !== undefined && { title: descriptor.title }),
      ...(descriptor.category !== undefined && {
        category: descriptor.category,
      }),
    };
    const prior = this.#transportByPublicCode.get(descriptor.publicCode);
    if (
      prior !== undefined &&
      (prior.status !== transport.status ||
        prior.type !== transport.type ||
        prior.title !== transport.title ||
        prior.category !== transport.category)
    ) {
      throw new Error(
        `PublicErrorCatalog: publicCode "${descriptor.publicCode}" mapped to conflicting transport (status, type, title, or category).`,
      );
    }
    this.#transportByPublicCode.set(descriptor.publicCode, transport);
    if (descriptor.userMessages !== undefined) {
      const priorMessages = this.#messagesByPublicCode.get(
        descriptor.publicCode,
      );
      if (
        priorMessages !== undefined &&
        !sameMessages(priorMessages, descriptor.userMessages)
      ) {
        throw new Error(
          `PublicErrorCatalog: publicCode "${descriptor.publicCode}" mapped to conflicting userMessages.`,
        );
      }
      this.#messagesByPublicCode.set(
        descriptor.publicCode,
        descriptor.userMessages,
      );
    }
  }
}

/**
 * Content equality for two message sets: same `baseLocale` and the same
 * locale-to-message entries. One public code is one user-facing message, so two
 * internal codes mapping to it must agree (or be different public codes).
 */
function sameMessages(a: LocalizedMessageSet, b: LocalizedMessageSet): boolean {
  if (a === b) return true;
  if (a.baseLocale !== b.baseLocale) return false;
  const aEntries = a.entries();
  const bEntries = b.entries();
  if (aEntries.length !== bEntries.length) return false;
  const bByLocale = new Map(bEntries);
  for (const [locale, message] of aEntries) {
    if (bByLocale.get(locale) !== message) return false;
  }
  return true;
}

/** The union of public codes a {@link PublicErrorCatalog} can produce. */
export type PublicCodeOf<TCatalog> =
  TCatalog extends PublicErrorCatalog<infer TPublicCode> ? TPublicCode : never;

/**
 * Builds a catalog whose public-code union is inferred from the fallback (and
 * grows as you chain `registerByCode`/`register`). Prefer this over `new` when
 * you want the UI to switch exhaustively on `code` at compile time; `new`
 * leaves the union as the open `string`.
 */
export function definePublicErrors<const TCode extends string>(options: {
  fallback: PublicErrorDescriptor<never, never, TCode>;
  onProject?: OnProject;
  categories?: readonly string[];
}): PublicErrorCatalog<TCode> {
  return new PublicErrorCatalog<TCode>(options);
}
