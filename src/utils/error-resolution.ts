/**
 * Shared error-to-descriptor resolution: exact `code` match, then predicate
 * matchers in registration order. Used by the public-error catalog, keeping the
 * matching semantics (and the throwing-getter and throwing-matcher handling) in
 * a single definition.
 */

/** A predicate matcher paired with the value it resolves to. */
export type PredicateEntry<T> = {
  readonly match: (error: unknown) => boolean;
  readonly value: T;
};

/** The outcome of resolving an error by code then predicates. */
export type CodeResolution<T> =
  | {
      readonly found: true;
      readonly via: "code" | "predicate";
      readonly value: T;
      readonly matcherThrew: boolean;
    }
  | { readonly found: false; readonly matcherThrew: boolean };

/**
 * The string `code` of an error-like object, or `undefined`. A throwing `code`
 * getter is treated as no code, so resolution stays total.
 */
export function readErrorCode(error: unknown): string | undefined {
  if (typeof error === "object" && error !== null && "code" in error) {
    try {
      const code = (error as { code: unknown }).code;
      if (typeof code === "string") return code;
    } catch {
      return undefined;
    }
  }
  return undefined;
}

/**
 * Resolves `error` to a value by exact `code` match first, then predicate
 * matchers in order. A matcher that throws is treated as a miss and sets
 * `matcherThrew`, so a caller can distinguish a genuine miss from a broken
 * matcher.
 */
export function resolveByCodeThenPredicate<T>(
  error: unknown,
  byCode: ReadonlyMap<string, T>,
  predicates: readonly PredicateEntry<T>[],
): CodeResolution<T> {
  const code = readErrorCode(error);
  if (code !== undefined) {
    const value = byCode.get(code);
    if (value !== undefined) {
      return { found: true, via: "code", value, matcherThrew: false };
    }
  }

  let matcherThrew = false;
  for (const { match, value } of predicates) {
    let matched = false;
    try {
      matched = match(error);
    } catch {
      matcherThrew = true;
      continue;
    }
    if (matched) {
      return { found: true, via: "predicate", value, matcherThrew };
    }
  }

  return { found: false, matcherThrew };
}
