# BaseError

`BaseError<T>` is the foundation. Extend it for bespoke errors, or reach for
[`StructuredError`](./structured-error) when you want typed codes and categories
out of the box. It is purely technical: it models the failure for your logs and
control flow. Client-facing text is produced separately, by the
[public-error pipeline](./public-error).

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
| `toString()`    | N/A           | one-liner plus the nested cause chain, cut at 100 hops like the log object for error chains (a plain-object cause is one value in the log and a chain here) |

`toLogObject()` / `toJSON()` are **internal, full-fidelity log output**. They are
not safe to send to clients: they carry the technical message, stack and cause
chain. For client-facing text, use the [public-error pipeline](./public-error),
which projects an explicit allowlist (a public code, a resolved localized
message, and any deliberately projected details).

## Adding your own log fields

Override `buildOwnLogFields()` to put a subclass's own fields into the log
object. Return a fresh record holding those fields and nothing else. The fields
a base class declares are composed separately, so this hook never has to repeat
them: a `StructuredError` subclass keeps `code`, `category`, `retryable` and
`details` whatever this hook returns.

```ts
class ConcurrencyConflictError extends StructuredError<
  "CONCURRENCY_CONFLICT",
  "CONFLICT"
> {
  constructor(
    public readonly expectedVersion: number,
    public readonly actualVersion: number,
  ) {
    super({ code: "CONCURRENCY_CONFLICT", category: "CONFLICT", retryable: true, message: "stale version" });
  }

  protected override buildOwnLogFields(): Record<string, unknown> {
    return { expectedVersion: this.expectedVersion, actualVersion: this.actualVersion };
  }
}
```

Fields declared here survive at **every depth of every chain that wraps this
error**, so an adapter that wraps the error in its own type does not lose them.
That is the reason this hook exists, and it is the difference from overriding
`buildLogObject()`, whose fields appear at the root only.

The rules the hook lives under, because a log path must not throw and must stay
bounded:

| Rule | Effect |
| --- | --- |
| Takes no arguments | An error describes itself the same way wherever it sits in a chain |
| Must not walk a chain or log another error | The enclosing bounds hold by construction. An error returned as a field value is dropped, because logging it would re-enter the log build |
| The library's own keys win | A returned key that carries a name this library writes is dropped. Its declaration, `#RESERVED_NODE_KEYS` in `src/errors/BaseError.ts`, owns that list: the envelope names, `cause`, `errors`, and `__proto__`, which the runtime owns. Name a field something else if it collides |
| At most 100 fields (`MAX_OWN_LOG_FIELDS`, whose declaration in `src/errors/walker-bounds.ts` owns the number) | The reader stops there |
| A throw, or a return that is not a record, costs the fields | The node keeps its envelope and its cause chain. A getter that throws costs its own key only |
| Values are copied as data | The log shares no reference with the error, and a bigint or a cycle cannot make a consumer's `JSON.stringify` throw |

Every one of those losses is **silent**. This path writes no marker of its own,
unlike the cause spine, where the serializer names a cut. A marker here would
be a key on the log object that a redaction region has to classify and that a
hook could forge, and that machinery cost more than the diagnostic was worth.
If you need to know that a hook was cut or failed, assert on its fields in a
test rather than reading it out of a production log.

Everything returned here is logged wherever this error is logged. It is the
place for identifiers, not for payloads. A redaction policy still applies:
under `redactAllow` these fields are data and are masked unless listed.

Two limits worth knowing. An error from another realm, or one behind a Proxy,
carries no reachable hook and is logged like any foreign error. And
`StructuredError.fromJSON` does not restore these fields; it reconstructs the
envelope it whitelists, so a round trip keeps `code`, `category`, `retryable`
and `details` and drops the rest.

Overriding `buildLogObject()` still works and is still the way to reshape the
envelope itself. It is not the place to add fields, because the serializer
cannot run it on a cause without restarting the bounded cause walk.

See [Observability & logging](./observability) and
[Why safe by default](./safe-by-default) for the two-path model.
