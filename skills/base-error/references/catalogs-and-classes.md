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

Use the error codes your codebase prescribes as keys. The library accepts any
non-empty string; it imposes no casing or format.

| Member | Purpose |
| --- | --- |
| `create.CODE(message, { details?, cause? })` | builds a `StructuredError` with that literal `code`; `details` is required only when the definition declares `detailsType<T>()` |
| `is(value)`, `is(value, "CODE")` | true only for instances this exact catalog created |
| `meta("CODE")` | frozen `{ category, retryable, metadata? }` |
| `codes` | the frozen list of codes |

- `detailsType<T>()` is a compile-time marker. Validate untrusted input before
  you pass it as `details` (see `ValidationError` below).
- `metadata` must be JSON-safe. HTTP, gRPC or CLI mappings stay the
  consumer's choice; `metadata.httpStatus` is a convention, not a field the
  library reads.
- `redaction: { mode: "deny" | "allow", keys: […] }` on a definition applies a
  sticky log redaction policy to every instance of that code.

### Factories return; they do not throw

`create.CODE(…)` returns the error. Return it in a `Result` for an expected
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
