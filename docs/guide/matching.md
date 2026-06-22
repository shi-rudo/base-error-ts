# Matching errors

The package supports three matching modes for different type models:

| Matcher               | Input model                         | Completion                       |
| --------------------- | ----------------------------------- | -------------------------------- |
| `matchError`          | closed `StructuredError` code union | compile-time exhaustive          |
| `ErrorClassSet.match` | declared local Error-class set      | compile-time exhaustive          |
| `matchThrown`         | open-world `unknown`                | explicit `.otherwise()` fallback |

Use `matchError` when your application owns a closed error catalog. Use
`matchThrown` at boundaries that receive native errors, third-party classes,
Node.js-style error codes, or arbitrary thrown values.

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

Dispatch itself is synchronous. The selected handler value—including a
promise—is returned unchanged.

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
Missing and additional keys are compile errors. Each handler receives the
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

## Closed structured matching with `matchError`

`matchError` dispatches on a structured error's `code` with **compile-time
exhaustiveness** and per-case type narrowing, the ergonomic way to handle a
closed set of domain errors as a tagged union.

```ts
import { matchError } from "@shirudo/base-error";

const status = matchError(err, {
  USER_NOT_FOUND: () => 404,
  EMAIL_TAKEN: () => 409,
  RATE_LIMITED: (e) => (e.retryable ? 429 : 503),
});
```

### Exhaustiveness

When `err`'s type is a closed union of error types, omitting a `code` is a
**compile error**. Add the case, or opt out with a `_` catch-all:

```ts
matchError(err, {
  USER_NOT_FOUND: () => render404(),
  _: (e) => renderGeneric(e.code), // handles every other code
});
```

When a new error code is added to the union, every `matchError` without a `_`
stops compiling until you handle it. That is the point: the compiler maintains
your error-handling completeness.

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

matchError(err as AppError, {
  USER_NOT_FOUND: (e) => e.details?.userId, // { userId: string } | undefined
  RATE_LIMITED: (e) => e.details?.retryAfter, // { retryAfter: number } | undefined
});
```

Full per-case narrowing needs a **real union** of distinct error types (each
with a literal `code`), exactly what an [error catalog](./catalog) produces. For
a single `StructuredError<"A" | "B">`, only `code` narrows.

### With errors from `catch`

A caught value is `unknown`; exhaustiveness can't be derived from it. Narrow
first, then match:

```ts
try {
  await doWork();
} catch (e) {
  if (AppErrors.is(e)) {
    return matchError(e, {
      USER_NOT_FOUND: () => 404,
      RATE_LIMITED: () => 429,
    });
  }
  throw e;
}
```
