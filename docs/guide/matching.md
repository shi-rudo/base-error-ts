# Matching errors

The package supports three matching modes for different type models:

| Matcher               | Input model                         | Completion                       |
| --------------------- | ----------------------------------- | -------------------------------- |
| `matchErrorCode`          | closed `StructuredError` code union | compile-time exhaustive          |
| `Catalog.match`       | errors of one catalog, by key       | compile-time exhaustive          |
| `ErrorClassSet.match` | declared local Error-class set      | compile-time exhaustive          |
| `matchThrown`         | open-world `unknown`                | explicit `.otherwise()` fallback |

Use `matchErrorCode` when your application owns a closed error catalog. Use
`matchThrown` at boundaries that receive native errors, third-party classes,
Node.js-style error codes, or arbitrary thrown values.

`Catalog.match` is `matchErrorCode` with handlers named by the key of a
definition. A catalog with a [prefix](./catalog#codes-with-a-prefix) uses it,
so that a dotted code needs no brackets.

## Open-world matching with `matchThrown`

```ts
import { hasErrorCode, matchThrown } from "@shirudo/base-error";

try {
  await readConfig();
} catch (error) {
  return matchThrown(error)
    .with(SyntaxError, () => ({ kind: "invalid-config" }) as const)
    .when(hasErrorCode("ENOENT"), () => ({ kind: "missing" }) as const)
    .withAny(
      [TimeoutError, ConnectionError] as const,
      (networkError) =>
        ({
          kind: "retry",
          cause: networkError,
        }) as const,
    )
    .otherwise((unknownError) => {
      throw unknownError;
    });
}
```

### Cases

- `.with(Constructor, handler)` uses local `instanceof` identity and narrows the
  handler to that error class.
- `.withAny([A, B], handler)` handles a non-empty constructor group and narrows
  the handler to `A | B`.
- `.when(typeGuard, handler)` accepts reusable guards such as
  `hasErrorCode("EPIPE")` and narrows their handler.
- `.when(predicate, handler)` also accepts ordinary boolean predicates. Its
  handler remains `unknown` unless TypeScript infers the predicate as a type
  guard.
- `.otherwise(handler)` is mandatory and handles the original unmatched value.

Cases are lazy and evaluated in registration order only when `.otherwise()` is
called. The first match wins. Predicate, `Symbol.hasInstance`, handler, and
fallback exceptions propagate unchanged.

Matcher chains are immutable. A partial matcher can be branched without cases
from one branch appearing in another. Constructor arrays passed to `.withAny()`
are snapshotted when registered.

### Return types and promises

The result is the inferred union of every case and fallback result. No handler
returns `any` implicitly, and async handlers need no separate matcher:

```ts
const result = matchThrown(error)
  .with(NetworkError, async (networkError) => retry(networkError))
  .otherwise(() => "not-retried" as const);
// Promise<RetryResult> | "not-retried"
```

Dispatch itself is synchronous. The selected handler value (including a
promise) is returned unchanged.

`matchThrown` is deliberately non-exhaustive: arbitrary `unknown` is an open
set. It does not provide `.exhaustive()`, `.map()`, `.select()`, or negative
cases. Normalize before matching and use the explicit fallback.

Negative matching is ordinary control flow rather than a separate matcher API:

```ts
if (!hasErrorCode("ENOENT")(error)) throw error;
return defaultConfig;
```

For a catalog member, use `AppErrors.is(error, "CODE")` and negate the result.
Keeping negation outside the matcher makes the remaining type and fallback
behavior visible at the branch where it matters.

## Closed class matching with `defineErrorClassSet`

Define a reusable class set when the application owns a closed group of local
Error classes:

```ts
import { defineErrorClassSet } from "@shirudo/base-error";

const InfrastructureErrors = defineErrorClassSet({
  timeout: TimeoutError,
  connection: ConnectionError,
});

const result = InfrastructureErrors.match(error, {
  timeout: (timeoutError) => ({ kind: "retry", cause: timeoutError }),
  connection: (connectionError) => ({
    kind: "reconnect",
    cause: connectionError,
  }),
});
```

The handler object must contain exactly one handler for every declared key.
Missing and additional keys are compile errors. The error for an additional
key names it, for example `match: reconnect is not a key of this error class set`.
Each handler receives the
instance type of its constructor, and the result is the exact union of all
handler return types.

Class-set keys must be finite, non-numeric string literals. Numeric-looking
keys are rejected because JavaScript reorders array-index object keys. Let the
definition call infer keys directly. For a separately declared definition, use
`satisfies` rather than a widening type annotation:

```ts
import type { ErrorClassMap } from "@shirudo/base-error";

const classes = {
  timeout: TimeoutError,
  connection: ConnectionError,
} satisfies ErrorClassMap;

const InfrastructureErrors = defineErrorClassSet(classes);
```

Definitions must be non-empty and constructor identities must be unique. The
definition is snapshotted once and the returned set is frozen. Matching uses
local `instanceof` checks in definition order, so list subclasses before base
classes when both are present.

If a runtime value matches no declared class, `match` throws. Use
`matchThrown(value).otherwise(...)` instead when arbitrary or cross-realm
values are expected and require a fallback.

## Closed structured matching with `matchErrorCode`

`matchErrorCode` dispatches on a structured error's `code` with **compile-time
exhaustiveness** and per-case type narrowing, the ergonomic way to handle a
closed set of domain errors as a tagged union.

```ts
import { matchErrorCode } from "@shirudo/base-error";

const status = matchErrorCode(err, {
  USER_NOT_FOUND: () => 404,
  EMAIL_TAKEN: () => 409,
  RATE_LIMITED: (e) => (e.retryable ? 429 : 503),
});
```

### Exhaustiveness

When `err`'s type is a closed union of error types, omitting a `code` is a
**compile error**. Add the case, or opt out with a `_` catch-all:

```ts
matchErrorCode(err, {
  USER_NOT_FOUND: () => render404(),
  _: (e) => renderGeneric(e.code), // handles every other code
});
```

The `_` handler receives the members of the union whose code has no handler.
In this example, `e` never has the code `USER_NOT_FOUND`, so a comparison of
`e.code` with `"USER_NOT_FOUND"` is a compile error. A single
`StructuredError<"A" | "B">` is not a union of members, so `_` receives it
unchanged.

When a new error code is added to the union, every `matchErrorCode` without a `_`
stops compiling until you handle it. That is the point: the compiler maintains
your error-handling completeness.

The compiler also rejects a handler for a code that the union does not
contain, with or without `_`. So a misspelled code fails to compile and does
not fall through to `_`. The compiler error names the handler and the reason:

```ts
matchErrorCode(err, {
  // compile error: "matchErrorCode: USER_NOT_FUND is not a code of this error"
  USER_NOT_FUND: () => render404(),
  _: (e) => renderGeneric(e.code),
});
```

The compiler checks names only against known codes:

- A table typed `Record<string, …>` does not pass for a closed union, because
  it names every string. Write the table as an object literal.
- An error whose code type is a bare type parameter names no code. An example
  is `StructuredError<Code>` in a generic function. For such an error,
  `matchErrorCode` takes only a table with a single `_` handler. To name other
  handlers, assign the error to a variable typed with its codes, or with
  `StructuredError<string>`.
- A union with the code `_` cannot name a handler next to `_`, because `_` is
  the catch-all. Rename the code.
- A handler typed `any` compiles under any name, because `any` turns off the
  type check.

### Per-case narrowing

Each handler receives the error narrowed to its case, so `details` is the
precise per-code type:

```ts
type UserNotFound = StructuredError<
  "USER_NOT_FOUND",
  "NOT_FOUND",
  { userId: string }
>;
type RateLimited = StructuredError<
  "RATE_LIMITED",
  "RATE_LIMIT",
  { retryAfter: number }
>;
type AppError = UserNotFound | RateLimited;

matchErrorCode(err as AppError, {
  USER_NOT_FOUND: (e) => e.details?.userId, // { userId: string } | undefined
  RATE_LIMITED: (e) => e.details?.retryAfter, // { retryAfter: number } | undefined
});
```

Full per-case narrowing needs a **real union** of distinct error types (each
with a literal `code`), exactly what an [error catalog](./catalog) produces. For
a single `StructuredError<"A" | "B">`, only `code` narrows.

On TypeScript before 5.4, a handler for a code named like a member of
`Object.prototype`, such as `toString`, `valueOf` or `constructor`, is typed
against that member. The handler must then return what the member returns, for
example a string for `toString`. The same holds for a key of `Errors.match`.
The runtime sends such a code to its own handler. Use TypeScript 5.4 or later,
or handle such a code in `_`.

### With errors from `catch`

A caught value is `unknown`; exhaustiveness can't be derived from it. Narrow
first, then match:

```ts
try {
  await doWork();
} catch (e) {
  if (AppErrors.is(e)) {
    return matchErrorCode(e, {
      USER_NOT_FOUND: () => 404,
      RATE_LIMITED: () => 429,
    });
  }
  throw e;
}
```

### In a generic function

In a function that is generic over the error, `matchErrorCode` checks the
handler names against the codes of the constraint. A handler that reads its
parameter does not compile there: the compiler cannot infer the handler table,
and the result type is `unknown`. A handler without a parameter compiles.
Assign the error to a variable typed with the union of the constraint, and
match that variable:

```ts
function statusOf<E extends EmailTaken | RateLimited>(error: E): number {
  const known: EmailTaken | RateLimited = error;
  return matchErrorCode(known, {
    RATE_LIMITED: (e) => (e.retryable ? 429 : 503),
    _: () => 500,
  });
}
```
