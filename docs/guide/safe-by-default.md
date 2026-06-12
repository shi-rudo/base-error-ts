# Why safe by default

Leaking an internal exception message, stack trace or database detail into an
API response is a recognized vulnerability ([CWE-209: Information Exposure
Through an Error Message](https://cwe.mitre.org/data/definitions/209.html)). In
regulated and enterprise contexts it is frequently a compliance finding.

This library treats the boundary of your application the way DDD treats the
boundary of a bounded context: what crosses it is a deliberate, **published**
representation, never the internal model by accident.

## The guarantee is invariant

The client-facing serializers (`toPublicJSON`, `toProblemDetails`,
`toErrorResponse`) emit only safe values by default:

- The technical `message` is replaced by a safe public message.
- The internal `code` becomes a stable public code (`INTERNAL_ERROR` by default).
- The internal `category` is omitted.
- Raw `details`, `cause` and `stack` are never present.

```ts
const err = new StructuredError({
  code: "DB_UNIQUE_VIOLATION",
  category: "INFRASTRUCTURE",
  retryable: false,
  message: "duplicate key value violates unique constraint users_email_key",
});

err.toProblemDetails({ status: 409 });
// {
//   status: 409,
//   detail: "An unexpected error occurred.",
//   code: "INTERNAL_ERROR",
//   retryable: false
// }
```

There is **no override switch**. Standard Problem Details members
(`type`, `title`, `status`, `detail`, `instance`) and library members
(`code`, `category`, `retryable`, `traceId`) always win over colliding
extension keys. A call site cannot accidentally leak, and you never have to
check a flag to know whether a given response is safe.

## Exposing things is always explicit

When you _do_ want to surface information, you say so by name:

- [`publicCode`](./problem-details#public-code-message-category) / `publicMessage` / `publicCategory`: deliberate public values.
- [`expose`](./problem-details#exposing-technical-fields): opt in to the technical name/category/message.
- [`mapDetails`](./problem-details#projecting-details): the only way to surface `details`, as a reviewable projection.

## "But I need the full error for Sentry"

You do, and you get it on a **separate** path. See
[Observability & logging](./observability). The strictness here applies only to
the user-facing path; `toLogObject()` keeps the full, unredacted error.
