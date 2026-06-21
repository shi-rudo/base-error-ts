import type { ErrorClass, TypeGuard } from "./guards.js";

type MatcherCase = {
  test: (value: unknown) => boolean;
  run: (value: unknown) => unknown;
};

/** Non-exhaustive matcher for arbitrary thrown values. */
export interface ThrownMatcher<TResult> {
  /** Register a local Error-constructor case. */
  with<T extends Error, const R>(
    constructor: ErrorClass<T>,
    handler: (error: T) => R,
  ): ThrownMatcher<TResult | R>;

  /** Register a case for a non-empty group of local Error constructors. */
  withAny<const C extends readonly [ErrorClass, ...ErrorClass[]], const R>(
    constructors: C,
    handler: (error: InstanceType<C[number]>) => R,
  ): ThrownMatcher<TResult | R>;

  /** Register a narrowing type guard. */
  when<T, const R>(
    guard: TypeGuard<T>,
    handler: (value: T) => R,
  ): ThrownMatcher<TResult | R>;

  /** Register a boolean predicate without static narrowing. */
  when<const R>(
    predicate: (value: unknown) => boolean,
    handler: (value: unknown) => R,
  ): ThrownMatcher<TResult | R>;

  /** Evaluate the registered cases and handle an unmatched value. */
  otherwise<const R>(handler: (value: unknown) => R): TResult | R;
}

function createMatcher<TResult>(
  value: unknown,
  cases: readonly MatcherCase[],
): ThrownMatcher<TResult> {
  return {
    with<T extends Error, const R>(
      constructor: ErrorClass<T>,
      handler: (error: T) => R,
    ): ThrownMatcher<TResult | R> {
      const nextCase: MatcherCase = {
        test: (candidate) => candidate instanceof constructor,
        run: (candidate) => handler(candidate as T),
      };

      return createMatcher<TResult | R>(value, [...cases, nextCase]);
    },

    withAny<const C extends readonly [ErrorClass, ...ErrorClass[]], const R>(
      constructors: C,
      handler: (error: InstanceType<C[number]>) => R,
    ): ThrownMatcher<TResult | R> {
      const snapshot = [...constructors];
      const nextCase: MatcherCase = {
        test: (candidate) =>
          snapshot.some((constructor) => candidate instanceof constructor),
        run: (candidate) => handler(candidate as InstanceType<C[number]>),
      };

      return createMatcher<TResult | R>(value, [...cases, nextCase]);
    },

    when<T, const R>(
      predicate: TypeGuard<T> | ((value: unknown) => boolean),
      handler: (value: T) => R,
    ): ThrownMatcher<TResult | R> {
      const nextCase: MatcherCase = {
        test: predicate,
        run: (candidate) => handler(candidate as T),
      };

      return createMatcher<TResult | R>(value, [...cases, nextCase]);
    },

    otherwise<const R>(handler: (value: unknown) => R): TResult | R {
      for (const matchCase of cases) {
        if (matchCase.test(value)) {
          return matchCase.run(value) as TResult;
        }
      }
      return handler(value);
    },
  };
}

/** Start an immutable, first-match-wins matcher for an arbitrary thrown value. */
export function matchThrown(value: unknown): ThrownMatcher<never> {
  return createMatcher<never>(value, []);
}
