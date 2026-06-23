# Observability & logging

The strictness of the client-facing path exists _because_ there is a separate,
full-fidelity path for your backend. Logs, Sentry and APM should see everything;
clients should not. The core carries only this log path; the client path is the
[presentation layer](./presentation), kept apart so you never have to choose.

## `toLogObject()`

`toLogObject()` returns the complete, unredacted error:

```ts
logger.error(error.toLogObject());
// {
//   name: "DB_UNIQUE_VIOLATION",
//   message: "duplicate key value violates unique constraint users_email_key",
//   timestamp: 1748505600000,
//   timestampIso: "2026-05-29T...",
//   stack: "...",
//   cause: { /* full nested cause chain */ },
//   code: "DB_UNIQUE_VIOLATION",
//   category: "INFRASTRUCTURE",
//   retryable: false,
//   details: { table: "users", constraint: "users_email_key" }
// }
```

It includes the technical `message`, `stack`, the **full serialized cause
chain**, timestamps, and (for [`StructuredError`](./structured-error)) `code`,
`category`, `retryable` and raw `details`.

`toJSON()` is an alias, so `JSON.stringify(error)` produces the same log-grade
output.

## The two paths, side by side

```ts
try {
  await db.insertUser(user);
} catch (cause) {
  const error = new StructuredError({
    code: "DB_UNIQUE_VIOLATION",
    category: "INFRASTRUCTURE",
    retryable: false,
    message: "duplicate key value violates unique constraint users_email_key",
    details: { table: "users", constraint: "users_email_key" },
    cause,
  });

  // 1. Full truth → observability
  logger.error(error.toLogObject());

  // 2. Safe projection → client (presentation layer)
  const view = presenter.present(error, { locales: ["en"] });
  return Response.json(view, { status: 409 });
}
```

The log carries the constraint name and cause chain; the HTTP response carries
only the public code and a safe localized message produced by the
[presenter](./presentation). Same error, two audiences, no leak.

## Redacting PII from logs

In regulated contexts the logs themselves must scrub PII; `details.ssn`
shouldn't reach the sink in plaintext. `redact` configures a **sticky**
deny-list on the error, so even the auto-serialize path (`JSON.stringify(error)`
that a logger does) is masked:

```ts
const err = new StructuredError({
  code: "USER_UPDATE_FAILED",
  category: "PERSISTENCE",
  retryable: false,
  message: "update failed",
  details: { userId: "1", email: "a@b.com", ssn: "123-45-6789" },
}).redact(["email", "ssn"]); // deep; default mask "[REDACTED]"

err.toLogObject().details; // { userId: "1", email: "[REDACTED]", ssn: "[REDACTED]" }
JSON.stringify(err); // also masked
```

The mask is configurable: a string, or a **function** of `(value, key)` for
partial masking or type preservation:

```ts
err.redact(["card"], { mask: (v) => "****" + String(v).slice(-4) }); // ****6789
err.redact(["age"], { mask: () => 0 }); // keep the type
```

For the common "show _which_ secret it was without exposing it" case, use the
built-in `partialMask`, which reveals a prefix/suffix and masks the rest, and
**fully** masks values too short to reveal safely (and non-strings):

```ts
import { partialMask } from "@shirudo/base-error";

err.redact(["apiKey"], { mask: partialMask({ keepStart: 7, keepEnd: 4 }) });
// "sk_live_0123456789AbCd" -> "sk_live…AbCd"
```

### Allow-list (higher assurance)

