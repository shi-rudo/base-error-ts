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
objects are also accepted. Keys must be non-empty strings. Without a prefix,
the key of a definition is its error code; see
[Codes with a prefix](#codes-with-a-prefix). Definitions are validated,
snapshotted and frozen when the catalog is created.

## Constructing errors

Factories live under `create`, leaving every string available as a key:

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

`metadata` is inferred per code and accepts JSON-safe data nested at most 100 levels deep (deeper metadata is rejected with "nested deeper than 100 levels"). `defineErrors` skips a property whose value is `undefined`, as `JSON.stringify` does. `meta(code)` returns
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

The catalog policy is a floor. A per-instance `redact`, `redactAllow` or
`redactWith` adds to it and never replaces it: the log applies the per-instance
policy first and the catalog policy after it.

```ts
SecurityErrors.create
  .LOGIN_FAILED("login failed", {
    details: { userId, password },
  })
  .redact(["userId"]); // userId and password masked
```

The floor holds at a cause position, in `logObjectOf()` and at the pino and
Sentry setups. A catalog deny-list that holds `"message"` also masks the
message in `toString()`. The floor masks by key: a `redactWith` callback is
trusted code and can copy a masked value under another key. Per-instance calls
keep last-wins among themselves. On
an error with a catalog policy, the log copies the output of `redactWith`, and
the catalog policy masks the copy. To log a field that the catalog masks,
change the definition.

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

## Codes with a prefix

A codebase with several bounded contexts often uses dotted codes, such as
`restaurant.authz.not_a_member`. A dotted code is no identifier. As a key, it
needs brackets at every call. A `prefix` separates the two names:

- The **key** names a definition in the source code, for example the factory
  `create.not_a_member`.
- The **code** is what the error carries in `error.code`. Logs, dashboards and
  the public-error catalog read it.

The catalog derives each code as `${prefix}.${key}`:

```ts
import {
  defineErrors,
  detailsType,
  type CatalogError,
} from "@shirudo/base-error";

export const AuthzErrors = defineErrors(
  {
    not_a_member: { category: "FORBIDDEN", retryable: false },
    missing_role: {
      category: "FORBIDDEN",
      retryable: false,
      details: detailsType<{ role: string }>(),
    },
  },
  { prefix: "restaurant.authz" },
);

export type AuthzError = CatalogError<typeof AuthzErrors>;

const error = AuthzErrors.create.not_a_member(
  "actor 42 is not a member of org 7",
);
error.code; // "restaurant.authz.not_a_member"
```

The full code stays a literal type in `error.code`, `codes`, `CatalogError`
and `CatalogErrorOf`.

| Member                                 | Takes    | Returns                            |
| -------------------------------------- | -------- | ---------------------------------- |
| `create.<key>(message, options?)`      | the key  | an error that carries the code     |
| `code.<key>`                           | the key  | the code                           |
| `codes`                                |          | the codes, in key order            |
| `match(error, { <key>: handler, _? })` | the key  | the result of the handler          |
| `is(value, key)`                       | the key  | a type guard for that definition   |
| `meta(code)`                           | the code | the static facts of the definition |
| `CatalogErrorOf<C, key>`               | the key  | the error type                     |

`meta` takes the code, because its caller holds an error:
`AuthzErrors.meta(error.code)`. Without a prefix, the key and the code are the
same string, and every member behaves as before.

The prefix must be a string literal. It must not be empty, and it must not
start with, end with or contain a doubled `.`. With a prefix, a key must not
contain a `.`: the prefix holds every segment before the key, so the key is
always the last segment of the code. The compiler rejects any other prefix or
key, and `defineErrors` throws for it at runtime.

### Matching by key

`match` dispatches on the key of an error of this catalog. Without a `_`
catch-all, the compiler requires a handler for each key. Each handler receives
the error type of its key:

```ts
function describe(error: AuthzError): string {
  return AuthzErrors.match(error, {
    not_a_member: () => "join the organization first",
    missing_role: (e) => `ask an owner for the role ${e.details?.role}`,
  });
}
```

`match` rules are the same as the rules of `matchError`. As `matchError`
rejects a code that the union does not contain, `match` rejects a key that the
catalog does not define. `match` checks no provenance,
so narrow a caught value with `AuthzErrors.is(value)` first. Every catalog has
`match`. Without a prefix, it dispatches as `matchError` does. A catalog with
the key `_` cannot use `match`, because `_` is the catch-all. The compiler
rejects the call, and `match` throws at runtime.

### Connecting the public-error catalog

`code` and `codes` connect the catalog to the
[public-error catalog](./public-error) without a copy of a code:

```ts
import { definePublicErrors } from "@shirudo/base-error/public-error";

const forbidden = { publicCode: "forbidden", status: 403, retryable: false };

const publicErrors = definePublicErrors({
  fallback: { publicCode: "internal_error", status: 500, retryable: false },
})
  .registerByCode(AuthzErrors.code.not_a_member, forbidden)
  .registerByCode(AuthzErrors.code.missing_role, forbidden);

publicErrors.assertCoverage(AuthzErrors.codes);
```

`assertCoverage` throws when a code of the catalog has no descriptor, and it
names each such code.

### Pinning the codes in a test

The source contains the prefix and the key, but not the full code. A search
for a code from a log finds the catalog by its prefix, and the key is the last
segment of the code. A key rename changes the code, and the code is a
contract. Pin the codes of each catalog in a test:

```ts
expect(AuthzErrors.codes).toEqual([
  "restaurant.authz.not_a_member",
  "restaurant.authz.missing_role",
]);
```

The test puts each full code into the repository, so a search finds it. A key
rename then fails the test before it changes a log or a dashboard.

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
