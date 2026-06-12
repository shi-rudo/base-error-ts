# Error catalog

`defineErrors` turns a declarative spec into a typed factory per `code`, a
single source of truth for `category`, `retryable`, HTTP status and the public
mapping. It is the governance complement to [`matchError`](./matching): the
catalog defines the closed set, `matchError` consumes it exhaustively.

```ts
import { defineErrors } from "@shirudo/base-error";

export const AppErrors = defineErrors({
  USER_NOT_FOUND: {
    category: "NOT_FOUND",
    retryable: false,
    httpStatus: 404,
    publicMessage: "The requested user was not found.",
    details: {} as { userId: string }, // per-code details type (value ignored)
  },
  RATE_LIMITED: {
    category: "RATE_LIMIT",
    retryable: true,
    httpStatus: 429,
  },
});
```

## Constructing errors

Each code becomes a factory with the spec baked in. `details` is **required**
when the spec declares a shape, and the options argument is optional when it
does not:

```ts
throw AppErrors.USER_NOT_FOUND("user 123 missing in primary db", {
  details: { userId: "123" },
});

throw AppErrors.RATE_LIMITED("too many requests");
```

The result is a tagged `StructuredError` discriminated by `code`, not a class
per code. `instanceof StructuredError` and `code` are the runtime checks; if you
truly need per-code `instanceof` (e.g. a framework exception filter), hand-write
a subclass as before.

## The boundary metadata

`meta(code)` returns a copy of the static spec row, so the boundary resolves
status from the catalog instead of guessing it (`code` is typed to the catalog's
keys; an unknown code throws a clear error rather than returning `undefined`):

```ts
const problem = err.toProblemDetails({
  status: AppErrors.meta(err.code).httpStatus,
});
```

## Composing with `matchError`

`CatalogError` extracts the closed union the catalog can produce:

```ts
import { matchError } from "@shirudo/base-error";
import type { CatalogError } from "@shirudo/base-error";

type AppError = CatalogError<typeof AppErrors>;

function toResponse(err: AppError) {
  return matchError(err, {
    USER_NOT_FOUND: (e) =>
      e.toProblemDetails({
        status: 404,
        extensions: { userId: e.details?.userId },
      }),
    RATE_LIMITED: (e) => e.toProblemDetails({ status: 429 }),
  });
}
```

Add a code to the catalog and every `matchError` without a `_` stops compiling
until you handle it. The catalog defines the set; the compiler keeps your
handling complete; the safe serializers do the projection.

## Per-call overrides

A factory call can still override the public message and attach a cause:

```ts
AppErrors.USER_NOT_FOUND("technical", {
  details: { userId: "1" },
  publicMessage: "No such account.",
  cause: dbError,
});
```
