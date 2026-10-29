# Observability & logging

The strictness of the client-facing path exists _because_ there is a separate,
full-fidelity path for your backend. Logs, Sentry and APM should see everything;
clients should not. The core carries only this log path; the client path is the
[public-error pipeline](./public-error), kept apart so you never have to choose.

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
`category`, `retryable` and `details`.

`toJSON()` is an alias, so `JSON.stringify(error)` produces the same log-grade
output.

Every `details` in the log object is copied as data: the `details` of the error
itself, the `details` of each cause, and any other field that a
`StructuredError` cause carries. The copy is JSON-safe and decoupled from the
error. A `Date` becomes its ISO string, a bigint its decimal string, and a cycle
a `[Circular …]` marker. An unreadable value or a throwing `toJSON` becomes
`[Unserializable value]`. A later mutation of an error does not change a log
object already built, and `error.details` keeps its original value in the
process.

The error writes its cause chain before its own `details`, so oversized details
cannot cut the chain that explains the failure. Details beyond the log budget of
100,000 nodes become `[Max log size exceeded]`.

### Aggregate causes

When a cause carries an `errors` array (a native `AggregateError` from
`Promise.any` or from a dual-stack connect failure, or your own fan-out error
with the same shape), its members are serialized too:

```ts
// fetch() to an unreachable dual-stack host, on Node 20+:
//   TypeError: fetch failed
//     cause: AggregateError (ECONNREFUSED)
//       errors: [Error ECONNREFUSED ::1, Error ECONNREFUSED 127.0.0.1]

logger.error(error.toLogObject());
// cause: {
//   name: "AggregateError",
//   message: "",
//   stack: "...",
//   errors: [ { name: "Error", message: "connect ECONNREFUSED ::1", ... }, ... ]
// }
```

This matters because `errors` is a **non-enumerable** own property on every
runtime, exactly like `message` and `stack`: `JSON.stringify(aggregateError)`
returns `{}`, so a logger that stringifies the raw error loses every branch
failure. The members are read by shape, not by `instanceof AggregateError`, so
cross-realm and custom aggregates serialize the same way.

Each aggregate node is capped at 100 members (the remainder collapses to a
`"[100 more aggregated errors]"` marker), shares the chain's depth cap of 100,
and is cycle-safe. An error that is its own ancestor ends in `[Circular cause
chain]`. An error that the same walk already wrote, for example the same
upstream failure in two branches, ends in `[Shared cause]`. The marker does
not repeat the subtree. If the depth cap or a cause policy cut the first
occurrence, the later occurrence does not restore it. The log walks the
`cause` and the `errors` of the root separately, so an error in both appears
there twice. `toString()` renders the whole tree in one walk with the same two
markers. It also marks a repeated plain-object cause, which the log copies as
data at each occurrence.

`toString()` counts the members on the aggregate's line and renders each one
indented below it, so the one-line render shows the shape of the failure too.

The [cause-chain helpers](./cause-chains) stay linear by default. Pass
`{ aggregates: true }` when a retry decision has to see inside an aggregate.

### Your own aggregate: `StructuredAggregateError`

For a fan-out of your own (a `Promise.allSettled` batch, a job runner, saga
compensation), `StructuredAggregateError` is a `StructuredError` that carries
its members in the same `errors` field:

```ts
throw new StructuredAggregateError({
  code: "BATCH_FAILED",
  category: "INTERNAL",
  retryable: failures.every(isRetryable),
  message: `${failures.length} of ${items.length} items failed`,
  errors: failures,
});
```

Everything above then applies to it unchanged: the members are serialized and
width-capped, redaction reaches into them, `toString()` counts them, `fromJSON`
restores them, and `{ aggregates: true }` walks them. An error-shaped member
keeps its structural envelope under an allow-list; a member that is not an
error (a `Promise.allSettled` reason can be any value) is data, and is masked
like any other leaf. It does not extend
`AggregateError` (single inheritance is spent on `BaseError`), which costs
nothing, because the whole library reads aggregates by shape.

## Any thrown value: `logObjectOf()`

A `catch` block receives `unknown`. The value can be an error of this library,
a native `Error` from a dependency, or a value that is not an error at all.
`logObjectOf(value)` returns the log form of each of them, so one call covers
every case:

