import { canonicalizeLocale } from "./locale.js";

/**
 * Options for {@link LocalizedMessageSet}.
 */
export type LocalizedMessageSetOptions = {
  /**
   * The guaranteed-fallback locale, made explicit (no hidden default). After
   * canonicalization it must have an entry in `messages`.
   */
  readonly baseLocale: string;
  /**
   * Locale tag to message text. Keys are canonicalized (BCP 47); message
   * contents are preserved verbatim and never trimmed or modified.
   */
  readonly messages: Readonly<Record<string, string>>;
};

/**
 * An immutable, canonicalized set of localized messages keyed by BCP 47 locale.
 *
 * Construction enforces the write-side invariants: every key is canonicalized
 * with `Intl.getCanonicalLocales` (invalid tags throw), keys that collide after
 * canonicalization throw, every message must contain at least one non-whitespace
 * character, and an entry for the (canonical) `baseLocale` must exist. Lookups
 * are exact, canonical matches with no parent fallback: walking up a tag
 * (`de-DE` to `de`) and choosing between preferences is the resolver's job, not
 * the set's. On the read side an invalid requested tag is a miss, never a throw.
 */
export class LocalizedMessageSet {
  /** Canonical BCP 47 tag of the guaranteed-fallback locale. */
  public readonly baseLocale: string;

  readonly #messages: ReadonlyMap<string, string>;

  public constructor(options: LocalizedMessageSetOptions) {
    const baseLocale = canonicalizeOrThrow(options.baseLocale, "baseLocale");

    const canonical = new Map<string, string>();
    const originalKeyFor = new Map<string, string>();
    for (const [rawKey, text] of Object.entries(options.messages)) {
      const key = canonicalizeOrThrow(rawKey, `messages key "${rawKey}"`);
      const prior = originalKeyFor.get(key);
      if (prior !== undefined) {
        throw new Error(
          `LocalizedMessageSet: keys "${prior}" and "${rawKey}" both canonicalize to "${key}".`,
        );
      }
      if (text.trim().length === 0) {
        throw new Error(
          `LocalizedMessageSet: message for "${rawKey}" is empty or whitespace-only.`,
        );
      }
      originalKeyFor.set(key, rawKey);
      canonical.set(key, text);
    }

    if (!canonical.has(baseLocale)) {
      throw new Error(
        `LocalizedMessageSet: no message for baseLocale "${baseLocale}".`,
      );
    }

    this.baseLocale = baseLocale;
    this.#messages = canonical;
  }

  /**
   * Whether an exact (canonical) entry exists for `locale`. No parent fallback.
   * An invalid tag is a miss.
   */
  public has(locale: string): boolean {
    const key = canonicalizeLocale(locale);
    return key !== undefined && this.#messages.has(key);
  }

  /**
   * The exact (canonical) message for `locale`, or `undefined`. No parent
   * fallback. An invalid tag yields `undefined`.
   */
  public get(locale: string): string | undefined {
    const key = canonicalizeLocale(locale);
    return key === undefined ? undefined : this.#messages.get(key);
  }

  /** A copy of the entries as `[canonicalLocale, message]` pairs. */
  public entries(): ReadonlyArray<readonly [string, string]> {
    return [...this.#messages.entries()];
  }
}

/**
 * Canonicalizes a single BCP 47 tag, or throws if it is invalid. Used on the
 * write side, where an invalid tag is a construction error.
 */
function canonicalizeOrThrow(tag: string, label: string): string {
  const canonical = canonicalizeLocale(tag);
  if (canonical === undefined) {
    throw new Error(
      `LocalizedMessageSet: invalid locale tag for ${label}: "${tag}".`,
    );
  }
  return canonical;
}
