import { hasErrorCode, matchThrown, type ThrownMatcher } from "../index.js";

type IsAny<T> = 0 extends 1 & T ? true : false;
type Assert<T extends true> = T;

class NetworkError extends Error {
  constructor(readonly status: number) {
    super(`HTTP ${status}`);
  }
}

declare const caught: unknown;

const emptyMatcher: ThrownMatcher<never> = matchThrown(caught);
type MatcherIsNotAny = Assert<
  IsAny<typeof emptyMatcher> extends false ? true : false
>;
const result = emptyMatcher
  .with(NetworkError, (error) => {
    const status: number = error.status;
    void status;
    return "network" as const;
  })
  .otherwise(() => 500 as const);

const exactResult: "network" | 500 = result;
type ResultIsNotAny = Assert<IsAny<typeof result> extends false ? true : false>;

void exactResult;
void (null as unknown as ResultIsNotAny);
void (null as unknown as MatcherIsNotAny);

class NotAnError {}
// @ts-expect-error constructors must produce Error instances
matchThrown(caught).with(NotAnError, () => "invalid");

matchThrown(caught).with(NetworkError, (error) => {
  // @ts-expect-error constructor handlers expose only the matched instance type
  const offset = error.offset;
  void offset;
  return error.status;
});

class ParseError extends Error {
  readonly offset = 1;
}

const grouped = matchThrown(caught)
  .withAny([NetworkError, ParseError] as const, (error) => {
    const matched: NetworkError | ParseError = error;
    void matched;
    return "grouped" as const;
  })
  .otherwise(() => false as const);

const exactGrouped: "grouped" | false = grouped;
void exactGrouped;

// @ts-expect-error constructor groups must be non-empty
matchThrown(caught).withAny([], () => "unreachable");

const guarded = matchThrown(caught)
  .when(hasErrorCode("EPIPE"), (error) => {
    const code: "EPIPE" = error.code;
    void code;
    return "pipe" as const;
  })
  .otherwise(() => 500 as const);
const exactGuarded: "pipe" | 500 = guarded;
void exactGuarded;

matchThrown(caught)
  .when(
    (_value): boolean => {
      void _value;
      return true;
    },
    (value) => {
      const unknownValue: unknown = value;
      void unknownValue;
      // @ts-expect-error boolean predicates do not narrow handler input
      value.toUpperCase();
      return "predicate" as const;
    },
  )
  .otherwise(() => false as const);

const maybePromise = matchThrown(caught)
  .with(NetworkError, async () => "retried" as const)
  .otherwise(() => false as const);
const exactPromise: Promise<"retried"> | false = maybePromise;
void exactPromise;
