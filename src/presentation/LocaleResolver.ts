import type { LocalizedMessageSet } from "./LocalizedMessageSet.js";
import { canonicalizeLocale, truncationChain } from "./locale.js";

/**
 * The outcome of resolving a localized message: the text plus the locale that
 * actually matched and how. `matchedPreferenceIndex` and `match` are diagnostic
 * (tests, finding missing translations) and need not reach a public view.
 */
export type ResolvedUserMessage = {
  /** Canonical BCP 47 tag that actually matched. */
  locale: string;
  /** The message for that locale. */
  message: string;
  /**
   * Index into the supplied `locales` whose tag (or one of its parents)
   * matched. `undefined` only when the match came from the appended baseLocale.
   */
  matchedPreferenceIndex?: number;
  /**
   * `exact` when the canonical supplied tag matched, `parent` when one of its
   * truncations matched, `base` only when the appended baseLocale matched.
   */
  match: "exact" | "parent" | "base";
};

/**
 * Resolves a single localized message from `set` against an ordered list of
 * locale preferences (RFC 4647 lookup). For each supplied locale, in order, the
 * canonical tag and its truncation chain are tried; the first present entry
 * wins. Candidates are deduped preserving first-seen order, so a duplicate is
 * attributed to the earlier preference's chain. The baseLocale is consulted only
 * after every supplied preference, and a match against it alone is reported as
 * `base`. An invalid supplied tag is skipped (a miss), never a throw.
 *
 * This never returns `undefined`: a {@link LocalizedMessageSet} always has an
 * entry for its baseLocale, which is the guaranteed floor.
 */
export function resolveUserMessage(
  set: LocalizedMessageSet,
  options?: { locales?: readonly string[] },
): ResolvedUserMessage {
  const locales = options?.locales ?? [];
  const seen = new Set<string>();

  for (const [index, raw] of locales.entries()) {
    const canonical = canonicalizeLocale(raw);
    if (canonical === undefined) continue;
    for (const [depth, tag] of truncationChain(canonical).entries()) {
      if (seen.has(tag)) continue;
      seen.add(tag);
      const message = set.get(tag);
      if (message !== undefined) {
        return {
          locale: tag,
          message,
          matchedPreferenceIndex: index,
          match: depth === 0 ? "exact" : "parent",
        };
      }
    }
  }

  // Floor: the baseLocale entry is guaranteed to exist by the set's invariant.
  const baseMessage = set.get(set.baseLocale);
  if (baseMessage !== undefined) {
    return { locale: set.baseLocale, message: baseMessage, match: "base" };
  }

  // Unreachable for a valid LocalizedMessageSet; guards against a bypassed invariant.
  throw new Error(
    `LocaleResolver: LocalizedMessageSet has no entry for its baseLocale "${set.baseLocale}".`,
  );
}