A deny-list is the conventional choice (it matches pino's `redact`), but you
can't enumerate every PII field; a newly-added `details.passportNumber` would
leak. For high-sensitivity data use `redactAllow`, which masks every `details`
leaf **except** the listed ones, so new fields leak nothing by default:

```ts
err.redactAllow(["userId", "requestId"]); // only these detail leaves survive
```

It masks every leaf inside any **data** region (a `details` subtree at any
depth, and a cause's data fields), so data can't slip through wherever it sits.
The walk is depth-capped at 100: nesting beyond that collapses to a
`[Max redaction depth exceeded]` marker (so it stays fail-safe and never
overflows the stack, including on small edge-runtime stacks) rather than leaking.
The top-level envelope (`message`/`code`/…) is untouched, and a cause keeps its
structural envelope (`name`/`message`/`stack`/`code`/`category`/`retryable`);
but **any other field on a cause is data** and is masked, so a plain object that
merely _resembles_ a structured error can't smuggle siblings through. The
classification is by position, not by shape, so there is nothing to spoof. (The
technical `message` is structural here; scrub free text in it with `redactWith`.)

### What key redaction can't do

Key-based redaction masks the **value at a key**; it cannot catch PII embedded
in free text, e.g. inside the technical `message` (`"user a@b.com not found"`)
or a string detail value. For those, use the function form:

```ts
err.redactWith((log) => ({ ...log, message: scrub(log.message as string) }));
```

`redactWith` is also the composition seam for a **dedicated redaction library**
when you need patterns, wildcards or regex-based PII detection. This library
intentionally stays minimal and delegates that power:

```ts
import { redact as deepRedact } from "@visulima/redact";

err.redactWith((log) => deepRedact(log, ["password", "*.email", "ssn"]));
```

### Notes

- **Log path only**: the client path (the [presenter](./presentation)) emits
  only an explicit allowlist, so it is already safe by default.
- **Defense-in-depth at the source**, not a replacement for logger-level
  redaction (pino `redact`, winston formatters); for blanket app-wide policy,
  prefer the logger.
- **Fail-closed**: if a redactor throws, `toLogObject()` does not crash the
  logging path and does not emit the unredacted payload. It keeps only the
  non-sensitive structural fields (`name`/`code`/`category`/`retryable`/
  timestamps) plus a `[log redaction failed]` marker.

## Sentry / OpenTelemetry

Pass `toLogObject()` (or the error itself) to your reporter. Because the cause
chain is serialized, nested root causes survive the trip:

```ts
Sentry.captureException(error, { extra: error.toLogObject() });
```

## Reconstructing: `StructuredError.fromJSON`

`fromJSON` is the inverse of `toJSON`: it rebuilds a typed `StructuredError`
(restoring `code`/`category`/`retryable`/`details`, the original
`stack`/`timestamp`, and the cause chain) from the serialized shape.

```ts
const err = StructuredError.fromJSON(payload); // payload: unknown
matchError(err, { PARSE_FAILED: () => retry(), _: (e) => report(e) });
```

It is for reconstruction **within one trust/bounded-context boundary**:

- **Worker / `postMessage` / iframe**: `instanceof` is lost across
  `structuredClone`; `fromJSON` restores the typed error.
- **Job queues / durable storage**: reconstruct an error parked by the same
  system.
- **Log replay / forensics**: parse a logged error JSON back into an object.

It is lenient (malformed input → a safe `UNKNOWN_ERROR` envelope, never throws)
and prototype-pollution-safe (whitelisted fields only). It restores the cause
chain and the original `stack`/`timestamp`. It reconstructs a
`StructuredError` only (`code`, `category`, `retryable`, `details`); there are no
user/localized messages to restore (those are not part of the error model).

It always returns a base `StructuredError`; **subclass identity is not
restored**. A `ValidationError` round-trips to a `StructuredError` (losing
`publicIssues()`/`addIssue()`; the raw `details.issues` survive as data). Narrow
on `code`, not on `_tag`/`instanceof`.

::: warning Across services, translate. Don't trust
`fromJSON` rebuilds _shape_, not authority: whoever produced the payload can
forge `code`/`retryable`. Don't use reconstructed fields for authorization, and
don't `matchError` on another service's codes as if they were yours.
Reconstruct, then translate through an Anti-Corruption Layer into your own
model. The inter-service contract should be a safe projection (a versioned DTO),
not the log shape.
:::
