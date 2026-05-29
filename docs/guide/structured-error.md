# StructuredError

`StructuredError` extends [`BaseError`](./base-error) with the metadata an
application actually switches on: a typed **code**, a **category**, a
**retryable** flag, and optional structured **details**.

```ts
import { StructuredError } from "@shirudo/base-error";

const error = new StructuredError({
  code: "USER_NOT_FOUND",
  category: "NOT_FOUND",
  retryable: false,
  message: "User with id 123 not found",
  details: { userId: "123" },
});

if (error.code === "USER_NOT_FOUND") {
  // typed, exhaustive handling
}
```

## Typed generics

```ts
type DbCode = "CONNECTION_FAILED" | "QUERY_TIMEOUT" | "DEADLOCK";
type DbCategory = "CONNECTION" | "EXECUTION" | "CONCURRENCY";

interface DbDetails {
  query?: string;
  durationMs?: number;
}

class DatabaseError extends StructuredError<DbCode, DbCategory, DbDetails> {
  constructor(code: DbCode, message: string, details?: DbDetails, cause?: unknown) {
    super({
      code,
      category:
        code === "CONNECTION_FAILED"
          ? "CONNECTION"
          : code === "QUERY_TIMEOUT"
            ? "EXECUTION"
            : "CONCURRENCY",
      retryable: code !== "DEADLOCK",
      message,
      details,
      cause,
    });
  }
}
```

## Options

| Option | Type | Notes |
| --- | --- | --- |
| `code` | `TCode` | Programmatic, internal error code |
| `category` | `TCategory` | Internal grouping |
| `retryable` | `boolean` | Drives retry logic |
| `message` | `string` | Technical message (logs) |
| `details` | `TDetails` | Structured context — **internal**, never auto-exposed |
| `publicCode` | `TPublicCode` | Stable client-safe code |
| `publicMessage` | `string` | Client-safe message |
| `expose` | `boolean` | Allow technical fallback in public serializers |
| `cause` | `unknown` | Underlying error |

## `code` vs `publicCode`

The internal `code` (`DB_UNIQUE_VIOLATION`) is for your logs and your own
control flow. Map it to a stable `publicCode` (`EMAIL_ALREADY_REGISTERED`) when
the boundary should expose a code at all — see
[Problem Details](./problem-details).

## Serialization

Beyond [`BaseError`](./base-error#serialization), `StructuredError` adds:

- `toProblemDetails()` → [RFC 9457 Problem Details](./problem-details)
- `toErrorResponse()` → [discriminated API responses](./error-responses)
- `toLogObject()` also carries `code`, `category`, `retryable` and raw `details`
