# Why safe by default

Leaking an internal exception message, stack trace or database detail into an
API response is a recognized vulnerability ([CWE-209: Information Exposure
Through an Error Message](https://cwe.mitre.org/data/definitions/209.html)). In
regulated and enterprise contexts it is frequently a compliance finding.

This library treats the boundary of your application the way DDD treats the
boundary of a bounded context: what crosses it is a deliberate, **published**
representation, never the internal model by accident.

## Safe by default means: the core has no client path

The core (`@shirudo/base-error`) is purely technical. There is **no public
serializer** on a `BaseError` or `StructuredError`. That is the guarantee:

- The stable `code` is the contract. It is for logs, control flow and tests.
- The technical `message`, `details`, `cause` and `stack` live only in
  `toLogObject()` / `toJSON()`, which are **internal** full-fidelity log output.
- Client-facing output is produced **exclusively** by the
  [public-error pipeline](./public-error), through an explicit allowlist: a public
  code, a resolved localized message, and any fields you deliberately project.

Because the core exposes nothing client-facing, there is no override flag to
audit and no accidental-leak call site to find. To send anything to a client you
must reach for the presenter, and the presenter only emits what you registered.

```ts
const err = new StructuredError({
  code: "DB_UNIQUE_VIOLATION",
  category: "INFRASTRUCTURE",
  retryable: false,
  message: "duplicate key value violates unique constraint users_email_key",
});

// Internal, full-fidelity. Goes to your logger, never to a client.
logger.error(err.toLogObject());

// Client-facing. Only what the registry maps and the definition projects.
const view = presenter.present(err, { locales: ["en"] });
// { code: "INTERNAL_ERROR", message: "Something went wrong...", locale: "en" }
```

An unmapped error degrades to the presenter's generic localized fallback. The
technical message is never reached on the public path.

## Exposing things is always explicit

When you _do_ want to surface information, you say so by name in a
[`PublicErrorDescriptor`](./public-error):

- `publicCode`: the deliberate, client-safe code (distinct from the technical
  `code`).
- `userMessages`: the client-safe localized text, as a `LocalizedMessageSet`.
- `projectDetails`: the only way `details` reach the public view, as a
  reviewable, typed projection. The raw error is never spread.

## Redaction scrubs the log path

The log path is the one that carries the full technical truth, so that is where
redaction applies. `redact` / `redactAllow` configure a **sticky** mask on the
error so even an auto-serialize (`JSON.stringify(error)` that a logger does) is
scrubbed. See [Observability & logging](./observability).

## "But I need the full error for Sentry"

You do, and you get it on the log path: `toLogObject()` keeps the full,
(optionally redacted) error. The client path is a separate concern handled by the
presenter. See [Observability & logging](./observability).
