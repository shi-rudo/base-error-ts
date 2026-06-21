# BaseError

`BaseError<T>` is the foundation. Extend it for bespoke errors, or reach for
[`StructuredError`](./structured-error) when you want typed codes and categories
out of the box. It is purely technical: it models the failure for your logs and
control flow. Client-facing text is produced separately, by the
[presentation layer](./presentation).

```ts
import { BaseError } from "@shirudo/base-error";

class PaymentDeclinedError extends BaseError<"PaymentDeclinedError"> {
  constructor(reason: string, cause?: unknown) {
    super(`Payment declined: ${reason}`, cause);
  }
}
```

The generic parameter `T` is the error's `name`. It is inferred from the
constructor by default and narrows the discriminant `_tag` for exhaustive
`switch` handling.

## Constructor

```ts
new BaseError(
  message: string,
  cause?: unknown,
  options?: {
    name?: string; // override the runtime name (defaults to constructor name)
  },
);
```

## Properties

| Property       | Description                                                  |
| -------------- | ------------------------------------------------------------ |
| `name`         | Error type name (`T`)                                        |
| `_tag`         | Discriminant for narrowing, defaults to the constructor name |
| `message`      | Technical message (for logs)                                 |
| `cause`        | Native cause where supported, preserved cross-runtime        |
| `stack`        | Richest stack the host can provide                           |
| `timestamp`    | Epoch-ms number                                              |
| `timestampIso` | ISO-8601 string                                              |

`BaseError` gives you automatic name inference, cause chaining, cross-runtime
stack capture and timestamps out of the box.

## Redaction

PII redaction scrubs the **log** path (see
[Observability & logging](./observability) for the full treatment):

| Method                        | Purpose                                                        |
| ----------------------------- | -------------------------------------------------------------- |
| `redact(keys, options?)`      | Sticky deny-list: mask the given keys (deep) in log output     |
| `redactAllow(keys, options?)` | Sticky allow-list: mask every data leaf except the listed ones |
| `redactWith(fn)`              | Arbitrary transform of the log object (composition seam)       |

## Serialization

| Method          | Path          | Contents                                           |
| --------------- | ------------- | -------------------------------------------------- |
| `toLogObject()` | Observability | name, message, stack, full cause chain, timestamps |
| `toJSON()`      | Observability | alias of `toLogObject()`                           |
| `toString()`    | N/A           | one-liner plus the full nested cause chain         |

`toLogObject()` / `toJSON()` are **internal, full-fidelity log output**. They are
not safe to send to clients: they carry the technical message, stack and cause
chain. For client-facing text, use the [presentation layer](./presentation),
which projects an explicit allowlist (a public code, a resolved localized
message, and any deliberately projected details).

See [Observability & logging](./observability) and
[Why safe by default](./safe-by-default) for the two-path model.
