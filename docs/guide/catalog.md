# Error catalog

`defineErrors` creates an immutable catalog for a finite set of structured
errors. It owns typed factories, static metadata, local provenance guards and
optional log-redaction policy.

```ts
import { defineErrors, detailsType } from "@shirudo/base-error";

export const AppErrors = defineErrors({
  USER_NOT_FOUND: {
    category: "NOT_FOUND",
    retryable: false,
    details: detailsType<{ userId: string }>(),
    metadata: { httpStatus: 404 },
  },
  RATE_LIMITED: {
    category: "RATE_LIMIT",
    retryable: true,
    metadata: { httpStatus: 429 },
  },
});
```

Definitions must be non-empty finite string-keyed plain objects; null-prototype
objects are also accepted. Error codes must be non-empty strings. Definitions
are validated, snapshotted and frozen when the catalog is created.

## Constructing errors

Factories live under `create`, leaving every string available as an error code:

```ts
throw AppErrors.create.USER_NOT_FOUND("user 123 missing", {
  details: { userId: "123" },
});

throw AppErrors.create.RATE_LIMITED("too many requests");
```

`details` is required only when its definition declares `detailsType<T>()`.
Every generated value is a `StructuredError` discriminated by its literal
`code`.

## Safe catalog guards

The catalog records local provenance for every generated instance:

```ts
if (AppErrors.is(error)) {
  // CatalogError<typeof AppErrors>
  return matchError(error, {
    USER_NOT_FOUND: () => 404,
    RATE_LIMITED: () => 429,
  });
}

if (AppErrors.is(error, "USER_NOT_FOUND")) {
  error.details?.userId;
}
```

This is an identity and trust boundary, not structural recognition. An object
with matching fields, an error made by another catalog, or a reconstructed
wire value is rejected. Translate or validate external data explicitly. See
[Type guards and trust boundaries](./guards#trust-boundary) for the distinction
between classification and trusted local provenance.

## Static metadata

`metadata` is inferred per code and accepts JSON-safe data. `meta(code)` returns
an immutable snapshot containing `category`, `retryable`, and the optional
metadata:

```ts
const status = AppErrors.meta(err.code).metadata.httpStatus;
const view = project(catalog, err);
return Response.json(view, { status });
```

HTTP, gRPC and CLI mappings remain consumer-owned boundary concerns rather than
fixed fields in the core error model. The
[public-error guide](./public-error) shows how to apply
catalog metadata in a transport adapter.

## Catalog-level log redaction

Apply the same sticky redaction policy to every instance of a code:

```ts
const SecurityErrors = defineErrors({
  LOGIN_FAILED: {
    category: "AUTH",
    retryable: false,
    details: detailsType<{ userId: string; password: string }>(),
    redaction: { mode: "deny", keys: ["password"] },
  },
  PROFILE_FAILED: {
    category: "PROFILE",
    retryable: false,
    details: detailsType<{ userId: string; email: string }>(),
    redaction: { mode: "allow", keys: ["userId"] },
  },
});
```

Per-instance `redact`, `redactAllow`, and `redactWith` remain available when a
single occurrence needs a stricter policy.

## Catalog types and codes

`CatalogError` extracts the closed union; `CatalogErrorOf` extracts one member:

```ts
import type { CatalogError, CatalogErrorOf } from "@shirudo/base-error";

type AppError = CatalogError<typeof AppErrors>;
type UserNotFound = CatalogErrorOf<typeof AppErrors, "USER_NOT_FOUND">;
```

`AppErrors.codes` is an immutable runtime list of the finite code set. Adding a
code changes `CatalogError`, so every exhaustive `matchError` call must handle
the new member before the application compiles again.

## Per-call values

Factories keep the familiar message plus options signature. Calls may attach a
typed `details` value and an underlying `cause`:

```ts
AppErrors.create.USER_NOT_FOUND("user missing in primary db", {
  details: { userId: "1" },
  cause: dbError,
});
```

`detailsType<T>()` is compile-time-only. Validate untrusted input before passing
it to a factory; see
[runtime validation of catalog details](./validation#runtime-validation-of-catalog-details).

Keep catalogs separate when they represent separate ownership or trust
boundaries. When one closed union is required, compose definitions before
calling `defineErrors`; see [Catalog composition](./catalog-composition).
