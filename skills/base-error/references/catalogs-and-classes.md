# Catalogs and error classes

## `defineErrors`: a closed catalog

A catalog is the default way to define the errors a component owns. It gives
typed factories, per-code metadata, a closed union type and a guard that
recognizes only its own instances.

```ts
import {
  defineErrors,
  detailsType,
  type CatalogError,
  type CatalogErrorOf,
  type ErrorCatalogDefinition,
} from "@shirudo/base-error";

export const OrderErrors = defineErrors({
  ORDER_NOT_FOUND: {
    category: "NOT_FOUND",
    retryable: false,
    details: detailsType<{ orderId: string }>(),
  },
  STOCK_RESERVATION_FAILED: {
    category: "INFRASTRUCTURE",
    retryable: true,
    metadata: { httpStatus: 503 },
  },
});

export type OrderError = CatalogError<typeof OrderErrors>;
export type OrderNotFound = CatalogErrorOf<typeof OrderErrors, "ORDER_NOT_FOUND">;
```

Use the error codes your codebase prescribes. The library accepts any
non-empty string as a key and imposes no casing or format. Without a prefix,
the key is the code. For dotted codes, see *Dotted codes: a prefix*.

| Member | Purpose |
| --- | --- |
| `create.KEY(message, { details?, cause? })` | builds a `StructuredError` with that literal `code`; `details` is required only when the definition declares `detailsType<T>()` |
| `is(value)`, `is(value, "KEY")` | true only for instances this exact catalog created |
| `match(error, { KEY: handler, _? })` | dispatches on the key; exhaustive without `_` |
| `meta(code)` | frozen `{ category, retryable, metadata? }`; takes the code, so `meta(error.code)` works |
| `code.KEY` | the code of a key |
| `codes` | the frozen list of codes |

- `detailsType<T>()` is a compile-time marker. Validate untrusted input before
  you pass it as `details` (see the section `ValidationError`).
- `metadata` must be JSON-safe. HTTP, gRPC or CLI mappings stay the
  consumer's choice; `metadata.httpStatus` is a convention, not a field the
  library reads.
- `redaction: { mode: "deny" | "allow", keys: […] }` on a definition applies a
  sticky log redaction policy to every instance of that code. It is a floor:
  a per-instance `redact`, `redactAllow` or `redactWith` adds to it and cannot
  relax it (see `logging-and-redaction.md`).

### Dotted codes: a prefix

A code such as `restaurant.authz.not_a_member` is no identifier. Do not key the
catalog by it, and do not write a separate object of code constants. Pass the
namespace as `prefix` and use the last segment as the key:

```ts
import { defineErrors, detailsType, type CatalogError } from "@shirudo/base-error";

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

const error = AuthzErrors.create.not_a_member("actor 42 is not a member of org 7");
error.code; // "restaurant.authz.not_a_member", a literal type
```

- The catalog derives each code as `${prefix}.${key}`. The separator is
  always `.`.
- `create`, `code`, `match`, `is` and `CatalogErrorOf` take the key.
  `meta` takes the code, because its caller holds an error.
- `codes`, `CatalogError` and `CatalogErrorOf` keep the full code as a literal
  type.
- The prefix must be a string literal without a leading, trailing or doubled
  `.`, and a key under a prefix must not contain a `.`: the prefix holds every
  segment before the key. The compiler and the runtime reject anything else.
- The prefix belongs to the catalog. Definitions of one area compose with
  spread before `defineErrors`; two areas are two catalogs.

Connect the public-error catalog through `code` and `codes`, never through a
copied string:

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

The full code is not in the source, and a key rename changes it. Pin the codes
of each catalog in a test, so a search for a code from a log finds it and a
rename fails the test:

```ts
expect(AuthzErrors.codes).toEqual([
  "restaurant.authz.not_a_member",
  "restaurant.authz.missing_role",
]);
```

### Factories return; they do not throw

`create.KEY(…)` returns the error. Return it in a `Result` for an expected
failure, or `throw` it where your codebase throws:

```ts
return err(OrderErrors.create.ORDER_NOT_FOUND("order missing in lookup", {
  details: { orderId },
}));
```

### Composing catalogs

Compose the definition objects, then call `defineErrors` once:

```ts
const lookupErrors = {
  ORDER_NOT_FOUND: { category: "NOT_FOUND", retryable: false },
} satisfies ErrorCatalogDefinition;

const AppErrors = defineErrors({ ...lookupErrors, ...billingErrors });
```

Object spread replaces a duplicate key silently; keep codes unique. Catalogs
have no `merge`, `map` or `select`. Keep separately owned catalogs separate and
classify them together where needed:

```ts
type AnyDomainError = CatalogError<typeof OrderErrors> | CatalogError<typeof BillingErrors>;
const isAnyDomainError = (v: unknown): v is AnyDomainError =>
  OrderErrors.is(v) || BillingErrors.is(v);
```

A second catalog built from the same definitions does not recognize the first
one's instances: provenance belongs to the catalog instance.

## `StructuredError` and subclasses

`StructuredError<TCode, TCategory, TDetails>` takes one options object:
`{ code, category, retryable, message, details?, cause? }`. Subclass it when an
error needs its own fields or behavior:

```ts
import { StructuredError, type OwnLogFields } from "@shirudo/base-error";

class StaleWriteError extends StructuredError<"STALE_WRITE", "CONFLICT"> {
  constructor(readonly expected: number, readonly actual: number) {
    super({ code: "STALE_WRITE", category: "CONFLICT", retryable: true, message: "stale version" });
  }

  protected override buildOwnLogFields(): OwnLogFields {
    return { expected: this.expected, actual: this.actual };
  }
}
```

- `buildOwnLogFields()` returns only the subclass's own fields, as plain data.
  `code`, `category`, `retryable` and `details` are added anyway. It must not
  do I/O, log, or walk a chain.
- `name` equals `code`; `_tag` is a stable literal, so minification does not
  affect it.

`BaseError<T>` is the plain base (`new BaseError(message, cause?, { name? })`).
A `BaseError` subclass that relies on the inferred class name breaks under
minification; give it an explicit `name` or a literal `_tag`.

## `ValidationError`

Collects field-level failures into one structured error with code
`VALIDATION_FAILED` and category `VALIDATION`:

```ts
import { ValidationError } from "@shirudo/base-error";

const result = await schema["~standard"].validate(input); // any Standard Schema validator
if (result.issues) {
  return err(new ValidationError("Invalid order input", { issues: result.issues }));
}
```

- `addIssue`, `addIssues`, `hasIssues` build it up by hand.
- Issues are internal. `publicIssues()` returns a whitelisted
  `{ path?, pointer?, code? }` per issue; `publicIssues({ messages: true })`
  adds the message unchanged, so use it only for messages you wrote.
- The log object keeps every issue in full.

## `StructuredAggregateError`

For several failures that belong to one operation:

```ts
const failures = results.filter((r) => r.status === "rejected").map((r) => r.reason);
if (failures.length > 0) {
  throw new StructuredAggregateError({
    code: "BATCH_FAILED",
    category: "INFRASTRUCTURE",
    retryable: true,
    message: `${failures.length} of ${results.length} items failed`,
    errors: failures,
  });
}
```

The log object renders each member; cause-chain helpers visit members only
with `{ aggregates: true }`.
