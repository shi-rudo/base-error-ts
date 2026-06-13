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
  constructor(
    code: DbCode,
    message: string,
    details?: DbDetails,
    cause?: unknown,
  ) {
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

| Option      | Type        | Notes                                                 |
| ----------- | ----------- | ----------------------------------------------------- |
| `code`      | `TCode`     | Programmatic, internal error code                     |
| `category`  | `TCategory` | Internal grouping                                     |
| `retryable` | `boolean`   | Drives retry logic                                    |
| `message`   | `string`    | Technical message (logs)                              |
| `details`   | `TDetails`  | Structured context (**internal**, never auto-exposed) |
| `cause`     | `unknown`   | Underlying error                                      |

## The `code` is the contract

The `code` (`DB_UNIQUE_VIOLATION`) is what your logs, control flow and tests
switch on. It is stable and machine-readable. When the boundary needs to show a
client-facing code or message, map the technical `code` to a public code and
localized text in the [presentation layer](./presentation). The error itself
stays purely technical.

## Serialization

Beyond [`BaseError`](./base-error#serialization), `StructuredError`'s
`toLogObject()` / `toJSON()` also carry `code`, `category`, `retryable` and raw
`details`. These are internal, full-fidelity log output, not client-safe. For
public output, see the [presentation layer](./presentation).

`StructuredError.fromJSON(payload)` is the inverse: it reconstructs a typed
`StructuredError` (`code`, `category`, `retryable`, `details`, the original
`stack` / `timestamp`, and the cause chain) from the serialized shape. See
[Observability & logging](./observability).
