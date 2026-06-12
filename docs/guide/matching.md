# Matching errors

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

## Exhaustiveness

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

## Per-case narrowing

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
with a literal `code`), exactly what a future [error
catalog](https://github.com/shi-rudo/base-error-ts/blob/main/proposals/0001-error-catalog-and-match.md)
produces. For a single `StructuredError<"A" | "B">`, only `code` narrows.

## With errors from `catch`

A caught value is `unknown`; exhaustiveness can't be derived from it. Narrow
first, then match:

```ts
try {
  await doWork();
} catch (e) {
  if (isStructuredError(e)) {
    return matchError(e as AppError, {
      USER_NOT_FOUND: () => 404,
      RATE_LIMITED: () => 429,
      _: () => 500,
    });
  }
  throw e;
}
```