```ts
import { logObjectOf } from "@shirudo/base-error";

try {
  await handleRequest(request);
} catch (error) {
  logger.error({ err: logObjectOf(error) }, "request failed");
}
```

| Value             | Result                                                                                  |
| ----------------- | --------------------------------------------------------------------------------------- |
| a `BaseError`     | its `toLogObject()`, with its redaction policy                                          |
| any other `Error` | the node that a `BaseError` writes for it as its cause: name, message, stack and causes |
| any other value   | a copy of log data, or the value itself for a primitive                                 |

A native `Error` keeps its own `name` and `message`. The function does not wrap
it in a `StructuredError`, so no `UNKNOWN_ERROR` code appears. The node also
holds the `code`, `category`, `retryable` and `details` of a foreign error that
carries them, and the members of an aggregate. A `BaseError` in the cause chain
keeps its redaction policy.

The function does not throw, and its work stays bounded, whatever the value
holds. It writes a foreign error from its fields, so a `toLogObject` or
`toJSON` on that error does not run. As a result, a `BaseError` from another
realm (a worker, a second copy of this package) logs as a foreign error without
a policy, as it does in a cause chain. If your dependency tree holds two copies
of this package, deduplicate it.

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

  // 2. Safe projection → client (public-error pipeline)
  const view = project(catalog, error);
  return Response.json(view, { status: 409 });
}
```

The log carries the constraint name and cause chain; the HTTP response carries
only the public code and a safe localized message produced by the
[public-error pipeline](./public-error). Same error, two audiences, no leak.

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

The policy travels with the error. When another error carries it as `cause`
(or as a member of an aggregate), the cause node in the outer log object is
masked by the cause's own policy first, over the node and everything beneath
it, and the outer error's policy runs over the whole log object afterwards.
This holds for errors of the same realm only. An error that crossed a worker
boundary, or one that came from a second copy of the package, logs as a foreign
error without a policy.

A cause policy masks the positions beneath its own error. The log writes an
error that two branches share at its first position only, and the later
position reads `[Shared cause]`. The order of the members decides which
position comes first:

- If the branch with the policy comes first, the shared error appears masked,
  and the other branch shows the marker.
- If a branch without a policy comes first, the shared error appears there
  unmasked. The policy of the other branch does not reach it.

To mask a value at every position, give the policy to the error that carries
the value, or to the root error.

`StructuredError` initializes `name` from `code`, so both fields contain the same value.
Redaction selects keys, not matching values. Denying `name` masks its stack header,
but leaves `code` unchanged. Denying `code` alone leaves `name` and its stack header unchanged.
This also applies when the error appears as a cause.

The log states the time in two keys, `timestamp` and `timestampIso`. To hide
the time, deny both. Denying one key masks that key only.

```ts
const error = new StructuredError({
  code: "TENANT_9931_SECRET", // Deliberately sensitive code for this example.
  category: "INTERNAL",
  retryable: false,
  message: "Request failed",
}).redact(["name"]);

const log = error.toLogObject();
log.name; // "[REDACTED]"
log.code; // "TENANT_9931_SECRET" remains in the log.

