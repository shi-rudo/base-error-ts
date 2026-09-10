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
| `redactWith(fn)`              | Trusted synchronous transform of the complete log record       |

Successful custom output is consumer-controlled. The library does not validate
or mask it again. A thrown callback uses diagnostic fields captured before
invocation. See the [custom redactor contract](./observability#custom-redactor-contract)
for mutation, JSON safety, policy order, and recursion limits.

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

### Check the contract in consumer tests

Use `inspectOwnLogFields` on the record your hook returns. It reports reserved
names, unsupported values, accessors, cycles, and inspection limits with paths.
It does not execute getters or serialization callbacks, and never runs implicitly
while logging. Proxy reflection traps still execute and cannot be interrupted.

```ts
import { inspectOwnLogFields } from "@shirudo/base-error";

expect(inspectOwnLogFields({ requestId: "R" })).toEqual([]);
expect(inspectOwnLogFields({ details: "lost" })).toEqual([
  { path: ["details"], reason: "reserved-key" },
]);
```

A test subclass can expose `super.buildOwnLogFields()` through a public test
method. Inspect that method's result to check the actual hook implementation.
The checker reports at most 100 issues and uses the data depth and node limits.
It inspects up to 1,000 root keys, including keys after the 100-field retention limit.
It reports a width limit for more than 100 valid data fields or more than 1,000 root keys.
Skipped keys do not count as valid data fields. Other contract violations have their own issues.
An empty result means the inspected record satisfies the recommended data contract.
It does not predict the remaining budget when that record sits in a larger log.

The hook supplies data; the library assembles the envelope, traverses causes,
and applies redaction. The consumer's logging adapter selects the log level,
transport, sampling, and storage. The hook must finish synchronously and must
not perform I/O. The serializer can catch a thrown exception, but it cannot
interrupt consumer code or bound the work inside a getter or callback.

Fields declared here survive at **every depth of every chain that wraps this
error**, so an adapter that wraps the error in its own type does not lose them.
The library builds the envelope internally; `buildLogObject()` is removed in the next major.

The rules the hook lives under, because a log path must not throw and must stay
bounded:

| Rule | Effect |
| --- | --- |
| Takes no arguments | An error describes itself the same way wherever it sits in a chain |
| Must not walk a chain or log another error | An error returned directly as a field value is dropped. A nested `BaseError` keeps a primitive diagnostic envelope and its sticky policy; its hooks, details, and links are not expanded |
| The library's own keys win | A returned key that carries a name this library writes is dropped. Its declaration, `RESERVED_NODE_KEYS` in `src/errors/log-field-keys.ts`, owns that list: the envelope names, `cause`, `errors`, and `__proto__`, which the runtime owns. Name a field something else if it collides |
| At most 100 fields (`MAX_OWN_LOG_FIELDS`, whose declaration in `src/errors/walker-bounds.ts` owns the number) | The reader stops there |
| A throw, or a return that is not a record, costs the fields | The node keeps its envelope and its cause chain. A getter that throws costs its own key only |
| Values are copied as data | The log shares no reference with the error, and a bigint or a cycle cannot make a consumer's `JSON.stringify` throw |
| Data depth is limited to 100 | The copy keeps `{}` or `[]` at the cap and reads no children. Cause depth counts separately |

Rejected keys, failed hooks, and width cuts remain silent in production. Each library-owned build
shares a 100,000-visit budget across causes, data values, and own-key inspections
(`MAX_LOG_NODES` in `src/errors/walker-bounds.ts`). Once spent, the current data
field becomes `[Max log size exceeded]`. A later field can carry the same marker
before the hook reader stops; an aggregate ends with one size marker. This names
a size cut, never a cycle. Earlier completed fields remain intact.
Already-read scalar envelope fields survive exhaustion. In particular, `code`
keeps its value and `retryable: false` stays boolean `false`. After exhaustion,
non-scalar envelope fields are omitted without expansion.

Redaction preserves empty containers that the serializer produced at its depth cap.
Private container provenance identifies these cuts. Consumer data added to a cut
container cannot pass the redaction depth cap.

The marker is a **value**, not an extra diagnostic key. On a data field it is
masked under `redactAllow([])`. Only a marker emitted on a cause link or aggregate
slot has the private provenance that can preserve it there. Matching consumer
text gets no exception. Root assembly reads a fixed list of instance properties.
JavaScript key enumeration is eager, and consumer callbacks cannot be
interrupted; the budget limits the library's subsequent reads and expansion.

Built-in redaction has a separate 100,000-read allowance per walk
(`MAX_REDACTION_READS`). It covers container classification, key inspections,
and value reads in every region. Symbols and non-enumerable keys consume it.
A value can require multiple reads, so this limit can precede the data-node limit.
After exhaustion, the policy returns only its safe envelope with
`message: "[Max redaction size exceeded]"`. Correctly typed non-sensitive fields,
including `code` and `retryable`, keep their values. Payload, stack, and links are omitted.
The library never passes an uninspected object through as a leaf.
Work inside a consumer callback or reflection trap remains outside this allowance.
Deny-list masking of names and messages in stack headers uses values captured during the copy.
It does not repeat the source reads. Changing getters cannot expose a previously copied message.

Everything returned here is logged wherever this error is logged. It is the
place for identifiers, not for payloads. A redaction policy still applies:
under `redactAllow` these fields are data and are masked unless listed.

Two limits worth knowing. An error from another realm, or one behind a Proxy,
carries no reachable hook and is logged like any foreign error. And
`StructuredError.fromJSON` does not restore these fields; it reconstructs the
envelope it whitelists, so a round trip keeps `code`, `category`, `retryable`
and `details` and drops the rest.

### Migrating from `buildLogObject()`

**Breaking change for the next major:** `buildLogObject()` is removed from
`BaseError` and `StructuredError`. Overrides and `super.buildLogObject()` calls
no longer compile. JavaScript methods with that name are not called by logging.

Move additional fields into `buildOwnLogFields()`. Return only those fields;
do not spread `super.buildLogObject()` into the result. For an own-fields
inheritance chain, spread `super.buildOwnLogFields()` if the parent contributes
fields. A `StructuredError` subclass does not need to repeat `code`, `category`,
`retryable`, or `details`.

If an override changes envelope names or layout, move that transformation into
the consumer's logging adapter. Transform the result of `error.toLogObject()`
after redaction. Do not read raw error properties back into the transformed log.
No replacement envelope hook is provided.

The removed hook passed nested values through. `buildOwnLogFields()` copies its
values through the bounded data serializer: dates become ISO strings, bigints
become decimal strings, and maps become `{}`. Convert values explicitly when
migrating to `OwnLogFields`, for example with `date.toISOString()`.

The legacy record copier, inspection-cut message suffix, and fallback assembly
are removed with the hook. A throwing instance getter now costs its own field;
other readable diagnostics, decision fields, and the cause chain remain available.

Each public `toLogObject()` call starts an independent build, including calls
made explicitly by a consumer callback. A `BaseError` encountered as a data
value instead receives its primitive diagnostic view directly. Its `toJSON`
override is not called. Cause depth and data depth count separately.

Consumer callbacks can initiate multiple public builds. Their work remains
outside the enclosing traversal allowance. The library stores no current-build state.

See [Observability & logging](./observability) and
[Why safe by default](./safe-by-default) for the two-path model.

### Log object compatibility

The root reads `name`, `message`, `timestamp`, `timestampIso`, and `stack` in
that order, followed by `cause`, aggregate members, and structured fields.
Undefined or unreadable fields are omitted, except for the own `cause` slot.
`StructuredError` fields are read independently of the own-fields hook.
Root `details` retains its existing in-process value semantics; redaction walks
it when configured. Cause details and own-hook values use bounded data copies.
Custom redactors remain consumer callbacks and can replace their node's log.

The reproducible performance comparison is in
[the serialization measurement](./log-serialization-performance.md).
