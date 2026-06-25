import { resolveByCodeThenPredicate } from "../utils/error-resolution.js";
import type { PredicateEntry } from "../utils/error-resolution.js";
import type { PublicErrorDefinition } from "./PublicErrorDefinition.js";

/** A definition with its types erased, as stored and returned by the registry. */
type AnyDefinition = PublicErrorDefinition<unknown, unknown>;

/**
 * The outcome of resolving an error against the registry. `matcherThrew` lets
 * the presenter distinguish a genuine miss (`no_definition`) from a broken
 * matcher (`matcher_failed`).
 */
export type RegistryResolution =
  | {
      found: true;
      via: "code" | "predicate";
      definition: AnyDefinition;
      /** True when a predicate matcher threw before this match was found. */
      matcherThrew: boolean;
    }
  | { found: false; matcherThrew: boolean };

/**
 * Maps an error to a {@link PublicErrorDefinition}, deterministically. Resolution
 * order: an exact match on the error's `code` (registered via `registerByCode`),
 * then predicate matchers (registered via `register`) in registration order,
 * then a miss. A matcher that throws is treated as a miss; the resolution then
 * reports `matcherThrew` so the presenter can surface it.
 *
 * Type safety holds at the registration boundary only: stored definitions are
 * type-erased, and runtime resilience at projection time (in the presenter)
 * covers the gap. `registerByCode` is a nominal claim, not a proof.
 */
export class PublicErrorRegistry {
  readonly #byCode = new Map<string, AnyDefinition>();
  readonly #predicates: Array<PredicateEntry<AnyDefinition>> = [];

  /**
   * Registers a definition keyed by an exact internal error `code`. Throws if
   * the code is already registered.
   */
  public registerByCode<TError = unknown, TDetails = never>(
    code: string,
    definition: PublicErrorDefinition<TError, TDetails>,
  ): this {
    if (this.#byCode.has(code)) {
      throw new Error(
        `PublicErrorRegistry: code "${code}" is already registered.`,
      );
    }
    this.#byCode.set(code, definition as AnyDefinition);
    return this;
  }

  /**
   * Registers a definition guarded by a type-guard matcher. Matchers are tried
   * in registration order, after any exact code match.
   */
  public register<TError, TDetails = never>(entry: {
    match: (error: unknown) => error is TError;
    definition: PublicErrorDefinition<TError, TDetails>;
  }): this {
    this.#predicates.push({
      match: entry.match as (error: unknown) => boolean,
      value: entry.definition as AnyDefinition,
    });
    return this;
  }

  /**
   * Asserts that every code in `knownCodes` has a `registerByCode` definition,
   * throwing with the list of unregistered codes otherwise. An opt-in
   * completeness check for the consumer's composition root: the library does
   * not know the universe of codes, so the caller supplies it.
   */
  public assertCoverage(knownCodes: readonly string[]): void {
    const missing = knownCodes.filter((code) => !this.#byCode.has(code));
    if (missing.length > 0) {
      throw new Error(
        `PublicErrorRegistry: no definition registered for code(s): ${missing.join(", ")}.`,
      );
    }
  }

  /** Resolves the definition for `error`, or a miss. */
  public resolve(error: unknown): RegistryResolution {
    const resolution = resolveByCodeThenPredicate(
      error,
      this.#byCode,
      this.#predicates,
    );
    return resolution.found
      ? {
          found: true,
          via: resolution.via,
          definition: resolution.value,
          matcherThrew: resolution.matcherThrew,
        }
      : { found: false, matcherThrew: resolution.matcherThrew };
  }
}
