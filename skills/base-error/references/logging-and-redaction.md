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
chain. For pino and Sentry, use their setups in *Loggers and reporters*
instead.

## Loggers and reporters

A logger or reporter that reads the error object itself bypasses the redaction
policy. Use the setup for the sink:

| Sink | Setup |
| --- | --- |
| pino | `@shirudo/base-error/pino`: spread `pinoErrorOptions` into the logger options |
| Sentry | `@shirudo/base-error/sentry`: `beforeSend` and `logObjectContextIntegration()` in `Sentry.init` |
| any other reporter, OpenTelemetry included | give it `logObjectOf(error)`, never the error |

```ts
import pino from "pino";
import { pinoErrorOptions } from "@shirudo/base-error/pino";

const logger = pino({ ...pinoErrorOptions, level: "info" });

logger.error({ err: caught, requestId }, "request failed");
```

```ts
import * as Sentry from "@sentry/node";
import { beforeSend, logObjectContextIntegration } from "@shirudo/base-error/sentry";

Sentry.init({ dsn, beforeSend, integrations: [logObjectContextIntegration()] });

Sentry.captureException(error);
```

- With pino, put the error itself under `err`. The setup writes it through
  `logObjectOf`; a log object that you build yourself is copied again as data.
- Never send `Sentry.captureException(error, { extra: error.toLogObject() })`
  without the setup. Sentry still writes the raw name and message of the error
  and of each cause as the exceptions of the event, and Sentry stores them.
- With serializers or hooks of your own, combine yours with
  `pinoErrorOptions.serializers.err` and `pinoErrorOptions.hooks.logMethod`.
  With a `beforeSend` of your own, call this `beforeSend` in it first.
- Neither subpath imports pino or Sentry; the SDK stays a dependency of the
  application. The repository tests the setups against pino 10 and the event
  builder of `@sentry/core`. Do not add Sentry's `extraErrorDataIntegration`:
  it copies the own fields of the error without the policy.

## Redaction

Redaction is a sticky policy on the error. It applies to `toLogObject()`,
`toJSON()` and therefore to `JSON.stringify(err)`.

| Method | Effect |
| --- | --- |
| `redact(keys, { mask? })` | deny-list: mask the named keys at any depth |
| `redactAllow(keys, { mask? })` | allow-list: mask every data leaf except the named keys; the stricter choice |
| `redactWith(fn)` | a trusted, synchronous transform of the whole log record |
| catalog `redaction: { mode, keys }` | a floor: the same deny or allow policy for every instance of a code, which a per-instance call cannot relax |

```ts
const failure = AccountErrors.create.PROFILE_UPDATE_FAILED("update failed", {
  details: { userId, email, taxId },
}).redact(["email", "taxId"]);
```

- A catalog `redaction` policy is a floor. The log applies the per-instance
  policy first and the catalog policy after it, so a per-instance call can add
  masking but never remove it. On a code that denies `password`,
  `.redact(["email"])` masks both. To log a field that the catalog masks,
  change the definition, or build the error outside the catalog.
- Among per-instance calls, the last one wins. `redact`, `redactAllow` and
  `redactWith` replace the per-instance policy that the error had, and a
  second `redact` call replaces the first. To extend a per-instance policy,
  list every key in one call: `.redact(["email", "taxId", "iban"])`.
- The policy travels with the error. As a `cause`, its node is masked by its
  own policy first, then by the outer error's policy.
- Redaction selects keys, not values. To hide the time, deny both `timestamp`
  and `timestampIso`.
- `err.stack` shows the raw message. `console.log(err)` and `util.inspect`
  print the error itself, not the log object. That output holds every own
  field with its raw value, the cause and the members of an aggregate. Never
  pass a redacted error to `console.log`; log `logObjectOf(err)` instead.
- Interpolating the error into a string uses `toString()`. It masks the denied
  message of each error by that error's own policy only, so the message of a
  cause can stay raw.
- `redactWith` output is trusted as returned. Without a catalog policy, the
  library does not mask or validate it again. With a catalog policy, the log
  copies the output as log data and the catalog policy masks the copy; a
  `Date` becomes its ISO string.
- The floor masks by key, as every built-in policy does. A `redactWith`
  callback can copy a masked value under another key, and the floor then
  judges that key. A callback must not move a secret to a key that the floor
  does not mask.

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
