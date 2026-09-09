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
import { StructuredError, type OwnLogFields } from "@shirudo/base-error";

class ConcurrencyConflictError extends StructuredError<
  "CONCURRENCY_CONFLICT",
  "CONFLICT"
> {
  constructor(
    public readonly expectedVersion: number,
    public readonly actualVersion: number,
    public readonly requestId?: string,
  ) {
    super({ code: "CONCURRENCY_CONFLICT", category: "CONFLICT", retryable: true, message: "stale version" });
  }

  protected override buildOwnLogFields(): OwnLogFields {
    return { expectedVersion: this.expectedVersion, actualVersion: this.actualVersion, requestId: this.requestId ?? null };
  }
}
```

`OwnLogFields` is the recommended return type. It describes a readonly record
whose values are strings, numbers, booleans, `null`, readonly arrays, or nested
records. Convert dates, collections,
and bigints explicitly. Use `?? null` for optional fields, as above, or omit
the key. Do not return
getters, callbacks, or objects with custom serialization methods.

The type rejects common non-data values, including functions, dates, and errors.
It cannot prove that numbers are finite, records have plain prototypes, or
values contain no getters or cycles. Runtime guards still apply. The base hook
keeps its `Record<string, unknown>` signature so existing overrides remain compatible.

The hook supplies data; the library assembles the envelope, traverses causes,
and applies redaction. The consumer's logging adapter selects the log level,
transport, sampling, and storage. The hook must finish synchronously and must
not perform I/O. The serializer can catch a thrown exception, but it cannot
interrupt consumer code or bound the work inside a getter or callback.

Fields declared here survive at **every depth of every chain that wraps this
error**, so an adapter that wraps the error in its own type does not lose them.
That is the reason this hook exists, and it is the difference from overriding
`buildLogObject()`, whose fields appear at the root only.

The rules the hook lives under, because a log path must not throw and must stay
bounded:

| Rule | Effect |
| --- | --- |
| Takes no arguments | An error describes itself the same way wherever it sits in a chain |
| Must not walk a chain or log another error | An error returned directly as a field value is dropped. A nested `BaseError` keeps a primitive diagnostic envelope and its sticky policy; its hooks, details, and links are not expanded |
| The library's own keys win | A returned key that carries a name this library writes is dropped. Its declaration, `#RESERVED_NODE_KEYS` in `src/errors/BaseError.ts`, owns that list: the envelope names, `cause`, `errors`, and `__proto__`, which the runtime owns. Name a field something else if it collides |
| At most 100 fields (`MAX_OWN_LOG_FIELDS`, whose declaration in `src/errors/walker-bounds.ts` owns the number) | The reader stops there |
| A throw, or a return that is not a record, costs the fields | The node keeps its envelope and its cause chain. A getter that throws costs its own key only |
| Values are copied as data | The log shares no reference with the error, and a bigint or a cycle cannot make a consumer's `JSON.stringify` throw |
| Data depth is limited to 100 | The copy keeps `{}` or `[]` at the cap and reads no children. Cause depth counts separately |

Rejected keys, failed hooks, and width cuts remain silent. The whole log build
shares a 100,000-visit budget across causes, data values, and own-key inspections
(`MAX_LOG_NODES` in `src/errors/walker-bounds.ts`). Once spent, the current data
field becomes `[Max log size exceeded]`. A later field can carry the same marker
before the hook reader stops; an aggregate ends with one size marker. This names
a size cut, never a cycle. Earlier completed fields remain intact.

The marker is a **value**, not an extra diagnostic key. On a data field it is
masked under `redactAllow([])`. Only a marker emitted on a cause link or aggregate
slot has the private provenance that can preserve it there. Matching consumer
text gets no exception. The fixed root envelope copy has its own bounded key
allowance. JavaScript key enumeration is eager, and consumer callbacks cannot be
interrupted; the budget limits the library's subsequent reads and expansion.

Everything returned here is logged wherever this error is logged. It is the
place for identifiers, not for payloads. A redaction policy still applies:
under `redactAllow` these fields are data and are masked unless listed.

Two limits worth knowing. An error from another realm, or one behind a Proxy,
carries no reachable hook and is logged like any foreign error. And
`StructuredError.fromJSON` does not restore these fields; it reconstructs the
envelope it whitelists, so a round trip keeps `code`, `category`, `retryable`
and `details` and drops the rest.

### Migrating from `buildLogObject()`

`buildLogObject()` is deprecated. Existing overrides and `super.buildLogObject()`
calls remain supported during migration. This release does not remove the hook.
Both uses can show a deprecation diagnostic in your editor.

Move additional fields into `buildOwnLogFields()`. Return only those fields;
do not spread `super.buildLogObject()` into the result. For an own-fields
inheritance chain, spread `super.buildOwnLogFields()` if the parent contributes
fields. A `StructuredError` subclass does not need to repeat `code`, `category`,
`retryable`, or `details`.

If an override changes envelope names or layout, move that transformation into
the consumer's logging adapter. Transform the result of `error.toLogObject()`
after redaction. Do not read raw error properties back into the transformed log.
No replacement envelope hook is provided.

The two hooks have different value semantics. `buildOwnLogFields()` copies its
values through the bounded data serializer. A date becomes an ISO string,
a bigint becomes a decimal string, and a map becomes `{}`. The deprecated hook
passes nested values through. Convert values explicitly when migrating to
`OwnLogFields`; for example, use `date.toISOString()` and `bigint.toString()`.

For the deprecated hook, the library copies the returned record without invoking
its setters. It reads the fixed envelope first, then inspects at most 1000 own
keys for other fields.
Symbols and non-enumerable keys consume this limit. Key enumeration itself is
eager, because JavaScript has no lazy own-key operation. A custom record with
no readable fields falls back to the triage envelope.

During a data value's `toJSON`, a nested `toLogObject()` call returns `{}`.
This prevents recursive logging from restarting the walker. Cause depth and
data depth count separately in the data copy, as they do in redaction.

See [Observability & logging](./observability) and
[Why safe by default](./safe-by-default) for the two-path model.

### Log object compatibility

The base envelope retains its property order: `name`, `message`, `timestamp`,
`timestampIso`, `stack`, `cause`. The last two keys remain own properties even
when their values are `undefined`; JSON omits those values as before.
`StructuredError` appends `code`, `category`, `retryable`, and `details` when
present. Legacy override records keep their enumerable key order within the
copy allowance. Empty or all-undefined overrides use the ordinary base envelope;
`[log build failed]` is reserved for failure of that fallback too.

The reproducible performance comparison is in
[the serialization measurement](./log-serialization-performance.md).
