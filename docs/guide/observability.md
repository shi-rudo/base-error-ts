# Observability & logging

The strictness of the client-facing path exists *because* there is a separate,
full-fidelity path for your backend. Logs, Sentry and APM should see everything;
clients should not. The library keeps these apart so you never have to choose.

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
chain**, timestamps, any user/localized messages, and — for
[`StructuredError`](./structured-error) — `code`, `category`, `retryable` and
raw `details`.

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
    publicCode: "EMAIL_ALREADY_REGISTERED",
    publicMessage: "That email address is already in use.",
    cause,
  });

  // 1. Full truth → observability
  logger.error(error.toLogObject());

  // 2. Safe projection → client
  return Response.json(error.toProblemDetails({ status: 409 }), { status: 409 });
}
```

The log carries the constraint name and cause chain; the HTTP response carries
only `EMAIL_ALREADY_REGISTERED` and a safe message. Same error, two audiences,
no leak.

## Redacting PII from logs

In regulated contexts the logs themselves must scrub PII — `details.ssn`
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
JSON.stringify(err);       // also masked
```

The mask is configurable — a string, or a **function** of `(value, key)` for
partial masking or type preservation:

```ts
err.redact(["card"], { mask: (v) => "****" + String(v).slice(-4) }); // ****6789
err.redact(["age"], { mask: () => 0 });                              // keep the type
```

### Allow-list (higher assurance)

A deny-list is the conventional choice (it matches pino's `redact`), but you
can't enumerate every PII field — a newly-added `details.passportNumber` would
leak. For high-sensitivity data use `redactAllow`, which masks every `details`
leaf **except** the listed ones, so new fields leak nothing by default:

```ts
err.redactAllow(["userId", "requestId"]); // only these detail leaves survive
```

It operates on leaf field names within `details` (and nested cause details);
the envelope (`message`/`code`/…) is untouched.

### What key redaction can't do

Key-based redaction masks the **value at a key** — it cannot catch PII embedded
in free text, e.g. inside the technical `message` (`"user a@b.com not found"`)
or a string detail value. For those, use the function form:

```ts
err.redactWith((log) => ({ ...log, message: scrub(log.message as string) }));
```

`redactWith` is also the composition seam for a **dedicated redaction library**
when you need patterns, wildcards or regex-based PII detection — this library
intentionally stays minimal and delegates that power:

```ts
import { redact as deepRedact } from "@visulima/redact";

err.redactWith((log) => deepRedact(log, ["password", "*.email", "ssn"]));
```

### Notes

- **Log path only** — the client serializers are already safe by default.
- **Defense-in-depth at the source**, not a replacement for logger-level
  redaction (pino `redact`, winston formatters); for blanket app-wide policy,
  prefer the logger.
- **Fail-closed**: if a redactor throws, `toLogObject()` does not crash the
  logging path and does not emit the unredacted payload — it returns a safe
  `{ name, message: "[log redaction failed]" }` marker instead.

## Sentry / OpenTelemetry

Pass `toLogObject()` (or the error itself) to your reporter. Because the cause
chain is serialized, nested root causes survive the trip:

```ts
Sentry.captureException(error, { extra: error.toLogObject() });
```

## Reconstructing — `StructuredError.fromJSON`

`fromJSON` is the inverse of `toJSON`: it rebuilds a typed `StructuredError`
(restoring `code`/`category`/`retryable`/`details`, the original
`stack`/`timestamp`, and the cause chain) from the serialized shape.

```ts
const err = StructuredError.fromJSON(payload); // payload: unknown
matchError(err, { PARSE_FAILED: () => retry(), _: (e) => report(e) });
```

It is for reconstruction **within one trust/bounded-context boundary**:

- **Worker / `postMessage` / iframe** — `instanceof` is lost across
  `structuredClone`; `fromJSON` restores the typed error.
- **Job queues / durable storage** — reconstruct an error parked by the same
  system.
- **Log replay / forensics** — parse a logged error JSON back into an object.

It is lenient (malformed input → a safe `UNKNOWN_ERROR` envelope, never throws)
and prototype-pollution-safe (whitelisted fields only).

::: warning Across services, translate — don't trust
`fromJSON` rebuilds *shape*, not authority: whoever produced the payload can
forge `code`/`retryable`. Don't use reconstructed fields for authorization, and
don't `matchError` on another service's codes as if they were yours —
reconstruct, then translate through an Anti-Corruption Layer into your own
model. The inter-service contract should be a safe projection (Problem Details /
a versioned DTO), not the log shape.
:::
