# Proposal 0003 — `fromJSON` wire reconstruction

**Status:** Draft / for discussion — no implementation yet.
**Context:** `toLogObject()` / `toJSON()` serialize a (structured) error,
including the full cause chain. There is no inverse: code that receives that
JSON can only duck-type it (`isStructuredError`), and `instanceof` does not
survive `structuredClone`/`postMessage`/storage. `fromJSON` is the inverse of
`toJSON` — it rebuilds a typed `StructuredError` from the **log/serialization
shape** so it can be handled, logged, and `matchError`'d again.

`fromJSON` is **not** an inter-service integration contract (see *Positioning*).
Zero-dependency; no dependency on `@shirudo/result`.

## Positioning — where this belongs (and where it doesn't)

`toJSON`/`toLogObject` is the **full observability payload** (stack, technical
message, raw `details`). `fromJSON` reconstructs *that* shape, so its honest home
is reconstruction **within a single trust/bounded-context boundary**:

- **Same-context runtime boundaries** — Web Worker / `postMessage` / iframe /
  child process. `instanceof` is lost across `structuredClone`; `fromJSON`
  restores the typed error. ✓
- **Job queues / durable storage** — an error serialized into a queue or DB,
  reconstructed by a worker in the **same system**. ✓
- **Log replay / forensics** — parse a logged error back into a `StructuredError`
  for tooling. The log shape is exactly right here, and the input is trusted. ✓

**Not** a transparent cross-service propagation mechanism. Two DDD/enterprise
cautions:

1. **Bounded-context coupling.** Another service's `code`s belong to *its*
   ubiquitous language. Do not `matchError` on an upstream's codes as if they
   were yours — reconstruct, then **translate through an Anti-Corruption Layer**
   into your own error model.
2. **The log shape is not a published contract.** Shipping stacks / technical
   messages / raw `details` across a service boundary is a leak and version
   coupling. The inter-service error contract should be a deliberate, safe
   projection (Problem Details / a versioned error DTO), not the log object.

Use `fromJSON` freely inside one context; across services, put an ACL in front.

---

## API

```ts
StructuredError.fromJSON(json: unknown): StructuredError<string, string>;
```

A single static entry on `StructuredError` (the workhorse superset). It is the
inverse of `toJSON()`:

```ts
// Same-context boundary: a worker posts a serialized error back to the main
// thread (instanceof was lost crossing structuredClone).
worker.onmessage = (e) => {
  const err = StructuredError.fromJSON(e.data.error);
  matchError(err, {
    PARSE_FAILED: () => showParseError(),
    _: (x) => report(x),
  });
};
```

Across services, reconstruct then **translate through an ACL** — never match on
the upstream's codes directly:

```ts
const upstream = StructuredError.fromJSON(received); // reconstruct shape (for logs)
logger.warn(upstream.toLogObject());
throw toMyDomainError(upstream); // translate into THIS context's model
```

Round-trip guarantee: `StructuredError.fromJSON(e.toJSON())` reproduces an
equivalent error — `code`, `category`, `retryable`, `details`, `message`,
`name`, the cause chain, and the **original** `stack`/`timestamp`.

## Behavior

- **Lenient.** Missing structured fields fall back to safe defaults
  (`code "UNKNOWN_ERROR"`, `category "INTERNAL"`, `retryable false`) — the same
  envelope philosophy as `toStructuredError`. A non-object/garbage payload
  yields that envelope with a generic message rather than throwing.
- **Original identity preserved.** `stack` and `timestamp`/`timestampIso` are
  taken from the payload (a reconstruction represents the original failure, not
  a new one), not regenerated.
- **Cause chain rebuilt recursively.** Each serialized cause becomes a
  reconstructed error: structured shape → nested `StructuredError`; plain
  error shape (`name`/`message`/`stack`) → a basic error; primitive → kept
  as-is. Depth/cycle guarded.

## Security (the part that matters for a base library)

Even within one system, reconstruction runs on data that crossed a boundary —
treat it as **untrusted input**:

1. **Whitelist only.** Copy only known fields (`name`, `message`, `code`,
   `category`, `retryable`, `details`, `timestamp`, `timestampIso`, `stack`,
   `cause`). Never assign arbitrary payload keys onto the instance, and never
   touch `__proto__` / `constructor` / `prototype` — no prototype pollution.
2. **`details` is data, not code.** It is copied as an opaque value; we never
   `eval`/instantiate from it.
3. **Don't trust reconstructed fields for authorization.** An attacker who can
   forge the payload can claim any `code`/`retryable`. Document loudly: use
   `fromJSON` to reconstruct *shape* for handling/logging, not as an authority
   on identity or trust. For untrusted boundaries, validate against an expected
   `code` set.
4. **No leak amplification.** `fromJSON` reconstructs; it does not change the
   safe-by-default projection. A reconstructed error's `toProblemDetails()` is
   still safe by default.

## Open questions / decisions to confirm

1. **Single entry vs two.** Proposed: only `StructuredError.fromJSON` (returns a
   `StructuredError`, filling defaults for plain-error payloads). Add
   `BaseError.fromJSON` only if a non-structured reconstruction is wanted —
   reconstructing a pure `BaseError` payload as a `StructuredError` (with default
   code) is a slight type asymmetry but ergonomically simpler.
2. **Naming.** `fromJSON` (mirrors `toJSON`) vs a standalone `deserializeError`.
   Proposed `StructuredError.fromJSON`.
3. **Malformed input.** Lenient envelope (proposed) vs throwing. Lenient matches
   the library's boundary philosophy.
4. **Seeding readonly `stack`/`timestamp`.** Implementation detail: a private
   rehydration path (or `Object.defineProperty`) sets these from the payload
   after construction, since the public constructor generates fresh ones.
5. **Versioning.** No `version` field is proposed; the lenient field-by-field
   reconstruction tolerates added/missing fields, which covers same-context
   evolution. A versioned schema is the *consumer's* concern at a real
   cross-service contract (where the safe projection, not `fromJSON`, applies).
6. **Result-returning variant?** Given `@shirudo/result`, a
   `Result<StructuredError, …>` parse would be more honest than the lenient
   envelope for genuinely-untrusted input — but it would couple to result-ts.
   Decision: keep `fromJSON` lenient and decoupled; a consumer can validate
   (e.g. check `code` against an allow-list) and wrap in a `Result` themselves.

## Test plan

- Round-trip: `fromJSON(e.toJSON())` equals `e` on code/category/retryable/
  details/message/name; cause chain reconstructed (nested codes preserved);
  original stack/timestamp preserved.
- Plain-error payload (no structured fields) → `StructuredError` with defaults.
- Garbage payloads (`null`, `42`, `"x"`, `{}`) → safe envelope, no throw.
- **Security:** a payload with `__proto__`/`constructor` keys does not pollute
  the prototype; only whitelisted fields appear; arbitrary extra keys are not
  copied onto the instance.
- Reconstructed error composes with `matchError` and `toProblemDetails`
  (safe-by-default still holds).

## Sequencing

Single, self-contained PR (built test-first). Smaller than the validation
aggregate; no new public types beyond the static method.

## Non-goals

- Not a transparent cross-service propagation mechanism — across services,
  reconstruct then translate through an ACL; the wire contract is the safe
  projection, not the log shape.
- Not a general-purpose deserializer/validator (it reconstructs *this* library's
  serialized shape).
- No trust/authenticity guarantees — that is the transport's job (signing/mTLS).
- No new runtime dependencies.