error.redact(["name", "code"]).toLogObject().code; // "[REDACTED]"
```

Use stable, non-sensitive codes such as `REQUEST_FAILED`.
Keep tenant identifiers and other sensitive values in `details`, where a policy can mask them.
If an existing code contains sensitive data, deny both `name` and `code` to mask both copies.
Masking `code` can break log-based matching and alerts that depend on its original value.

The mask is configurable: a string, or a **function** of `(value, key)` for
partial masking or type preservation:

```ts
err.redact(["card"], { mask: (v) => "****" + String(v).slice(-4) }); // ****6789
err.redact(["age"], { mask: () => 0 }); // keep the type
```

For the common "show _which_ secret it was without exposing it" case, use the
built-in `partialMask`, which reveals a prefix/suffix and masks the rest, and
**fully** masks values too short to reveal safely (and non-strings). An invalid
`keepStart` or `keepEnd` (negative, `NaN`, infinite, or not an integer) makes
the mask fully mask every value:

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
A leaf inside an **array** has no key of its own, so it is judged under the key
of the array that holds it: `details.tokens: ["a", "b"]` is masked element by
element unless `"tokens"` is allowed. The policy walks the log object, which the
log build copied within its bounds: data nesting stops at 100 levels with an
empty container, the cause spine stops at 100 hops (a `cause` object or an
aggregate member each count one; a list on the spine is free, its members pay),
and a cycle is a `[Circular …]` marker at its first repeat. Under an allow-list
that marker is data and reads `[REDACTED]`. An `errors` value that is not a list
is data, bounded by the data depth.
The top-level envelope (`message`/`code`/…) is untouched, and a cause keeps its
structural envelope (`name`/`message`/`stack`/`code`/`category`/`retryable`).
The top-level `cause` and `details` are links, not envelope fields. A primitive
under them is data and is masked: a thrown string as the cause of the logged
error, or a string as its `details`. The `cause` slot keeps only a marker of the
serializer, or an absent or `null` cause;
but **any other field on a cause is data** and is masked, so a plain object that
merely _resembles_ a structured error can't smuggle siblings through. The
envelope fields are primitives: an **object or array under an envelope name**
(`stack: { message: "…" }`, `code: { … }`) is data too, at the top level and on
a cause, so a leaf inside it is masked whatever it is called. The
classification is by position, not by shape. (The
technical `message` is structural here; scrub free text in it with `redactWith`.)

### Serializer markers on the cause spine

The serializer writes a marker where it refused to expand a cause, for example
`[Circular cause chain]` or `[100 more aggregated errors]`. `redactAllow` keeps
such a marker readable in two places only: in a `cause` slot, and as a member
of an `errors` list. It recognizes a marker by its value.

```ts
new BaseError("outer", {
  cause: "[Unserializable cause]",
  errors: ["[2 more aggregated errors]"],
  note: "[Shared cause]",
  secret: "S",
}).redactAllow([]).toLogObject().cause;
// {
//   cause: "[Unserializable cause]",
//   errors: ["[2 more aggregated errors]"],
//   note: "[REDACTED]",
//   secret: "[REDACTED]",
// }
```

A string of your own that equals a marker therefore stays readable in those two
places. It carries the marker text only, and in `[N more aggregated errors]` a
number. Everywhere else, in `details`, in own log fields, and under any other
key of a cause, a marker string is data and the policy masks it. A deny-list
masks a denied key whatever it holds.

### Custom redactor contract

Key-based redaction cannot identify sensitive fragments inside free text.
`redactWith` accepts a **trusted, synchronous transformation** of the complete log record.
The consumer can adapt a dedicated redaction library through this callback.
The callback owns the shape, JSON safety, and sensitive content of its output.

```ts
// An explicit projection can discard all technical fields.
err.redactWith(() => ({ message: "Request failed" }));
```

The callback can mutate its input or return another record, including `{}`.
For the error that you log, its return value passes through without validation, copying, freezing, or another implicit redaction policy.
The TypeScript signature requires a record and rejects promises.
It does not prove that the record is safe for JSON or contains no secrets.
Cycles, bigint values, getters, and `toJSON` callbacks can still make later JSON serialization throw.

Policy registration is last-wins.
`err.redactAllow([]).redactWith(fn)` replaces the allow-list instead of composing with it.
A successful callback can replace `code`, change `retryable`, or reintroduce sensitive data.
When the error is the cause of another error, the log copies the custom output with the
log-data copier, and the policy of the enclosing error walks that copy. The copy follows
the rules of `details`: a `Date` becomes its ISO string, a cycle becomes a `[Circular …]`
marker, and output beyond the remaining log budget turns the `cause` slot into
`[Max log size exceeded]`.

The input of the callback is the log object, which holds copies only.
Callback mutations cannot reach the error, even if the callback subsequently throws.

If the callback throws, recovery uses diagnostic fields captured **before** invocation.
It retains readable own `name`, `code`, `category`, `retryable`, `timestamp`, and `timestampIso` values with their expected primitive types.
Numeric `code` and `timestamp` values must be finite.
The failure record adds `message: "[log redaction failed]"` and omits payload, stack, and links.
Callback mutations cannot replace those captured values.
Original structural strings remain consumer data and must contain no secrets.

Custom changes to `message` do not automatically scrub stack headers or nested causes.
The callback does not affect `toString()`, `err.stack`, or runtime inspection.
Explicit public logging calls inside the callback start independent builds.
The consumer must bound those calls and terminate synchronously.
The library cannot interrupt arbitrary callback work or contain later exceptions from returned getters.

### Notes

- **Log object only, not every string render**: redaction rewrites
  `toLogObject()` / `toJSON()`. A deny-listed `"name"` or `"message"` is also masked in
  the `stack` field of the root, each cause, and each aggregate member: a header that repeats
  the node's own `name: message` uses the already-masked fields and keeps its frames,
  and a stack that does not start with that header is masked as a whole.
  The header uses each field's mask result without calling the mask again.
  If a result cannot convert to text, the stack becomes `"[REDACTED]"`.
  `toString()` honors message masking too. The `err.stack` property (whose header carries
  the raw message) and Node's `console.log(err)` inspection (which prints
  that property) stay unredacted. When redaction matters, log errors through
  a structured serializer that hits `toJSON` (`logger.error({ err })`), never
  via string interpolation.
- **Log path only**: the client path (the [public-error pipeline](./public-error)) emits
  only an explicit allowlist, so it is already safe by default.
- **Defense-in-depth at the source**, not a replacement for logger-level
  redaction (pino `redact`, winston formatters); for blanket app-wide policy,
  prefer the logger.
- **Fail-closed invocation**: a synchronous redactor exception returns the
  captured diagnostic fields and a `[log redaction failed]` message.
  A built-in deny-list also excludes explicitly denied diagnostic fields from recovery.
  The library does not call the failed mask again.
  Undenied typed fields, including `retryable: false`, retain their values.
  Payload, stack, and links are omitted. Successful custom output follows the
  [custom redactor contract](#custom-redactor-contract).

## pino

Pino has a standard serializer for the `err` key that reads the error object
itself, so a redaction policy does not hold there. The subpath
`@shirudo/base-error/pino` writes every value under `err` through
`logObjectOf()`. [Logging with pino](./logging-with-pino) shows the setup.

## Sentry

Sentry reads the error object itself, so a redaction policy does not hold in
the exceptions of the event. The subpath `@shirudo/base-error/sentry` writes
the exceptions of every event through `logObjectOf()`.
[Reporting to Sentry](./reporting-to-sentry) shows the setup.

## Other reporters

A reporter that reads the error object itself bypasses the redaction policy.
Give it the log object from `logObjectOf(error)` instead of the error.

## Reconstructing: `StructuredError.fromJSON`

`fromJSON` is the inverse of `toJSON`: it rebuilds a typed `StructuredError`
(restoring `code`/`category`/`retryable`/`details`, the cause chain with the
`stack` of each node, and the original `timestamp` of the root) from the
serialized shape.

```ts
const err = StructuredError.fromJSON(payload); // payload: unknown
matchError(err, { PARSE_FAILED: () => retry(), _: (e) => report(e) });
```

It is for reconstruction **within one trust/bounded-context boundary**:

- **Worker / `postMessage` / iframe**: `instanceof` is lost across
  `structuredClone`; `fromJSON` restores the typed error. `structuredClone` also
  **drops an `AggregateError`'s members** and degrades the class to a plain
  `Error` (measured on Node, Bun, Deno and workerd), so for aggregates this
  round-trip is the only lossless way across the boundary.
- **Job queues / durable storage**: reconstruct an error parked by the same
  system.
- **Log replay / forensics**: parse a logged error JSON back into an object.

It is lenient (malformed input → a safe `UNKNOWN_ERROR` envelope, never throws)
and prototype-pollution-safe (whitelisted fields only). It restores the cause
chain with the `stack` of each node, and the original `timestamp` of the root.
The log writes no time for a cause, so a nested cause carries the time of the
reconstruction, not the time at which it was thrown. It reconstructs a
`StructuredError` only (`code`, `category`, `retryable`, `details`); there are no
user/localized messages to restore (those are not part of the error model).

An aggregate cause comes back as a real `AggregateError` with its members
reconstructed; a structured error that carried its own `errors` keeps them as a
non-enumerable property, the way a native aggregate holds them. A cause without
the full structured shape comes back as a plain `Error` or `AggregateError`.
It keeps each of `code`, `category`, `retryable` and `details` that the log
carried. `hasErrorCode` and `someChainRetryable` read those fields by shape, as
before the round trip.

The walk is bounded like every other walker in this library: 100 cause hops
deep, 100 members per aggregate, and 10,000 reconstructed errors in total. The
total is small, because every reconstructed error captures a stack. Past the
total, a `cause` drops and the remaining members of an aggregate collapse into
the `[N more aggregated errors]` marker.

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
