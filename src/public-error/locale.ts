// Internal BCP 47 locale utilities used by the public-error localization
// primitives (LocalizedMessageSet, resolveUserMessage). Not part of the public
// surface.

/**
 * Canonicalizes a single BCP 47 tag with `Intl.getCanonicalLocales`, or returns
 * `undefined` if it is structurally invalid. `Intl.getCanonicalLocales` throws a
 * `RangeError` on invalid input; this wraps that into the read-side "invalid is
 * a miss" policy. Write-side callers turn the `undefined` into a throw.
 */
export function canonicalizeLocale(tag: string): string | undefined {
  try {
    return Intl.getCanonicalLocales(tag)[0];
  } catch {
    return undefined;
  }
}

/**
 * The RFC 4647 lookup fallback chain for a canonical tag: the tag itself, then
 * progressively truncated from the right one subtag at a time. Whenever
 * truncation would leave a single-character singleton subtag (a `u` extension,
 * an `x` private-use marker, and so on) as the trailing subtag, that singleton
 * is removed as well before the next candidate is yielded.
 *
 * `zh-Hant-TW` -> `zh-Hant` -> `zh`
 * `de-DE-u-co-phonebk` -> `de-DE-u-co` -> `de-DE` -> `de`
 * `en-US-x-private` -> `en-US` -> `en`
 *
 * The input is assumed already canonical, so each truncation stays canonical.
 */
export function truncationChain(canonicalTag: string): string[] {
  let parts = canonicalTag.split("-");
  const chain: string[] = [];
  while (parts.length > 0) {
    chain.push(parts.join("-"));
    parts = parts.slice(0, -1);
    if (parts.length > 0 && (parts[parts.length - 1] as string).length === 1) {
      parts = parts.slice(0, -1);
    }
  }
  return chain;
}
