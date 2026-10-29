# Logging and redaction

The log path carries the full technical truth: name, message, stack, the cause
chain, `code`, `category`, `retryable`, `details` and any own log fields. It is
internal output and never goes to a client.

## Getting the log form

| Call | Use for |
| --- | --- |
| `err.toLogObject()` | an error of this library; `toJSON()` is an alias |
| `logObjectOf(value)` | anything caught: a library error, a native or third-party `Error`, or a non-error value |

```ts
import { logObjectOf } from "@shirudo/base-error";

try {
  await handle(request);
} catch (e) {
  logger.error({ err: logObjectOf(e) }, "request failed");
  throw e;
}
```

`logObjectOf` does not throw and stays bounded, keeps a native error's own
`name` and `message`, and keeps each library error's redaction policy along the
chain. A logger whose standard serializer reads the error object itself (pino's
`err` serializer, for one) bypasses the policy; route the value through
`logObjectOf` in the serializer instead.

For Sentry or OpenTelemetry, pass the error and its log object, for example
`Sentry.captureException(error, { extra: error.toLogObject() })`.

## Redaction

Redaction is a sticky policy on the error. It applies to `toLogObject()`,
`toJSON()` and therefore to `JSON.stringify(err)`.

| Method | Effect |
| --- | --- |
| `redact(keys, { mask? })` | deny-list: mask the named keys at any depth |
| `redactAllow(keys, { mask? })` | allow-list: mask every data leaf except the named keys; the stricter choice |
| `redactWith(fn)` | a trusted, synchronous transform of the whole log record |
| catalog `redaction: { mode, keys }` | the same deny or allow policy for every instance of a code |

```ts
const failure = AccountErrors.create.PROFILE_UPDATE_FAILED("update failed", {
  details: { userId, email, taxId },
}).redact(["email", "taxId"]);
```

- The policy travels with the error. As a `cause`, its node is masked by its
  own policy first, then by the outer error's policy.
- Redaction selects keys, not values. To hide the time, deny both `timestamp`
  and `timestampIso`.
- `err.stack` and `console.log(err)` show the raw message. Interpolating the
  error into a string uses `toString()`, which masks a denied message; a
  structured logger call is still the safe default.
- `redactWith` output is trusted as returned; the library does not mask or
  validate it again.

## Own log fields

A subclass adds identifiers to its log node by overriding
`buildOwnLogFields()` (see `catalogs-and-classes.md`). The fields appear at
every depth of every chain that wraps the error, count as data under
`redactAllow`, and are copied, so dates, bigints and collections should be
converted explicitly. Keep payloads out; this is for identifiers.

## Bounds and markers

The log build never throws and stays bounded. A failed read leaves
`[Unserializable value]`, a shared cause reads `[Shared cause]` at its second
position, and an exhausted size budget leaves `[Max log size exceeded]`. These
are values in the log, not errors to handle.

## Reconstructing: `StructuredError.fromJSON`

`StructuredError.fromJSON(payload)` rebuilds a typed `StructuredError` from a
serialized log object: `code`, `category`, `retryable`, `details`, the cause
chain with stacks, and the root's timestamp. Use it inside one trust boundary,
such as a worker or a queue the same service reads. Own log fields are not
restored. A rebuilt error is not a catalog instance, so `Errors.is(…)` rejects
it by design; classify it by `code` or with `isStructuredError`.
